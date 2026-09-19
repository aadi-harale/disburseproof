"""Deliveries table reader.

Owns: reading every recorded delivery of a run with a strongly consistent query.
Must never: write (processors write through disbursement_store.py).
"""

from __future__ import annotations

from typing import Any

from adapters.dynamodb.client import dynamodb_client, query_all
from adapters.dynamodb.items import delivery_from_row
from adapters.dynamodb.ledger_repo import run_query
from domain.models import Delivery


class DeliveriesRepository:
    def __init__(self, table: str, client: Any | None = None) -> None:
        self._table = table
        self._client = client or dynamodb_client()

    def list_deliveries(self, run_id: str) -> list[Delivery]:
        rows = query_all(self._client, **run_query(self._table, run_id))
        return sorted((delivery_from_row(row) for row in rows), key=lambda d: d.processed_at)
