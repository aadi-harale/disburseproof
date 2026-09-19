"""Injection plans: phase sizes, send order and deterministic delivery IDs."""

from __future__ import annotations

import uuid

import pytest

from common.errors import ConflictError
from domain.injection import derive_delivery_id, plan_phase
from domain.models import BatchMeta, Entitlement, ExperimentDefinition, InjectionPhase

RUN = "run_01J8ZQINJECTION000000000"


def test_phase_a_sends_each_duplicated_event_twice(
    batch: BatchMeta, entitlements: list[Entitlement], definition: ExperimentDefinition
) -> None:
    events = plan_phase(
        run_id=RUN,
        phase=InjectionPhase.A,
        definition=definition,
        batch=batch,
        entitlements=entitlements,
    )
    assert len(events) == 24
    assert [e.logical_event_id for e in events[:12]] == list(definition.phase_a)
    assert [e.copy_index for e in events] == [1] * 12 + [2] * 12  # first wave, then the retry wave
    assert all(e.duplicate_of == e.logical_event_id for e in events[12:])
    assert all(e.duplicate_of is None for e in events[:12])
    assert len({e.delivery_id for e in events}) == 24  # two deliveries, two IDs, same entitlement


def test_phase_b_sends_every_other_event_once(
    batch: BatchMeta, entitlements: list[Entitlement], definition: ExperimentDefinition
) -> None:
    events = plan_phase(
        run_id=RUN,
        phase=InjectionPhase.B,
        definition=definition,
        batch=batch,
        entitlements=entitlements,
    )
    assert len(events) == 88
    assert {e.logical_event_id for e in events}.isdisjoint(definition.phase_a)


def test_events_carry_the_business_identity(
    batch: BatchMeta, entitlements: list[Entitlement], definition: ExperimentDefinition
) -> None:
    event = plan_phase(
        run_id=RUN,
        phase=InjectionPhase.A,
        definition=definition,
        batch=batch,
        entitlements=entitlements,
    )[0]
    assert event.logical_event_id == "EVT-012"
    assert event.beneficiary_id == "STU-012"
    assert event.entitlement_key == "DEMO-POSTMATRIC#STU-012#2026-27#INST-1"
    assert event.amount_paise == 1_000_000
    assert event.to_message()["run_id"] == RUN


def test_replanning_a_phase_yields_the_same_delivery_ids(
    batch: BatchMeta, entitlements: list[Entitlement], definition: ExperimentDefinition
) -> None:
    # A retried inject task must re-send the same deliveries, never new ones.
    def plan() -> list[str]:
        events = plan_phase(
            run_id=RUN,
            phase=InjectionPhase.A,
            definition=definition,
            batch=batch,
            entitlements=entitlements,
        )
        return [event.delivery_id for event in events]

    assert plan() == plan()


def test_delivery_ids_are_uuids_scoped_to_run_phase_event_and_copy() -> None:
    base = derive_delivery_id(RUN, InjectionPhase.A, "EVT-001", 1)
    assert uuid.UUID(base).version == 5
    assert base != derive_delivery_id("run_other", InjectionPhase.A, "EVT-001", 1)
    assert base != derive_delivery_id(RUN, InjectionPhase.B, "EVT-001", 1)
    assert base != derive_delivery_id(RUN, InjectionPhase.A, "EVT-002", 1)
    assert base != derive_delivery_id(RUN, InjectionPhase.A, "EVT-001", 2)


def test_injection_refuses_a_changed_batch(
    batch: BatchMeta, entitlements: list[Entitlement], definition: ExperimentDefinition
) -> None:
    changed = [*entitlements[:-1], Entitlement("STU-100", "Someone Else", 1_000_000, 1)]
    with pytest.raises(ConflictError):
        plan_phase(
            run_id=RUN,
            phase=InjectionPhase.A,
            definition=definition,
            batch=batch,
            entitlements=changed,
        )
