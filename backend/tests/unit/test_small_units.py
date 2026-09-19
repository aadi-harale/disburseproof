"""Money formatting, retry backoff, student state, receipt determinism, demo names, HTTP mapping."""

from __future__ import annotations

import json
from typing import Any

import pytest

from common.errors import ConflictError, NotFoundError, ValidationError, http_status_for
from common.ids import new_ulid
from domain.demo_data import MAX_GENERATED_ENTITLEMENTS, synthetic_name
from domain.evaluator import evaluate_run
from domain.fingerprint import canonical_json
from domain.idempotency import key_entitlements
from domain.models import (
    BatchMeta,
    Delivery,
    DeliveryOutcome,
    Entitlement,
    InjectionPhase,
    LedgerEffect,
    ProcessorName,
    StudentState,
)
from domain.money import format_inr, is_valid_amount_paise
from domain.receipt import build_receipt
from domain.student_state import derive_student_views, state_for
from processors.base import RetriesExhausted, WriteConflict
from processors.retry import ConflictRetrier


@pytest.mark.parametrize(
    ("paise", "text"),
    [(1_000_000, "₹10,000"), (100_000_000, "₹10,00,000"), (12_000_000, "₹1,20,000"), (0, "₹0"),
     (1_050, "₹10.50"), (-500_000, "-₹5,000"), (10_000_000_000, "₹10,00,00,000")],
)
def test_format_inr_uses_indian_grouping(paise: int, text: str) -> None:
    assert format_inr(paise) == text


def test_amount_validation_rejects_bools_floats_and_non_positive() -> None:
    assert is_valid_amount_paise(1)
    assert not is_valid_amount_paise(True)
    assert not is_valid_amount_paise(1.0)
    assert not is_valid_amount_paise(0)


def test_backoff_is_capped_full_jitter() -> None:
    retrier = ConflictRetrier(jitter=lambda: 1.0)
    assert [retrier.backoff_seconds(n) for n in range(1, 7)] == [0.05, 0.1, 0.2, 0.4, 0.8, 1.0]
    assert ConflictRetrier(jitter=lambda: 0.5).backoff_seconds(3) == pytest.approx(0.1)


def test_retrier_counts_attempts_and_stops_at_six() -> None:
    sleeps: list[float] = []
    retrier = ConflictRetrier(sleep=sleeps.append, jitter=lambda: 1.0)

    def always_conflict(_attempt: int) -> None:
        raise WriteConflict("busy")

    with pytest.raises(RetriesExhausted):
        retrier.run(always_conflict)
    assert retrier.attempts == 6
    assert len(sleeps) == 5  # no sleep after the final attempt


def test_retrier_does_not_retry_other_errors() -> None:
    retrier = ConflictRetrier(sleep=lambda _s: None)

    def fails(_attempt: int) -> None:
        raise ValueError("not transient")

    with pytest.raises(ValueError):
        retrier.run(fails)
    assert retrier.attempts == 1


def test_student_state_rules() -> None:
    assert state_for(2, rejected_for_budget=False, run_evaluated=False) is StudentState.PAID_TWICE
    assert state_for(1, rejected_for_budget=True, run_evaluated=True) is StudentState.PAID_ONCE
    assert state_for(0, rejected_for_budget=True, run_evaluated=False) is StudentState.UNPAID
    assert state_for(0, rejected_for_budget=False, run_evaluated=True) is StudentState.UNPAID
    assert state_for(0, rejected_for_budget=False, run_evaluated=False) is StudentState.PENDING


def test_student_views_are_one_per_entitlement() -> None:
    entitlements = [Entitlement("STU-001", "A", 100, 1), Entitlement("STU-002", "B", 100, 1)]
    eligible = key_entitlements("S", "2026-27", entitlements)
    key_1, key_2 = eligible
    effects = [LedgerEffect("r", f"e{i}", key_1, "STU-001", 1, 100, "EVT-001", f"d{i}", "t") for i in range(2)]
    rejected = Delivery("r", "d9", "EVT-002", key_2, "STU-002", 1, InjectionPhase.B, 1, None,
                        DeliveryOutcome.BUDGET_EXHAUSTED, "t", "req", 1)
    views = derive_student_views(eligible=eligible, effects=effects, deliveries=[rejected], run_evaluated=False)
    assert [(v.beneficiary_id, v.state, v.payments) for v in views] == [
        ("STU-001", StudentState.PAID_TWICE, 2),
        ("STU-002", StudentState.UNPAID, 0),
    ]


def test_receipt_is_deterministic_and_self_describing() -> None:
    entitlements = [Entitlement("STU-001", "A", 100, 1)]
    eligible = key_entitlements("S", "2026-27", entitlements)
    key = next(iter(eligible))
    report = evaluate_run(
        eligible=eligible,
        effects=[LedgerEffect("r", "e1", key, "STU-001", 1, 100, "EVT-001", "d1", "t")],
        deliveries=[],
        budget_paise=100,
    )
    batch = BatchMeta("b", "Batch — demo", "S", "2026-27", 100, 1, "hash", "demo", "t")
    kwargs: dict[str, Any] = {
        "run_id": "run_X", "processor": ProcessorName.PROTECTED, "experiment_id": "exp_1", "fingerprint": "fp",
        "batch": batch, "report": report, "execution_arn": "arn:x", "started_at": "2026-09-19T08:00:00.000Z",
        "finished_at": "2026-09-19T08:00:12.500Z",
    }
    first, second = canonical_json(build_receipt(**kwargs)), canonical_json(build_receipt(**kwargs))
    assert first == second  # a retried receipt task writes identical bytes
    receipt = json.loads(first)
    assert receipt["execution"]["duration_ms"] == 12_500
    assert receipt["verdict"] == "PASS"
    assert "not a guarantee of exactly-once delivery" in receipt["claim_boundary"]


def test_synthetic_names_are_unique_across_a_full_batch() -> None:
    names = [synthetic_name(index) for index in range(MAX_GENERATED_ENTITLEMENTS)]
    assert len(set(names)) == MAX_GENERATED_ENTITLEMENTS


def test_ulids_are_26_characters_and_time_sortable() -> None:
    earlier = new_ulid(now_ms=1_000, entropy=b"\xff" * 10)
    later = new_ulid(now_ms=1_001, entropy=b"\x00" * 10)
    assert len(earlier) == len(later) == 26
    assert earlier < later


def test_error_types_map_to_http_statuses() -> None:
    assert http_status_for(ValidationError("x")) == 400
    assert http_status_for(NotFoundError("x")) == 404
    assert http_status_for(ConflictError("x")) == 409
