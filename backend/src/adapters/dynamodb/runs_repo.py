"""Runs table repository.

Owns: reading and writing Run records. A run is one execution of an experiment
against one processor. Its item also holds the live counters the workers update
(`budget_remaining_paise`, `delivered_count`, per-outcome counts): that makes it a
deliberate hot key, see processors/retry.py.
Must never: compute verdicts (domain/evaluator.py does).
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from botocore.exceptions import ClientError

from adapters.dynamodb.client import dynamodb_client, error_code, from_item, key, to_item
from adapters.dynamodb.expressions import Expression
from common.errors import ConflictError, NotFoundError
from domain.models import RunPhase, RunStatus

RUN_ENTITY_TYPE = "RUN"
CREATED_INDEX = "gsi_created"


class RunsRepository:
    def __init__(self, table: str, client: Any | None = None) -> None:
        self._table = table
        self._client = client or dynamodb_client()

    def create(self, run: Mapping[str, object]) -> None:
        item = {**run, "entity_type": RUN_ENTITY_TYPE}
        self._client.put_item(
            TableName=self._table,
            Item=to_item(item),
            ConditionExpression="attribute_not_exists(run_id)",
        )

    def get(self, run_id: str) -> dict[str, Any] | None:
        response = self._client.get_item(
            TableName=self._table, Key=key(run_id=run_id), ConsistentRead=True
        )
        item = response.get("Item")
        return from_item(item) if item else None

    def require(self, run_id: str) -> dict[str, Any]:
        run = self.get(run_id)
        if run is None:
            raise NotFoundError(f"Run {run_id} not found")
        return run

    def list_recent(self, limit: int = 50) -> list[dict[str, Any]]:
        """Newest first, via the sparse `gsi_created` index (entity_type, created_at)."""
        expression = Expression()
        response = self._client.query(
            TableName=self._table,
            IndexName=CREATED_INDEX,
            KeyConditionExpression=f"{expression.name('entity_type')} = {expression.value('type', RUN_ENTITY_TYPE)}",
            ScanIndexForward=False,
            Limit=limit,
            **expression.request_args(),
        )
        return [from_item(item) for item in response.get("Items", [])]

    def update(
        self,
        run_id: str,
        updates: Mapping[str, object],
        *,
        require_status: RunStatus | None = None,
        forbid_status: RunStatus | None = None,
    ) -> dict[str, Any]:
        """SET the given attributes and return the updated run.

        `require_status` / `forbid_status` guard state transitions, so a late or
        retried task cannot, for example, mark a completed run as failed.
        """
        expression = Expression()
        conditions = ["attribute_exists(run_id)"]
        if require_status is not None:
            conditions.append(
                f"{expression.name('status')} = {expression.value('required', require_status.value)}"
            )
        if forbid_status is not None:
            conditions.append(
                f"{expression.name('status')} <> {expression.value('forbidden', forbid_status.value)}"
            )
        update_expression = expression.set_clause(
            {k: v for k, v in updates.items() if v is not None}
        )
        try:
            response = self._client.update_item(
                TableName=self._table,
                Key=key(run_id=run_id),
                UpdateExpression=update_expression,
                ConditionExpression=" AND ".join(conditions),
                ReturnValues="ALL_NEW",
                **expression.request_args(),
            )
        except ClientError as error:
            if error_code(error) == "ConditionalCheckFailedException":
                raise ConflictError(
                    f"Run {run_id} is not in a state that allows this update"
                ) from error
            raise
        return from_item(response["Attributes"])

    def start(self, run_id: str, *, budget_paise: int, started_at: str) -> dict[str, Any]:
        """QUEUED -> RUNNING, resetting the live counters. Idempotent for a retried task."""
        try:
            return self.update(
                run_id,
                {
                    "status": RunStatus.RUNNING.value,
                    "phase": RunPhase.QUEUED.value,
                    "budget_remaining_paise": budget_paise,
                    "delivered_count": 0,
                    "committed_count": 0,
                    "suppressed_count": 0,
                    "budget_exhausted_count": 0,
                    "started_at": started_at,
                },
                require_status=RunStatus.QUEUED,
            )
        except ConflictError:
            run = self.require(run_id)
            if run.get("status") == RunStatus.RUNNING.value:
                return run  # Step Functions retried InitRun after it had already succeeded
            raise
