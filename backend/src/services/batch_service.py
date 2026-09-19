"""Batch use cases: create (generate or CSV, with a dry-run preview), list, get.

Owns: orchestrating domain/batch_import.py and the Batches repository.
Must never: talk to AWS directly (repositories do).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from typing import Any

from adapters.dynamodb.batches_repo import BatchesRepository
from adapters.dynamodb.experiments_repo import ExperimentsRepository
from common.clock import utc_now_iso
from common.errors import FieldError, ValidationError
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
from domain.validation import optional_str, require_int
from services.views import public_batch, public_experiment

SCHEME_ID_PATTERN = re.compile(r"[A-Z0-9][A-Z0-9-]{1,31}")
ACADEMIC_YEAR_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}")
MAX_CSV_CHARACTERS = 200_000


class BatchService:
    def __init__(
        self,
        batches: BatchesRepository,
        experiments: ExperimentsRepository,
        *,
        now: Callable[[], str] = utc_now_iso,
        new_id: Callable[[], str] = new_batch_id,
    ) -> None:
        self._batches = batches
        self._experiments = experiments
        self._now = now
        self._new_id = new_id

    def create(self, body: Mapping[str, Any]) -> tuple[int, dict[str, Any]]:
        """POST /batches. `dry_run: true` validates a CSV and returns a preview without saving."""
        has_generate, has_csv = "generate" in body, "csv" in body
        if has_generate == has_csv:
            raise ValidationError("Send exactly one of `generate` or `csv`")
        name = optional_str(body, "name", max_length=100)
        scheme_id = optional_str(body, "scheme_id", max_length=32) or "DEMO-SCHEME"
        academic_year = optional_str(body, "academic_year", max_length=7) or DEMO_ACADEMIC_YEAR
        if not SCHEME_ID_PATTERN.fullmatch(scheme_id):
            raise ValidationError(
                "scheme_id must be 2-32 capital letters, digits or '-'",
                details=[FieldError("scheme_id", "has an invalid format")],
            )
        if not ACADEMIC_YEAR_PATTERN.fullmatch(academic_year):
            raise ValidationError(
                "academic_year must look like 2026-27",
                details=[FieldError("academic_year", "must look like 2026-27")],
            )

        if has_generate:
            spec = body["generate"]
            if not isinstance(spec, dict):
                raise ValidationError("generate must be an object with count and amount_paise")
            entitlements = generated_entitlements(
                require_int(spec, "count", minimum=1), require_int(spec, "amount_paise", minimum=1)
            )
            source, default_name = "generated", f"Generated batch ({len(entitlements)} students)"
        else:
            text = body["csv"]
            if not isinstance(text, str) or len(text) > MAX_CSV_CHARACTERS:
                raise ValidationError(
                    f"csv must be CSV text of at most {MAX_CSV_CHARACTERS} characters"
                )
            report = parse_entitlements_csv(text)
            preview = {
                "valid": report.is_valid,
                "rows": [row.to_dict() for row in report.rows],
                "errors": [error.to_dict() for error in report.errors],
                "entitlements": len(report.entitlements),
                "total_budget_paise": sum(e.amount_paise for e in report.entitlements),
                "max_rows": MAX_ROWS,
            }
            if body.get("dry_run") is True:
                return 200, {"preview": preview}
            if not report.is_valid:
                raise ValidationError(
                    f"The CSV has {len(report.errors)} problem(s); nothing was saved",
                    details=list(report.errors),
                )
            entitlements = list(report.entitlements)
            source, default_name = "csv", f"Uploaded batch ({len(entitlements)} entitlements)"

        meta = self._build_meta(
            batch_id=self._new_id(),
            name=name or default_name,
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
        """Write the golden demo batch. Content is fixed, so rewriting it is harmless."""
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
