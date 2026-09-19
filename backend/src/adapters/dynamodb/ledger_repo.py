"""Ledger table reader.

Owns: reading every ledger effect (payment) of a run with a strongly consistent
query, so an evaluation that starts after the last delivery was recorded sees
every row.
Must never: write (processors write through disbursement_store.py).
"""

from __future__ import annotations

from typing import Any

from adapters.dynamodb.client import dynamodb_client, query_all
from adapters.dynamodb.expressions import Expression
from adapters.dynamodb.items import effect_from_row
from domain.models import LedgerEffect


def run_query(table: str, run_id: str) -> dict[str, Any]:
    expression = Expression()
    return {
        "TableName": table,
        "KeyConditionExpression": f"{expression.name('run_id')} = {expression.value('run', run_id)}",
        "ConsistentRead": True,
        **expression.request_args(),
    }


class LedgerRepository:
    def __init__(self, table: str, client: Any | None = None) -> None:
        self._table = table
        self._client = client or dynamodb_client()

    def list_effects(self, run_id: str) -> list[LedgerEffect]:
        return [effect_from_row(row) for row in query_all(self._client, **run_query(self._table, run_id))]
