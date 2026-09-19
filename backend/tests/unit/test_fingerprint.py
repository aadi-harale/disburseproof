"""Canonical JSON and fingerprint stability."""

from __future__ import annotations

import pytest

from domain.fingerprint import batch_content_sha256, canonical_json, fingerprint, sha256_hex
from domain.models import Entitlement, ExperimentDefinition

# Computed independently with Node.js crypto over the same canonical JSON. If either
# changes, every stored experiment ID and receipt fingerprint changes with it.
GOLDEN_DEMO_BATCH_SHA256 = "263f224cf011ce7c73cd54da7b731970f1822bddf8c0b58339326e8ddd821831"
GOLDEN_DEMO_FINGERPRINT = "ddbf4172908087bb80bb016b89f8fc0816ce9ea8de8c7becee8675fb1c31ec61"


def test_canonical_json_sorts_keys_and_drops_whitespace() -> None:
    assert canonical_json({"b": 1, "a": [2, {"d": 3, "c": 4}]}) == '{"a":[2,{"c":4,"d":3}],"b":1}'


def test_canonical_json_keeps_unicode_as_utf8() -> None:
    assert canonical_json({"name": "Batch — ₹10,000"}) == '{"name":"Batch — ₹10,000"}'


def test_key_order_does_not_change_the_fingerprint() -> None:
    assert fingerprint({"a": 1, "b": 2}) == fingerprint({"b": 2, "a": 1})


def test_floats_are_rejected_anywhere() -> None:
    with pytest.raises(TypeError):
        canonical_json({"amount": [1, {"x": 1.5}]})


def test_sha256_hex_of_a_known_value() -> None:
    assert sha256_hex("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"


def test_batch_hash_ignores_input_order(entitlements: list[Entitlement]) -> None:
    assert batch_content_sha256(reversed(entitlements)) == batch_content_sha256(entitlements)


def test_batch_hash_changes_when_any_amount_changes(entitlements: list[Entitlement]) -> None:
    changed = [*entitlements[:-1], Entitlement("STU-100", entitlements[-1].display_name, 999_999, 1)]
    assert batch_content_sha256(changed) != batch_content_sha256(entitlements)


def test_golden_demo_batch_hash(entitlements: list[Entitlement]) -> None:
    assert batch_content_sha256(entitlements) == GOLDEN_DEMO_BATCH_SHA256


def test_golden_demo_fingerprint(definition: ExperimentDefinition) -> None:
    assert fingerprint(definition.to_dict()) == GOLDEN_DEMO_FINGERPRINT
