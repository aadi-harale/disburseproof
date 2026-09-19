"""The processor interface and the storage ports processors depend on.

Owns: the `DisbursementProcessor` protocol, the narrow storage port each
processor needs, and the exceptions an adapter raises to report a storage
outcome. Ports are injected through each processor's constructor, so unit tests
run the real processor logic against in-memory fakes.
Must never: import boto3 or know table names (adapters/dynamodb/ does).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Protocol

from common.errors import ValidationError
from domain.idempotency import build_entitlement_key
from domain.models import Delivery, DisbursementEvent, LedgerEffect, ProcessorName


class ProcessingStatus(StrEnum):
    """What happened to one delivery, as reported to the worker and its logs."""

    COMMITTED = "COMMITTED"
    DUPLICATE_SUPPRESSED = "DUPLICATE_SUPPRESSED"
    BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED"
    # SQS redelivered a delivery that is already recorded. Acknowledged; nothing written.
    ALREADY_PROCESSED = "ALREADY_PROCESSED"


@dataclass(frozen=True, slots=True)
class ProcessingOutcome:
    status: ProcessingStatus
    attempts: int
    effect_id: str | None = None


@dataclass(frozen=True, slots=True)
class ProcessingContext:
    lambda_request_id: str
    now: Callable[[], str]


class DisbursementProcessor(Protocol):
    name: ProcessorName

    def process(
        self, event: DisbursementEvent, context: ProcessingContext
    ) -> ProcessingOutcome: ...


# --- Storage outcomes, raised by adapters -------------------------------------


class WriteConflict(Exception):
    """Transient contention (TransactionConflict, throttling). Nothing was written; retry."""


class RetriesExhausted(Exception):
    """A write kept conflicting. The worker reports the message so SQS redelivers it."""


class DeliveryAlreadyRecorded(Exception):
    """A Deliveries row already exists for this delivery_id (an SQS redelivery)."""


class EntitlementAlreadyClaimed(Exception):
    """The idempotency record for this entitlement already exists (a business duplicate)."""


class InsufficientBudget(Exception):
    """The run's remaining budget is smaller than this payment."""

    def __init__(self, budget_remaining_paise: int | None) -> None:
        super().__init__(f"budget remaining: {budget_remaining_paise}")
        self.budget_remaining_paise = budget_remaining_paise


@dataclass(frozen=True, slots=True)
class BudgetDebit:
    accepted: bool
    budget_remaining_paise: int | None


# --- Ports ---------------------------------------------------------------------


class ProtectedLedgerPort(Protocol):
    def commit_payment(
        self, *, idempotency_key: str, effect: LedgerEffect, delivery: Delivery
    ) -> None:
        """Atomically claim the key, debit the budget, write the effect and record the delivery.

        Raises DeliveryAlreadyRecorded, EntitlementAlreadyClaimed, InsufficientBudget
        or WriteConflict. On any of them, nothing was written.
        """

    def record_outcome(self, delivery: Delivery) -> None:
        """Record a non-paying outcome and count the delivery, atomically.

        Raises DeliveryAlreadyRecorded or WriteConflict.
        """


class VulnerableLedgerPort(Protocol):
    def is_delivery_recorded(self, run_id: str, delivery_id: str) -> bool: ...

    def debit_budget(self, run_id: str, amount_paise: int) -> BudgetDebit:
        """Conditionally subtract `amount_paise`. Raises WriteConflict on contention."""

    def put_effect(self, effect: LedgerEffect) -> None: ...

    def record_outcome(self, delivery: Delivery) -> None:
        """Raises DeliveryAlreadyRecorded or WriteConflict."""


class NaiveLedgerPort(VulnerableLedgerPort, Protocol):
    def is_entitlement_claimed(self, idempotency_key: str) -> bool: ...

    def put_claim_unconditionally(self, *, idempotency_key: str, effect: LedgerEffect) -> None: ...


def ensure_consistent_entitlement_key(event: DisbursementEvent) -> None:
    """Reject a message whose entitlement_key does not match its own business fields."""
    expected = build_entitlement_key(
        event.scheme_id, event.beneficiary_id, event.academic_year, event.installment
    )
    if event.entitlement_key != expected:
        raise ValidationError(
            f"entitlement_key {event.entitlement_key!r} does not match its fields ({expected!r})"
        )


class LedgerStore(ProtectedLedgerPort, NaiveLedgerPort, Protocol):
    """Everything the DynamoDB adapter implements. Each processor depends only on its own port."""
