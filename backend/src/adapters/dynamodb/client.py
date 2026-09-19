"""Shared DynamoDB plumbing: the client, item (de)serialisation and pagination.

Owns: the low-level boto3 DynamoDB client (one per Lambda container) and the
conversion between Python values and DynamoDB attribute maps. The low-level
client is used everywhere, not the Table resource, because TransactWriteItems
needs the low-level format anyway and one style is easier to read.
Must never: contain business rules.
"""

from __future__ import annotations

from collections.abc import Mapping
from decimal import Decimal
from functools import cache
from typing import Any

import boto3
from boto3.dynamodb.types import TypeDeserializer, TypeSerializer
from botocore.config import Config
from botocore.exceptions import ClientError

_SERIALIZER = TypeSerializer()
_DESERIALIZER = TypeDeserializer()

# The SDK's own retries cover throttling and network errors. Write conflicts are
# retried by processors/retry.py instead, where they are counted and logged.
_CLIENT_CONFIG = Config(
    retries={"mode": "standard", "max_attempts": 3},
    connect_timeout=2,
    read_timeout=5,
)


@cache
def dynamodb_client() -> Any:
    return boto3.client("dynamodb", config=_CLIENT_CONFIG)


def to_item(values: Mapping[str, object]) -> dict[str, Any]:
    """Serialise a dict to a DynamoDB item. `None` values are omitted (sparse attributes)."""
    return {key: _SERIALIZER.serialize(value) for key, value in values.items() if value is not None}


def _plain(value: Any) -> Any:
    # DynamoDB numbers come back as Decimal. Every number we store is an integer.
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else value
    if isinstance(value, list):
        return [_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, (set, frozenset)):
        return sorted(_plain(item) for item in value)
    return value


def from_item(item: Mapping[str, Any]) -> dict[str, Any]:
    return {key: _plain(_DESERIALIZER.deserialize(value)) for key, value in item.items()}


def key(**parts: str) -> dict[str, Any]:
    return {name: {"S": value} for name, value in parts.items()}


def error_code(error: ClientError) -> str:
    return str(error.response.get("Error", {}).get("Code", ""))


def query_all(client: Any, **kwargs: Any) -> list[dict[str, Any]]:
    """Run a Query to completion, following LastEvaluatedKey, and deserialise every item."""
    items: list[dict[str, Any]] = []
    while True:
        response = client.query(**kwargs)
        items.extend(from_item(item) for item in response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            return items
        kwargs["ExclusiveStartKey"] = last_key
