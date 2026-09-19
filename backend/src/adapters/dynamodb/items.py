"""Row shapes for the Ledger, Deliveries and Idempotency tables.

Owns: the mapping between domain records and DynamoDB items, including sort-key
formats (`EFFECT#<effect_id>`, `DELIVERY#<delivery_id>`). One place, so the
writer (disbursement_store.py) and the readers (repositories) cannot drift.
Must never: talk to DynamoDB.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from domain.models import Delivery, DeliveryOutcome, InjectionPhase, LedgerEffect

EFFECT_PREFIX = "EFFECT#"
DELIVERY_PREFIX = "DELIVERY#"
IDEMPOTENCY_STATUS_COMMITTED = "COMMITTED"


def effect_sort_key(effect_id: str) -> str:
    return f"{EFFECT_PREFIX}{effect_id}"


def delivery_sort_key(delivery_id: str) -> str:
    return f"{DELIVERY_PREFIX}{delivery_id}"


def effect_to_row(effect: LedgerEffect) -> dict[str, object]:
    return {
        "run_id": effect.run_id,
        "sk": effect_sort_key(effect.effect_id),
        "effect_id": effect.effect_id,
        "entitlement_key": effect.entitlement_key,
        "beneficiary_id": effect.beneficiary_id,
        "installment": effect.installment,
        "amount_paise": effect.amount_paise,
        "logical_event_id": effect.logical_event_id,
        "delivery_id": effect.delivery_id,
        "committed_at": effect.committed_at,
    }


def effect_from_row(row: Mapping[str, Any]) -> LedgerEffect:
    return LedgerEffect(
        run_id=row["run_id"],
        effect_id=row["effect_id"],
        entitlement_key=row["entitlement_key"],
        beneficiary_id=row["beneficiary_id"],
        installment=int(row["installment"]),
        amount_paise=int(row["amount_paise"]),
        logical_event_id=row["logical_event_id"],
        delivery_id=row["delivery_id"],
        committed_at=row["committed_at"],
    )


def delivery_to_row(delivery: Delivery) -> dict[str, object]:
    return {
        "run_id": delivery.run_id,
        "sk": delivery_sort_key(delivery.delivery_id),
        "delivery_id": delivery.delivery_id,
        "logical_event_id": delivery.logical_event_id,
        "entitlement_key": delivery.entitlement_key,
        "beneficiary_id": delivery.beneficiary_id,
        "installment": delivery.installment,
        "phase": delivery.phase.value,
        "copy_index": delivery.copy_index,
        "duplicate_of": delivery.duplicate_of,
        "outcome": delivery.outcome.value,
        "processed_at": delivery.processed_at,
        "lambda_request_id": delivery.lambda_request_id,
        "attempt": delivery.attempt,
        "effect_id": delivery.effect_id,
        "budget_remaining_paise_at_rejection": delivery.budget_remaining_paise_at_rejection,
    }


def delivery_from_row(row: Mapping[str, Any]) -> Delivery:
    remaining = row.get("budget_remaining_paise_at_rejection")
    return Delivery(
        run_id=row["run_id"],
        delivery_id=row["delivery_id"],
        logical_event_id=row["logical_event_id"],
        entitlement_key=row["entitlement_key"],
        beneficiary_id=row["beneficiary_id"],
        installment=int(row["installment"]),
        phase=InjectionPhase(row["phase"]),
        copy_index=int(row["copy_index"]),
        duplicate_of=row.get("duplicate_of"),
        outcome=DeliveryOutcome(row["outcome"]),
        processed_at=row["processed_at"],
        lambda_request_id=row["lambda_request_id"],
        attempt=int(row["attempt"]),
        effect_id=row.get("effect_id"),
        budget_remaining_paise_at_rejection=None if remaining is None else int(remaining),
    )


def claim_to_row(idempotency_key: str, effect: LedgerEffect) -> dict[str, object]:
    return {
        "idem_key": idempotency_key,
        "run_id": effect.run_id,
        "entitlement_key": effect.entitlement_key,
        "status": IDEMPOTENCY_STATUS_COMMITTED,
        "effect_id": effect.effect_id,
        "delivery_id": effect.delivery_id,
        "committed_at": effect.committed_at,
    }
