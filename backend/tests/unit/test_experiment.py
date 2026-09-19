"""Duplicate selection determinism, bounds, phase split and definition shape."""

from __future__ import annotations

import pytest

from common.errors import ValidationError
from domain.experiment import (
    SCENARIO,
    assign_logical_events,
    build_definition,
    expected_deliveries,
    experiment_id_for,
    logical_event_ids,
    select_duplicates,
    split_phases,
    validate_duplicate_count,
)
from domain.fingerprint import fingerprint
from domain.models import BatchMeta, Entitlement, ExperimentDefinition

# Computed independently with Node.js crypto (sha256 over the same strings), so this
# also checks that the selection rule is language-independent and reproducible by hand.
GOLDEN_DEMO_DUPLICATES = [
    "EVT-012", "EVT-018", "EVT-021", "EVT-022", "EVT-048", "EVT-059",
    "EVT-062", "EVT-063", "EVT-080", "EVT-081", "EVT-095", "EVT-100",
]  # fmt: skip


def test_logical_event_ids_are_zero_padded_and_ordered() -> None:
    ids = logical_event_ids(100)
    assert ids[0] == "EVT-001" and ids[-1] == "EVT-100" and ids == sorted(ids)
    assert logical_event_ids(500)[-1] == "EVT-500"
    assert logical_event_ids(1000)[0] == "EVT-0001"  # width grows so string order stays numeric


def test_logical_events_follow_beneficiary_order(entitlements: list[Entitlement]) -> None:
    pairs = assign_logical_events(reversed(entitlements))
    assert pairs[0] == ("EVT-001", entitlements[0])
    assert pairs[41] == ("EVT-042", entitlements[41])


def test_duplicate_selection_matches_the_golden_demo() -> None:
    assert select_duplicates(logical_event_ids(100), "FC-2026-0918", 12) == GOLDEN_DEMO_DUPLICATES


def test_duplicate_selection_is_deterministic_and_seed_dependent() -> None:
    ids = logical_event_ids(100)
    assert select_duplicates(ids, "FC-2026-0918", 12) == select_duplicates(list(ids), "FC-2026-0918", 12)
    assert select_duplicates(ids, "FC-2026-0918", 12) != select_duplicates(ids, "another-seed", 12)


def test_duplicate_selection_does_not_depend_on_input_order() -> None:
    ids = logical_event_ids(100)
    assert select_duplicates(list(reversed(ids)), "FC-2026-0918", 12) == GOLDEN_DEMO_DUPLICATES


@pytest.mark.parametrize(("n", "d"), [(100, 0), (100, 51), (1, 1), (3, 2)])
def test_duplicate_count_outside_one_to_half_n_is_rejected(n: int, d: int) -> None:
    with pytest.raises(ValidationError):
        validate_duplicate_count(n, d)


@pytest.mark.parametrize(("n", "d"), [(100, 1), (100, 50), (2, 1), (500, 250)])
def test_duplicate_count_boundaries_are_accepted(n: int, d: int) -> None:
    validate_duplicate_count(n, d)


def test_phase_split_is_a_partition() -> None:
    ids = logical_event_ids(100)
    phase_a, phase_b = split_phases(ids, GOLDEN_DEMO_DUPLICATES)
    assert phase_a == GOLDEN_DEMO_DUPLICATES
    assert len(phase_b) == 88
    assert set(phase_a).isdisjoint(phase_b)
    assert sorted(phase_a + phase_b) == ids


def test_phase_split_rejects_unknown_ids() -> None:
    with pytest.raises(ValidationError):
        split_phases(logical_event_ids(10), ["EVT-011"])


def test_definition_has_only_canonical_fields(definition: ExperimentDefinition, batch: BatchMeta) -> None:
    data = definition.to_dict()
    assert set(data) == {
        "version", "batch_id", "batch_content_sha256", "seed", "logical_events", "duplicate_count",
        "duplicated_logical_ids", "phase_a", "phase_b", "scenario",
    }  # fmt: skip
    assert "run_id" not in data and "processor" not in data
    assert data["scenario"] == SCENARIO
    assert data["batch_content_sha256"] == batch.content_sha256
    assert ExperimentDefinition.from_dict(data) == definition


def test_expected_deliveries_are_2d_and_n_plus_d(definition: ExperimentDefinition) -> None:
    assert expected_deliveries(definition) == (24, 112)


def test_experiment_id_is_content_addressed(definition: ExperimentDefinition) -> None:
    replay_fingerprint = fingerprint(definition.to_dict())
    assert experiment_id_for(replay_fingerprint) == f"exp_{replay_fingerprint[:16]}"


def test_invalid_seed_is_rejected(batch: BatchMeta) -> None:
    with pytest.raises(ValidationError):
        build_definition(
            batch_id=batch.batch_id,
            batch_content_sha256=batch.content_sha256,
            entitlement_count=100,
            seed="has spaces",
            duplicate_count=12,
        )
