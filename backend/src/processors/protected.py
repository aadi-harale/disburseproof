"""The protected processor: one atomic DynamoDB transaction per payment.

Why a single TransactWriteItems (docs/adr/0002-transactional-idempotency.md):
the four writes that make a payment real commit together or not at all:

    1. Put the Idempotency record   (condition: the key does not exist yet)
    2. Update the Run               (condition: remaining budget >= amount; debit it, count the delivery)
    3. Put the Ledger effect        (the payment itself)
    4. Put the Deliveries row       (condition: this delivery_id is not recorded yet)

Because the business effect and its idempotency record commit atomically, a
Lambda crash, timeout or SQS redelivery at any instant leaves either no trace at
all or a complete, recorded payment. A key can never be "claimed but unpaid" or
"paid but unclaimed". A check-then-write design (read the key, then write) has a
window between the read and the write in which two concurrent deliveries both
see "not paid" and both pay; the naive processor in the Race Lab shows that.

When DynamoDB cancels the transaction, the adapter reads CancellationReasons and
raises one typed exception. This processor handles them in this order:

    DeliveryAlreadyRecorded   -> this exact delivery was processed before (SQS
                                 redelivery): acknowledge and write nothing
    EntitlementAlreadyClaimed -> a business duplicate: record DUPLICATE_SUPPRESSED
    InsufficientBudget        -> record BUDGET_EXHAUSTED
    WriteConflict             -> transient contention: retry with backoff

Must never: write the effect outside the transaction, or retry a failed condition.
"""

from __future__ import annotations

from collections.abc import Callable

from common.ids import new_effect_id
from domain.idempotency import idempotency_key_for
from domain.models import Delivery, DeliveryOutcome, DisbursementEvent, LedgerEffect, ProcessorName
from processors.base import (
    DeliveryAlreadyRecorded,
    EntitlementAlreadyClaimed,
    InsufficientBudget,
    ProcessingContext,
    ProcessingOutcome,
    ProcessingStatus,
    ProtectedLedgerPort,
    ensure_consistent_entitlement_key,
)
from processors.retry import ConflictRetrier


class ProtectedProcessor:
    name = ProcessorName.PROTECTED

    def __init__(
        self,
        store: ProtectedLedgerPort,
        *,
        retrier_factory: Callable[[], ConflictRetrier] = ConflictRetrier,
        effect_id_factory: Callable[[], str] = new_effect_id,
    ) -> None:
        self._store = store
        self._retrier_factory = retrier_factory
        self._effect_id_factory = effect_id_factory

    def process(self, event: DisbursementEvent, context: ProcessingContext) -> ProcessingOutcome:
        ensure_consistent_entitlement_key(event)
        retrier = self._retrier_factory()
        idempotency_key = idempotency_key_for(event.run_id, event.entitlement_key)
        effect_id = self._effect_id_factory()

        def commit(attempt: int) -> None:
            now = context.now()
            self._store.commit_payment(
                idempotency_key=idempotency_key,
                effect=LedgerEffect.for_event(event, effect_id=effect_id, committed_at=now),
                delivery=Delivery.for_event(
                    event,
                    outcome=DeliveryOutcome.COMMITTED,
                    processed_at=now,
                    lambda_request_id=context.lambda_request_id,
                    attempt=attempt,
                    effect_id=effect_id,
                ),
            )

        try:
            retrier.run(commit)
        except DeliveryAlreadyRecorded:
            return ProcessingOutcome(ProcessingStatus.ALREADY_PROCESSED, retrier.attempts)
        except EntitlementAlreadyClaimed:
            return self._record(event, context, retrier, DeliveryOutcome.DUPLICATE_SUPPRESSED, None)
        except InsufficientBudget as rejection:
            return self._record(
                event,
                context,
                retrier,
                DeliveryOutcome.BUDGET_EXHAUSTED,
                rejection.budget_remaining_paise,
            )
        return ProcessingOutcome(ProcessingStatus.COMMITTED, retrier.attempts, effect_id)

    def _record(
        self,
        event: DisbursementEvent,
        context: ProcessingContext,
        retrier: ConflictRetrier,
        outcome: DeliveryOutcome,
        budget_remaining_paise: int | None,
    ) -> ProcessingOutcome:
        """Second transaction: write the Deliveries row and count the delivery, nothing else."""

        def record(attempt: int) -> None:
            self._store.record_outcome(
                Delivery.for_event(
                    event,
                    outcome=outcome,
                    processed_at=context.now(),
                    lambda_request_id=context.lambda_request_id,
                    attempt=attempt,
                    budget_remaining_paise_at_rejection=budget_remaining_paise,
                )
            )

        try:
            retrier.run(record)
        except DeliveryAlreadyRecorded:
            # A concurrent copy of this same delivery recorded it first.
            return ProcessingOutcome(ProcessingStatus.ALREADY_PROCESSED, retrier.attempts)
        return ProcessingOutcome(ProcessingStatus(outcome.value), retrier.attempts)
