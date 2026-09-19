"""In-memory fakes for the processor storage ports.

`InMemoryLedgerStore` mimics the DynamoDB semantics the processors rely on:
the protected commit is all-or-nothing, conditions are checked against committed
state, and each call is atomic (guarded by a lock, like a single DynamoDB request).
It can also inject write conflicts to exercise the retry path.
"""

from __future__ import annotations

import threading
from collections import Counter
from dataclasses import dataclass, field

from domain.models import Delivery, DeliveryOutcome, LedgerEffect
from processors.base import (
    BudgetDebit,
    DeliveryAlreadyRecorded,
    EntitlementAlreadyClaimed,
    InsufficientBudget,
    WriteConflict,
)


@dataclass
class RunState:
    budget_remaining_paise: int
    delivered_count: int = 0
    outcome_counts: Counter[str] = field(default_factory=Counter)


class InMemoryLedgerStore:
    def __init__(self, budgets: dict[str, int], *, conflicts_before_success: int = 0) -> None:
        self.runs = {run_id: RunState(budget) for run_id, budget in budgets.items()}
        self.effects: list[LedgerEffect] = []
        self.deliveries: dict[tuple[str, str], Delivery] = {}
        self.claims: dict[str, LedgerEffect] = {}
        self._lock = threading.Lock()
        self._conflicts_left = conflicts_before_success
        self.conflicts_raised = 0

    def _maybe_conflict(self) -> None:
        if self._conflicts_left > 0:
            self._conflicts_left -= 1
            self.conflicts_raised += 1
            raise WriteConflict("injected TransactionConflict")

    def _count(self, delivery: Delivery) -> None:
        run = self.runs[delivery.run_id]
        run.delivered_count += 1
        run.outcome_counts[delivery.outcome.value] += 1

    # ProtectedLedgerPort
    def commit_payment(
        self, *, idempotency_key: str, effect: LedgerEffect, delivery: Delivery
    ) -> None:
        with self._lock:
            self._maybe_conflict()
            run = self.runs[effect.run_id]
            if (delivery.run_id, delivery.delivery_id) in self.deliveries:
                raise DeliveryAlreadyRecorded()
            if idempotency_key in self.claims:
                raise EntitlementAlreadyClaimed()
            if run.budget_remaining_paise < effect.amount_paise:
                raise InsufficientBudget(run.budget_remaining_paise)
            # All four writes, atomically.
            self.claims[idempotency_key] = effect
            run.budget_remaining_paise -= effect.amount_paise
            self.effects.append(effect)
            self.deliveries[(delivery.run_id, delivery.delivery_id)] = delivery
            self._count(delivery)

    def record_outcome(self, delivery: Delivery) -> None:
        with self._lock:
            self._maybe_conflict()
            if (delivery.run_id, delivery.delivery_id) in self.deliveries:
                raise DeliveryAlreadyRecorded()
            self.deliveries[(delivery.run_id, delivery.delivery_id)] = delivery
            self._count(delivery)

    # VulnerableLedgerPort
    def is_delivery_recorded(self, run_id: str, delivery_id: str) -> bool:
        with self._lock:
            return (run_id, delivery_id) in self.deliveries

    def debit_budget(self, run_id: str, amount_paise: int) -> BudgetDebit:
        with self._lock:
            self._maybe_conflict()
            run = self.runs[run_id]
            if run.budget_remaining_paise < amount_paise:
                return BudgetDebit(
                    accepted=False, budget_remaining_paise=run.budget_remaining_paise
                )
            run.budget_remaining_paise -= amount_paise
            return BudgetDebit(accepted=True, budget_remaining_paise=run.budget_remaining_paise)

    def put_effect(self, effect: LedgerEffect) -> None:
        with self._lock:
            self.effects.append(effect)

    # NaiveLedgerPort
    def is_entitlement_claimed(self, idempotency_key: str) -> bool:
        with self._lock:
            return idempotency_key in self.claims

    def put_claim_unconditionally(self, *, idempotency_key: str, effect: LedgerEffect) -> None:
        with self._lock:
            self.claims[idempotency_key] = effect

    # Helpers for assertions
    def recorded(self, run_id: str) -> list[Delivery]:
        return [delivery for (rid, _), delivery in self.deliveries.items() if rid == run_id]

    def outcomes(self, run_id: str) -> Counter[DeliveryOutcome]:
        return Counter(delivery.outcome for delivery in self.recorded(run_id))
