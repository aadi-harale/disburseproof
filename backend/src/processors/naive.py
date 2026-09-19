"""The naive processor: the check-then-write anti-pattern. Race Lab only.

It *looks* idempotent: it reads the idempotency record first and skips the
payment if one exists. But the read and the writes are separate requests. Two
deliveries of the same entitlement that run concurrently can both read "absent"
before either writes, and both pay. The race window is widened on purpose
(`race_window_seconds`, shown in the UI as "injected race window") so the Race
Lab can show the failure reliably; in production the window is smaller, which
makes the bug rarer, not absent.

Must never: be used by the duplicate-delivery experiment. Runs created through
POST /runs accept only the vulnerable and protected processors.
"""

from __future__ import annotations

import time
from collections.abc import Callable

from common.ids import new_effect_id
from domain.idempotency import idempotency_key_for
from domain.models import Delivery, DeliveryOutcome, DisbursementEvent, LedgerEffect, ProcessorName
from processors.base import (
    DeliveryAlreadyRecorded,
    NaiveLedgerPort,
    ProcessingContext,
    ProcessingOutcome,
    ProcessingStatus,
    ensure_consistent_entitlement_key,
)
from processors.retry import ConflictRetrier

DEFAULT_RACE_WINDOW_SECONDS = 0.2


class NaiveProcessor:
    name = ProcessorName.NAIVE

    def __init__(
        self,
        store: NaiveLedgerPort,
        *,
        race_window_seconds: float = DEFAULT_RACE_WINDOW_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
        retrier_factory: Callable[[], ConflictRetrier] = ConflictRetrier,
        effect_id_factory: Callable[[], str] = new_effect_id,
    ) -> None:
        self._store = store
        self._race_window_seconds = race_window_seconds
        self._sleep = sleep
        self._retrier_factory = retrier_factory
        self._effect_id_factory = effect_id_factory

    def process(self, event: DisbursementEvent, context: ProcessingContext) -> ProcessingOutcome:
        ensure_consistent_entitlement_key(event)
        retrier = self._retrier_factory()
        if self._store.is_delivery_recorded(event.run_id, event.delivery_id):
            return ProcessingOutcome(ProcessingStatus.ALREADY_PROCESSED, retrier.attempts)

        idempotency_key = idempotency_key_for(event.run_id, event.entitlement_key)
        # INTENTIONALLY UNSAFE: check-then-write. This read is a separate request from
        # the writes below; another delivery can pass the same check before we write.
        if self._store.is_entitlement_claimed(idempotency_key):
            return self._record(event, context, retrier, DeliveryOutcome.DUPLICATE_SUPPRESSED, None, None)

        # INTENTIONALLY UNSAFE: an injected race window between the check and the write,
        # standing in for a slow network call or a GC pause.
        self._sleep(self._race_window_seconds)

        debit = retrier.run(lambda _attempt: self._store.debit_budget(event.run_id, event.amount_paise))
        if not debit.accepted:
            return self._record(
                event, context, retrier, DeliveryOutcome.BUDGET_EXHAUSTED, None, debit.budget_remaining_paise
            )

        effect_id = self._effect_id_factory()
        effect = LedgerEffect.for_event(event, effect_id=effect_id, committed_at=context.now())
        self._store.put_effect(effect)
        # INTENTIONALLY UNSAFE: the claim is written without a condition, after the
        # payment. It records the payment; it does not prevent a concurrent one.
        self._store.put_claim_unconditionally(idempotency_key=idempotency_key, effect=effect)
        return self._record(event, context, retrier, DeliveryOutcome.COMMITTED, effect_id, None)

    def _record(
        self,
        event: DisbursementEvent,
        context: ProcessingContext,
        retrier: ConflictRetrier,
        outcome: DeliveryOutcome,
        effect_id: str | None,
        budget_remaining_paise: int | None,
    ) -> ProcessingOutcome:
        def record(attempt: int) -> None:
            self._store.record_outcome(
                Delivery.for_event(
                    event,
                    outcome=outcome,
                    processed_at=context.now(),
                    lambda_request_id=context.lambda_request_id,
                    attempt=attempt,
                    effect_id=effect_id,
                    budget_remaining_paise_at_rejection=budget_remaining_paise,
                )
            )

        try:
            retrier.run(record)
        except DeliveryAlreadyRecorded:
            return ProcessingOutcome(ProcessingStatus.ALREADY_PROCESSED, retrier.attempts, effect_id)
        return ProcessingOutcome(ProcessingStatus(outcome.value), retrier.attempts, effect_id)
