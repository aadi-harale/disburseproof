"""Per-student state for the live grid and the drill-down.

Owns: the rule that turns an entitlement's payments and deliveries into
paid_once | paid_twice | unpaid | pending.
Must never: perform I/O.

`unpaid` is only shown when it is certain: either the run has been evaluated, or
a delivery for this entitlement was already refused for lack of budget (no other
delivery can pay it later in this experiment). Otherwise a student with no
payment yet is `pending`.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from collections.abc import Mapping, Sequence

from domain.models import (
    Delivery,
    DeliveryOutcome,
    Entitlement,
    LedgerEffect,
    StudentState,
    StudentView,
)


def state_for(payments: int, *, rejected_for_budget: bool, run_evaluated: bool) -> StudentState:
    if payments >= 2:
        return StudentState.PAID_TWICE
    if payments == 1:
        return StudentState.PAID_ONCE
    if run_evaluated or rejected_for_budget:
        return StudentState.UNPAID
    return StudentState.PENDING


def derive_student_views(
    *,
    eligible: Mapping[str, Entitlement],
    effects: Sequence[LedgerEffect],
    deliveries: Sequence[Delivery],
    run_evaluated: bool,
) -> list[StudentView]:
    """One view per entitlement, in canonical (beneficiary, installment) order."""
    payments = Counter(effect.entitlement_key for effect in effects)
    delivery_count = Counter(delivery.entitlement_key for delivery in deliveries)
    rejected: defaultdict[str, bool] = defaultdict(bool)
    for delivery in deliveries:
        if delivery.outcome is DeliveryOutcome.BUDGET_EXHAUSTED:
            rejected[delivery.entitlement_key] = True

    views = [
        StudentView(
            entitlement_key=key,
            beneficiary_id=entitlement.beneficiary_id,
            display_name=entitlement.display_name,
            installment=entitlement.installment,
            amount_paise=entitlement.amount_paise,
            state=state_for(
                payments[key], rejected_for_budget=rejected[key], run_evaluated=run_evaluated
            ),
            payments=payments[key],
            deliveries=delivery_count[key],
        )
        for key, entitlement in eligible.items()
    ]
    return sorted(views, key=lambda view: (view.beneficiary_id, view.installment))
