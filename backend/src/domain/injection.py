"""Injection plans: which deliveries a phase sends, with deterministic delivery IDs.

Owns: turning (run, experiment, batch, phase) into the exact list of
DisbursementEvents to publish.
Must never: publish anything or perform I/O.

Why delivery IDs are deterministic (docs/adr/0004-deterministic-delivery-ids.md):
Step Functions retries an inject task after a transient Lambda error. If the
first attempt had already sent some messages and IDs were random, the retry
would mint *new* delivery IDs, and the vulnerable processor would pay them as
new events, inflating every count. With
`delivery_id = uuid5(namespace, "<run_id>:<phase>:<logical_event_id>:<copy>")`
a retried injection re-sends the same deliveries. The worker then absorbs them
exactly like an SQS redelivery (the Deliveries row for that ID already exists).
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable

from common.errors import ConflictError
from domain.experiment import assign_logical_events
from domain.fingerprint import batch_content_sha256
from domain.idempotency import build_entitlement_key
from domain.models import (
    BatchMeta,
    DisbursementEvent,
    Entitlement,
    ExperimentDefinition,
    InjectionPhase,
)

# Fixed namespace for DisburseProof delivery IDs. Changing it changes every ID.
DELIVERY_ID_NAMESPACE = uuid.UUID("6f1b8f5e-2d0c-4a7e-9b2a-3c5d7e9f1a24")


def derive_delivery_id(run_id: str, phase: InjectionPhase, logical_event_id: str, copy_index: int) -> str:
    return str(uuid.uuid5(DELIVERY_ID_NAMESPACE, f"{run_id}:{phase.value}:{logical_event_id}:{copy_index}"))


def verify_batch_unchanged(definition: ExperimentDefinition, entitlements: Iterable[Entitlement]) -> None:
    """Refuse to inject if the batch no longer matches the hash in the definition."""
    actual = batch_content_sha256(entitlements)
    if actual != definition.batch_content_sha256:
        raise ConflictError(
            "The batch has changed since this experiment was defined "
            f"(expected content hash {definition.batch_content_sha256[:12]}…, found {actual[:12]}…)"
        )


def plan_phase(
    *,
    run_id: str,
    phase: InjectionPhase,
    definition: ExperimentDefinition,
    batch: BatchMeta,
    entitlements: Iterable[Entitlement],
) -> list[DisbursementEvent]:
    """Return every delivery for one phase, in send order.

    Phase A sends copy 1 of every duplicated event, then copy 2 of every one (the
    retry wave). Phase B sends copy 1 of every other event. Send order is not
    arrival order: SQS Standard may deliver them in any order.
    """
    entitlement_list = list(entitlements)
    verify_batch_unchanged(definition, entitlement_list)
    by_event = dict(assign_logical_events(entitlement_list))

    if phase is InjectionPhase.A:
        plan = [(logical_id, copy) for copy in (1, 2) for logical_id in definition.phase_a]
    else:
        plan = [(logical_id, 1) for logical_id in definition.phase_b]

    events: list[DisbursementEvent] = []
    for logical_id, copy_index in plan:
        entitlement = by_event[logical_id]
        events.append(
            DisbursementEvent(
                run_id=run_id,
                delivery_id=derive_delivery_id(run_id, phase, logical_id, copy_index),
                logical_event_id=logical_id,
                entitlement_key=build_entitlement_key(
                    batch.scheme_id, entitlement.beneficiary_id, batch.academic_year, entitlement.installment
                ),
                scheme_id=batch.scheme_id,
                beneficiary_id=entitlement.beneficiary_id,
                academic_year=batch.academic_year,
                installment=entitlement.installment,
                amount_paise=entitlement.amount_paise,
                phase=phase,
                copy_index=copy_index,
                duplicate_of=logical_id if copy_index == 2 else None,
            )
        )
    return events
