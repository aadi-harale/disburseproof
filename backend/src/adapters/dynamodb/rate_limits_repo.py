"""RateLimits table: atomic hourly counters for the public write endpoints.

Owns: one conditional UpdateItem per request. `ADD count 1` only succeeds while
`count < limit`, so checking and consuming a slot is a single atomic operation.
Items carry `expires_at` (epoch seconds) and DynamoDB TTL deletes them after two hours.
Must never: decide limits (config does) or be skipped by a write endpoint.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from botocore.exceptions import ClientError

from adapters.dynamodb.client import dynamodb_client, error_code, key
from adapters.dynamodb.expressions import Expression
from common.errors import RateLimitedError
from domain.rate_limit import hourly_window


class RateLimiter:
    def __init__(self, table: str, client: Any | None = None) -> None:
        self._table = table
        self._client = client or dynamodb_client()

    def consume(self, bucket: str, *, limit: int, now: datetime, what: str) -> None:
        """Take one slot from this hour's allowance, or raise RateLimitedError (HTTP 429)."""
        window = hourly_window(bucket, now)
        expression = Expression()
        count = expression.name("count")  # `count` is a DynamoDB reserved word
        try:
            self._client.update_item(
                TableName=self._table,
                Key=key(pk=window.key),
                UpdateExpression=(
                    f"ADD {count} {expression.value('one', 1)} "
                    f"SET {expression.name('expires_at')} = if_not_exists({expression.name('expires_at')}, "
                    f"{expression.value('ttl', window.expires_at_epoch)})"
                ),
                ConditionExpression=f"attribute_not_exists({count}) OR {count} < {expression.value('limit', limit)}",
                **expression.request_args(),
            )
        except ClientError as error:
            if error_code(error) == "ConditionalCheckFailedException":
                raise RateLimitedError(
                    f"This public demo allows {limit} {what} per hour and that limit has been reached. "
                    f"Please try again after {window.resets_at:%H:%M} UTC."
                ) from error
            raise
