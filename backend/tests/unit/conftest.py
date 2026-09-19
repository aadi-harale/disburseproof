"""Shared fixtures: the golden demo batch, experiment and a deterministic clock."""

from __future__ import annotations

import itertools
from collections.abc import Callable

import pytest

from domain.demo_data import (
    DEMO_ACADEMIC_YEAR,
    DEMO_BATCH_ID,
    DEMO_BATCH_NAME,
    DEMO_CREATED_AT,
    DEMO_DUPLICATE_COUNT,
    DEMO_SCHEME_ID,
    DEMO_SEED,
    demo_entitlements,
)
from domain.experiment import build_definition
from domain.fingerprint import batch_content_sha256
from domain.models import BatchMeta, Entitlement, ExperimentDefinition


@pytest.fixture
def entitlements() -> list[Entitlement]:
    return demo_entitlements()


@pytest.fixture
def batch(entitlements: list[Entitlement]) -> BatchMeta:
    return BatchMeta(
        batch_id=DEMO_BATCH_ID,
        name=DEMO_BATCH_NAME,
        scheme_id=DEMO_SCHEME_ID,
        academic_year=DEMO_ACADEMIC_YEAR,
        total_budget_paise=sum(e.amount_paise for e in entitlements),
        count=len(entitlements),
        content_sha256=batch_content_sha256(entitlements),
        source="demo",
        created_at=DEMO_CREATED_AT,
    )


@pytest.fixture
def definition(batch: BatchMeta, entitlements: list[Entitlement]) -> ExperimentDefinition:
    return build_definition(
        batch_id=batch.batch_id,
        batch_content_sha256=batch.content_sha256,
        entitlement_count=len(entitlements),
        seed=DEMO_SEED,
        duplicate_count=DEMO_DUPLICATE_COUNT,
    )


@pytest.fixture
def clock() -> Callable[[], str]:
    """Strictly increasing timestamps, one millisecond apart."""
    counter = itertools.count()

    def now() -> str:
        millis = next(counter)
        return f"2026-09-19T08:00:{millis // 1000:02d}.{millis % 1000:03d}Z"

    return now
