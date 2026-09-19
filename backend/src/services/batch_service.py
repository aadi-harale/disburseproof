"""Batch use cases: create (generate or CSV, with a dry-run preview), list, get.

Owns: orchestrating domain/batch_import.py, the Batches repository and the hourly
cost guard for batch creation (each batch writes up to 501 DynamoDB items).
Must never: talk to AWS directly (repositories do).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

from adapters.dynamodb.batches_repo import BatchesRepository
from adapters.dynamodb.experiments_repo import ExperimentsRepository
from adapters.dynamodb.rate_limits_repo import RateLimiter
from common.clock import utc_now_iso
from common.errors import ValidationError
from common.ids import new_batch_id
from domain.batch_import import MAX_ROWS, generated_entitlements, parse_entitlements_csv
from domain.demo_data import (
    DEMO_ACADEMIC_YEAR,
    DEMO_BATCH_ID,
    DEMO_BATCH_NAME,
    DEMO_CREATED_AT,
    DEMO_SCHEME_ID,
    demo_entitlements,
)
from domain.fingerprint import batch_content_sha256
from domain.models import BatchMeta, Entitlement
from domain.requests import parse_create_batch
from services.views import public_batch, public_experiment

MAX_CSV_CHARACTERS = 200_000
DEFAULT_SCHEME_ID = "DEMO-SCHEME"


class BatchService:
    def __init__(
        self,
        batches: BatchesRepository,
        experiments: ExperimentsRepository,
        *,
        limiter: RateLimiter | None = None,
        batches_per_hour: int = 20,
        now: Callable[[], str] = utc_now_iso,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        new_id: Callable[[], str] = new_batch_id,
    ) -> None:
        self._batches = batches
        self._experiments = experiments
        self._limiter = limiter
        self._batches_per_hour = batches_per_hour
        self._now = now
        self._clock = clock
        self._new_id = new_id

    def create(self, body: Mapping[str, Any]) -> tuple[int, dict[str, Any]]:
        """POST /batches. `dry_run: true` validates a CSV and returns a preview without saving."""
        request = parse_create_batch(body, max_csv_characters=MAX_CSV_CHARACTERS)
        scheme_id = request.scheme_id or DEFAULT_SCHEME_ID
        academic_year = request.academic_year or DEMO_ACADEMIC_YEAR

        if request.csv is None:
            assert request.count is not None and request.amount_paise is not None
            entitlements = generated_entitlements(request.count, request.amount_paise)
            source, default_name = "generated", f"Generated batch ({len(entitlements)} students)"
        else:
            report = parse_entitlements_csv(request.csv)
            if request.dry_run:
                # A preview writes nothing, so it does not use the hourly allowance.
                return 200, {
                    "preview": {
                        "valid": report.is_valid,
                        "rows": [row.to_dict() for row in report.rows],
                        "errors": [error.to_dict() for error in report.errors],
                        "entitlements": len(report.entitlements),
                        "total_budget_paise": sum(e.amount_paise for e in report.entitlements),
                        "max_rows": MAX_ROWS,
                    }
                }
            if not report.is_valid:
                raise ValidationError(
                    f"The CSV has {len(report.errors)} problem(s); nothing was saved",
                    details=list(report.errors),
                )
            entitlements = list(report.entitlements)
            source, default_name = "csv", f"Uploaded batch ({len(entitlements)} entitlements)"

        if self._limiter is not None:
            self._limiter.consume(
                "batches", limit=self._batches_per_hour, now=self._clock(), what="new batches"
            )
        meta = self._build_meta(
            batch_id=self._new_id(),
            name=request.name or default_name,
            scheme_id=scheme_id,
            academic_year=academic_year,
            entitlements=entitlements,
            source=source,
            created_at=self._now(),
        )
        self._batches.put_batch(meta, entitlements)
        return 201, {"batch": public_batch(meta)}

    @staticmethod
    def _build_meta(
        *,
        batch_id: str,
        name: str,
        scheme_id: str,
        academic_year: str,
        entitlements: list[Entitlement],
        source: str,
        created_at: str,
    ) -> BatchMeta:
        return BatchMeta(
            batch_id=batch_id,
            name=name,
            scheme_id=scheme_id,
            academic_year=academic_year,
            total_budget_paise=sum(entitlement.amount_paise for entitlement in entitlements),
            count=len(entitlements),
            content_sha256=batch_content_sha256(entitlements),
            source=source,
            created_at=created_at,
        )

    def list(self) -> dict[str, Any]:
        return {"items": [public_batch(meta) for meta in self._batches.list_batches()]}

    def get(self, batch_id: str) -> dict[str, Any]:
        meta = self._batches.require_meta(batch_id)
        return {
            "batch": public_batch(meta),
            "entitlements": [e.to_dict() for e in self._batches.list_entitlements(batch_id)],
            "experiments": [
                public_experiment(x) for x in self._experiments.list_for_batch(batch_id)
            ],
        }

    def ensure_demo_batch(self) -> BatchMeta:
        """Write the golden demo batch (deploy-time seed only; no API route reaches this).

        Content is fixed, so rewriting it on every deploy is harmless. The public API
        can never target this ID: new batch IDs are always generated server-side.
        """
        entitlements = demo_entitlements()
        meta = self._build_meta(
            batch_id=DEMO_BATCH_ID,
            name=DEMO_BATCH_NAME,
            scheme_id=DEMO_SCHEME_ID,
            academic_year=DEMO_ACADEMIC_YEAR,
            entitlements=entitlements,
            source="demo",
            created_at=DEMO_CREATED_AT,
        )
        self._batches.put_batch(meta, entitlements)
        return meta
