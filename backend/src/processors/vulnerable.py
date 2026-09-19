"""The vulnerable processor: deliberately unsafe. Do not copy this design.

It is idempotent only on the *delivery* ID, which is what many real systems
mistake for safety: an exact SQS redelivery (same delivery_id) is absorbed, but a
retry that arrives as a new delivery of the same entitlement is paid again.
With a fixed budget, every duplicate payment is money another eligible student
does not receive.

Steps, each a separate request:
    1. If a Deliveries row exists for this delivery_id -> acknowledge (keeps counts honest)
    2. Conditional UpdateItem on the run: budget >= amount -> subtract it,
       otherwise the outcome is BUDGET_EXHAUSTED
    3. PutItem a ledger effect -> outcome COMMITTED
    4. TransactWriteItems: [Put Deliveries row, Update run delivered_count + 1]

Must never: be "fixed". It exists to be measured against the protected processor.
"""

from __future__ import annotations

from collections.abc import Callable

from common.ids import new_effect_id
from domain.models import Delivery, DeliveryOutcome, DisbursementEvent, LedgerEffect, ProcessorName
from processors.base import (
    DeliveryAlreadyRecorded,
    ProcessingContext,
    ProcessingOutcome,
    ProcessingStatus,
    VulnerableLedgerPort,
    ensure_consistent_entitlement_key,
)
from processors.retry import ConflictRetrier


class VulnerableProcessor:
    name = ProcessorName.VULNERABLE

    def __init__(
        self,
        store: VulnerableLedgerPort,
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

        # Step 1: absorb a genuine SQS redelivery of this exact delivery.
        # INTENTIONALLY UNSAFE: this read and the writes below are separate requests,
        # so two concurrent copies of the same delivery can both pass this check.
        if self._store.is_delivery_recorded(event.run_id, event.delivery_id):
            return ProcessingOutcome(ProcessingStatus.ALREADY_PROCESSED, retrier.attempts)

        # Step 2: debit the budget.
        # INTENTIONALLY UNSAFE: nothing asks "has this *entitlement* already been paid?".
        # A second delivery of the same logical event has a new delivery_id, so it
        # debits the budget again.
        debit = retrier.run(
            lambda _attempt: self._store.debit_budget(event.run_id, event.amount_paise)
        )

        effect_id: str | None = None
        if debit.accepted:
            effect_id = self._effect_id_factory()
            now = context.now()
            # Step 3: write the payment.
            # INTENTIONALLY UNSAFE: the effect is written in a separate request from the
            # budget debit. A crash between them loses money from the budget without
            # recording a payment, and a redelivery afterwards debits it again.
            self._store.put_effect(
                LedgerEffect.for_event(event, effect_id=effect_id, committed_at=now)
            )
            outcome = DeliveryOutcome.COMMITTED
        else:
            outcome = DeliveryOutcome.BUDGET_EXHAUSTED

        def record(attempt: int) -> None:
            self._store.record_outcome(
                Delivery.for_event(
                    event,
                    outcome=outcome,
                    processed_at=context.now(),
                    lambda_request_id=context.lambda_request_id,
                    attempt=attempt,
                    effect_id=effect_id,
                    budget_remaining_paise_at_rejection=(
                        None if debit.accepted else debit.budget_remaining_paise
                    ),
                )
            )

        # Step 4: record the delivery and count it.
        try:
            retrier.run(record)
        except DeliveryAlreadyRecorded:
            # INTENTIONALLY UNSAFE: a concurrent copy of this delivery got here first,
            # but our budget debit and payment above have already happened.
            return ProcessingOutcome(
                ProcessingStatus.ALREADY_PROCESSED, retrier.attempts, effect_id
            )
        return ProcessingOutcome(ProcessingStatus(outcome.value), retrier.attempts, effect_id)
