"""Experiments table repository.

Owns: experiment items. The definition is stored as its canonical JSON string
(`definition_json`), exactly the bytes the fingerprint was computed from, so the
fingerprint can be re-verified from storage at any time.
Must never: build definitions (domain/experiment.py does).
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from botocore.exceptions import ClientError

from adapters.dynamodb.client import dynamodb_client, error_code, from_item, key, to_item
from adapters.dynamodb.expressions import Expression
from common.errors import NotFoundError
from domain.models import ExperimentDefinition

BATCH_INDEX = "gsi_batch"


def definition_of(experiment: Mapping[str, Any]) -> ExperimentDefinition:
    return ExperimentDefinition.from_dict(json.loads(experiment["definition_json"]))


class ExperimentsRepository:
    def __init__(self, table: str, client: Any | None = None) -> None:
        self._table = table
        self._client = client or dynamodb_client()

    def put_if_absent(self, experiment: Mapping[str, object]) -> bool:
        """Create the experiment unless one with the same (content-addressed) ID exists."""
        try:
            self._client.put_item(
                TableName=self._table,
                Item=to_item(experiment),
                ConditionExpression="attribute_not_exists(experiment_id)",
            )
        except ClientError as error:
            if error_code(error) == "ConditionalCheckFailedException":
                return False
            raise
        return True

    def get(self, experiment_id: str) -> dict[str, Any] | None:
        response = self._client.get_item(
            TableName=self._table, Key=key(experiment_id=experiment_id), ConsistentRead=True
        )
        item = response.get("Item")
        return from_item(item) if item else None

    def require(self, experiment_id: str) -> dict[str, Any]:
        experiment = self.get(experiment_id)
        if experiment is None:
            raise NotFoundError(f"Experiment {experiment_id} not found")
        return experiment

    def list_for_batch(self, batch_id: str, limit: int = 50) -> list[dict[str, Any]]:
        expression = Expression()
        response = self._client.query(
            TableName=self._table,
            IndexName=BATCH_INDEX,
            KeyConditionExpression=f"{expression.name('batch_id')} = {expression.value('batch', batch_id)}",
            ScanIndexForward=False,
            Limit=limit,
            **expression.request_args(),
        )
        return [from_item(item) for item in response.get("Items", [])]
