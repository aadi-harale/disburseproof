"""Idempotency key construction."""

from __future__ import annotations

import inspect

import pytest

from common.errors import ValidationError
from domain.idempotency import (
    build_entitlement_key,
    build_idempotency_key,
    idempotency_key_for,
    key_entitlements,
)
from domain.models import Entitlement


def test_entitlement_key_is_built_from_business_fields_only() -> None:
    key = build_entitlement_key("DEMO-POSTMATRIC", "STU-042", "2026-27", 1)
    assert key == "DEMO-POSTMATRIC#STU-042#2026-27#INST-1"


def test_idempotency_key_has_the_documented_format() -> None:
    key = build_idempotency_key("run_01J8ZQ", "DEMO-POSTMATRIC", "STU-042", "2026-27", 1)
    assert key == "run_01J8ZQ#DEMO-POSTMATRIC#STU-042#2026-27#INST-1"
    assert key == idempotency_key_for("run_01J8ZQ", build_entitlement_key("DEMO-POSTMATRIC", "STU-042", "2026-27", 1))


def test_idempotency_key_cannot_take_a_delivery_or_message_id() -> None:
    # The whole point: retries change delivery/message IDs, so they must not be inputs.
    parameters = set(inspect.signature(build_idempotency_key).parameters)
    assert parameters == {"run_id", "scheme_id", "beneficiary_id", "academic_year", "installment"}


def test_same_entitlement_in_two_runs_gets_two_keys() -> None:
    # Run-scoped on purpose: each run is an isolated sandbox universe.
    first = build_idempotency_key("run_A", "S", "STU-001", "2026-27", 1)
    second = build_idempotency_key("run_B", "S", "STU-001", "2026-27", 1)
    assert first != second


def test_different_installments_are_different_entitlements() -> None:
    assert build_entitlement_key("S", "STU-001", "2026-27", 1) != build_entitlement_key("S", "STU-001", "2026-27", 2)


@pytest.mark.parametrize(
    ("scheme", "beneficiary", "year"),
    [("A#B", "STU-1", "2026-27"), ("S", "STU#1", "2026-27"), ("S", "STU-1", ""), ("", "STU-1", "2026-27")],
)
def test_separator_or_empty_component_is_rejected(scheme: str, beneficiary: str, year: str) -> None:
    with pytest.raises(ValidationError):
        build_entitlement_key(scheme, beneficiary, year, 1)


def test_installment_must_be_positive() -> None:
    with pytest.raises(ValidationError):
        build_entitlement_key("S", "STU-1", "2026-27", 0)


def test_key_entitlements_orders_by_beneficiary_then_installment() -> None:
    entitlements = [
        Entitlement("STU-002", "B", 100, 1),
        Entitlement("STU-001", "A", 100, 2),
        Entitlement("STU-001", "A", 100, 1),
    ]
    assert list(key_entitlements("S", "2026-27", entitlements)) == [
        "S#STU-001#2026-27#INST-1",
        "S#STU-001#2026-27#INST-2",
        "S#STU-002#2026-27#INST-1",
    ]
