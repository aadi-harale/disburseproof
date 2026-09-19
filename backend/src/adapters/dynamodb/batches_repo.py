"""Batches table repository.

Owns: the batch META row and its ENT rows (one per entitlement), keyed
PK `batch_id`, SK `META` or `ENT#<beneficiary_id>#<installment>`.
Must never: validate business rules (domain/batch_import.py does).
"""

from __future__ import annotations

import time
from collections.abc import Iterable
from typing import Any

from adapters.dynamodb.client import dynamodb_client, from_item, key, query_all, to_item
from adapters.dynamodb.expressions import Expression
from common.errors import NotFoundError
from domain.models import BatchMeta, Entitlement

BATCH_ENTITY_TYPE = "BATCH"
CREATED_INDEX = "gsi_created"
META_SK = "META"
ENT_PREFIX = "ENT#"
BATCH_WRITE_LIMIT = 25  # DynamoDB BatchWriteItem accepts at most 25 requests


def entitlement_sort_key(entitlement: Entitlement) -> str:
    return f"{ENT_PREFIX}{entitlement.beneficiary_id}#{entitlement.installment}"


def _meta_from_row(row: dict[str, Any]) -> BatchMeta:
    return BatchMeta(
        batch_id=row["batch_id"],
        name=row["name"],
        scheme_id=row["scheme_id"],
        academic_year=row["academic_year"],
        total_budget_paise=int(row["total_budget_paise"]),
        count=int(row["count"]),
        content_sha256=row["content_sha256"],
        source=row["source"],
        created_at=row["created_at"],
    )


def meta_to_dict(meta: BatchMeta) -> dict[str, object]:
    return {
        "batch_id": meta.batch_id,
        "name": meta.name,
        "scheme_id": meta.scheme_id,
        "academic_year": meta.academic_year,
        "total_budget_paise": meta.total_budget_paise,
        "count": meta.count,
        "content_sha256": meta.content_sha256,
        "source": meta.source,
        "created_at": meta.created_at,
    }


class BatchesRepository:
    def __init__(self, table: str, client: Any | None = None) -> None:
        self._table = table
        self._client = client or dynamodb_client()

    def put_batch(self, meta: BatchMeta, entitlements: Iterable[Entitlement]) -> None:
        """Write META + ENT rows. Rows are immutable once written; the demo seed rewrites
        identical content, which is harmless."""
        rows: list[dict[str, object]] = [
            {**meta_to_dict(meta), "sk": META_SK, "entity_type": BATCH_ENTITY_TYPE}
        ]
        rows.extend(
            {"batch_id": meta.batch_id, "sk": entitlement_sort_key(entitlement), **entitlement.to_dict()}
            for entitlement in entitlements
        )
        for start in range(0, len(rows), BATCH_WRITE_LIMIT):
            chunk = rows[start : start + BATCH_WRITE_LIMIT]
            self._write_chunk([{"PutRequest": {"Item": to_item(row)}} for row in chunk])

    def _write_chunk(self, requests: list[dict[str, Any]]) -> None:
        pending = {self._table: requests}
        for attempt in range(6):
            response = self._client.batch_write_item(RequestItems=pending)
            pending = response.get("UnprocessedItems") or {}
            if not pending:
                return
            time.sleep(min(1.0, 0.05 * 2**attempt))  # back off before retrying throttled items
        raise RuntimeError("BatchWriteItem left unprocessed items after 6 attempts")

    def get_meta(self, batch_id: str) -> BatchMeta | None:
        response = self._client.get_item(
            TableName=self._table, Key=key(batch_id=batch_id, sk=META_SK), ConsistentRead=True
        )
        item = response.get("Item")
        return _meta_from_row(from_item(item)) if item else None

    def require_meta(self, batch_id: str) -> BatchMeta:
        meta = self.get_meta(batch_id)
        if meta is None:
            raise NotFoundError(f"Batch {batch_id} not found")
        return meta

    def list_entitlements(self, batch_id: str) -> list[Entitlement]:
        expression = Expression()
        rows = query_all(
            self._client,
            TableName=self._table,
            KeyConditionExpression=(
                f"{expression.name('batch_id')} = {expression.value('batch', batch_id)} AND "
                f"begins_with({expression.name('sk')}, {expression.value('prefix', ENT_PREFIX)})"
            ),
            ConsistentRead=True,
            **expression.request_args(),
        )
        entitlements = [
            Entitlement(
                beneficiary_id=row["beneficiary_id"],
                display_name=row["display_name"],
                amount_paise=int(row["amount_paise"]),
                installment=int(row["installment"]),
            )
            for row in rows
        ]
        return sorted(entitlements, key=lambda entitlement: entitlement.order_key)

    def list_batches(self, limit: int = 50) -> list[BatchMeta]:
        expression = Expression()
        response = self._client.query(
            TableName=self._table,
            IndexName=CREATED_INDEX,
            KeyConditionExpression=f"{expression.name('entity_type')} = {expression.value('type', BATCH_ENTITY_TYPE)}",
            ScanIndexForward=False,
            Limit=limit,
            **expression.request_args(),
        )
        return [_meta_from_row(from_item(item)) for item in response.get("Items", [])]
