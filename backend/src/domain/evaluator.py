"""The invariant evaluator: plain code that decides PASS or FAIL.

Owns: turning stored rows (entitlements, ledger effects, deliveries) into the
counts of the headline table and three invariants:

1. one payment per entitlement  - no entitlement has more than one effect
2. every eligible student paid  - every entitlement has at least one effect
3. budget guard                 - total paid <= the batch budget

The verdict is PASS only if all three hold. It counts *effects* (payments in the
ledger), never deliveries: deliveries are expected to repeat, payments are not.

Must never: perform I/O, or trust a counter maintained elsewhere. Every number
here is recomputed from the rows it is given.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence

from domain.models import (
    Delivery,
    DeliveryOutcome,
    Entitlement,
    InvariantReport,
    InvariantResult,
    LedgerEffect,
    RunSummary,
    Verdict,
)
from domain.money import format_inr

ONE_PAYMENT_PER_ENTITLEMENT = "one_payment_per_entitlement"
EVERY_ELIGIBLE_PAID = "every_eligible_paid"
BUDGET_GUARD = "budget_guard"


def evaluate_run(
    *,
    eligible: Mapping[str, Entitlement],
    effects: Sequence[LedgerEffect],
    deliveries: Sequence[Delivery],
    budget_paise: int,
) -> InvariantReport:
    """Evaluate one run.

    Args:
        eligible: entitlement key -> entitlement, for every entitlement in the batch.
        effects: every ledger effect written for the run.
        deliveries: every recorded delivery for the run.
        budget_paise: the batch budget the run started with.
    """
    payments = Counter(effect.entitlement_key for effect in effects)

    double_paid_keys = sorted(key for key in eligible if payments[key] > 1)
    unpaid_keys = sorted(key for key in eligible if payments[key] == 0)
    paid_once = sum(1 for key in eligible if payments[key] == 1)

    spent_paise = sum(effect.amount_paise for effect in effects)
    # Money that went to a second (third, ...) payment of an already-paid entitlement.
    misallocated_paise = sum(
        eligible[key].amount_paise * (payments[key] - 1) for key in double_paid_keys
    )
    outcomes = Counter(delivery.outcome for delivery in deliveries)

    summary = RunSummary(
        eligible_entitlements=len(eligible),
        deliveries=len(deliveries),
        ledger_effects=len(effects),
        paid_once=paid_once,
        double_paid=len(double_paid_keys),
        unpaid=len(unpaid_keys),
        duplicates_suppressed=outcomes[DeliveryOutcome.DUPLICATE_SUPPRESSED],
        budget_exhausted=outcomes[DeliveryOutcome.BUDGET_EXHAUSTED],
        budget_paise=budget_paise,
        spent_paise=spent_paise,
        misallocated_paise=misallocated_paise,
        double_paid_entitlement_keys=tuple(double_paid_keys),
        unpaid_entitlement_keys=tuple(unpaid_keys),
        double_paid_beneficiary_ids=tuple(
            sorted({eligible[key].beneficiary_id for key in double_paid_keys})
        ),
        unpaid_beneficiary_ids=tuple(sorted({eligible[key].beneficiary_id for key in unpaid_keys})),
    )

    total = len(eligible)
    invariants = (
        InvariantResult(
            invariant_id=ONE_PAYMENT_PER_ENTITLEMENT,
            title="At most one payment per entitlement",
            passed=not double_paid_keys,
            detail=(
                "No entitlement was paid more than once"
                if not double_paid_keys
                else f"{len(double_paid_keys)} of {total} entitlements were paid more than once "
                f"({format_inr(misallocated_paise)} misallocated)"
            ),
        ),
        InvariantResult(
            invariant_id=EVERY_ELIGIBLE_PAID,
            title="Every eligible student paid",
            passed=not unpaid_keys,
            detail=f"{total - len(unpaid_keys)}/{total} eligible entitlements paid",
        ),
        InvariantResult(
            invariant_id=BUDGET_GUARD,
            title="Total paid within budget",
            passed=spent_paise <= budget_paise,
            detail=f"{format_inr(spent_paise)} paid of a {format_inr(budget_paise)} budget",
        ),
    )
    verdict = Verdict.PASS if all(invariant.passed for invariant in invariants) else Verdict.FAIL
    return InvariantReport(summary=summary, invariants=invariants, verdict=verdict)
