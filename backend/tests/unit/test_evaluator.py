"""The evaluator on hand-built ledgers."""

from __future__ import annotations

from domain.evaluator import BUDGET_GUARD, EVERY_ELIGIBLE_PAID, ONE_PAYMENT_PER_ENTITLEMENT, evaluate_run
from domain.idempotency import key_entitlements
from domain.models import (
    Delivery,
    DeliveryOutcome,
    Entitlement,
    InjectionPhase,
    InvariantReport,
    LedgerEffect,
    Verdict,
)

SCHEME, YEAR, RUN = "DEMO-POSTMATRIC", "2026-27", "run_TEST"
AMOUNT = 1_000_000


def _effect(key: str, entitlement: Entitlement, n: int) -> LedgerEffect:
    return LedgerEffect(RUN, f"eff-{n}", key, entitlement.beneficiary_id, entitlement.installment,
                        entitlement.amount_paise, f"EVT-{n}", f"del-{n}", "2026-09-19T08:00:00.000Z")


def _delivery(key: str, entitlement: Entitlement, n: int, outcome: DeliveryOutcome) -> Delivery:
    return Delivery(RUN, f"del-{n}", f"EVT-{n}", key, entitlement.beneficiary_id, entitlement.installment,
                    InjectionPhase.A, 1, None, outcome, "2026-09-19T08:00:00.000Z", "req", 1)


def _build(entitlements: list[Entitlement], payments: dict[str, int], rejected: set[str], suppressed: dict[str, int]
           ) -> InvariantReport:
    eligible = key_entitlements(SCHEME, YEAR, entitlements)
    effects, deliveries, n = [], [], 0
    for key, entitlement in eligible.items():
        for _ in range(payments.get(key, 0)):
            n += 1
            effects.append(_effect(key, entitlement, n))
            deliveries.append(_delivery(key, entitlement, n, DeliveryOutcome.COMMITTED))
        for _ in range(suppressed.get(key, 0)):
            n += 1
            deliveries.append(_delivery(key, entitlement, n, DeliveryOutcome.DUPLICATE_SUPPRESSED))
        if key in rejected:
            n += 1
            deliveries.append(_delivery(key, entitlement, n, DeliveryOutcome.BUDGET_EXHAUSTED))
    budget = sum(e.amount_paise for e in entitlements)
    return evaluate_run(eligible=eligible, effects=effects, deliveries=deliveries, budget_paise=budget)


def _invariant(report: InvariantReport, invariant_id: str) -> bool:
    return next(i.passed for i in report.invariants if i.invariant_id == invariant_id)


def test_vulnerable_pattern_fails_with_twelve_double_paid_and_twelve_unpaid(entitlements: list[Entitlement]) -> None:
    keys = list(key_entitlements(SCHEME, YEAR, entitlements))
    doubled, starved = keys[:12], keys[-12:]
    payments = {key: 1 for key in keys}
    payments.update({key: 2 for key in doubled})
    payments.update({key: 0 for key in starved})

    report = _build(entitlements, payments, rejected=set(starved), suppressed={})
    summary = report.summary

    assert report.verdict is Verdict.FAIL
    assert summary.deliveries == 112
    assert summary.ledger_effects == 100
    assert summary.double_paid == 12
    assert summary.unpaid == 12
    assert summary.paid_once == 76
    assert summary.budget_exhausted == 12
    assert summary.duplicates_suppressed == 0
    assert summary.misallocated_paise == 12 * AMOUNT
    assert summary.spent_paise == summary.budget_paise == 100 * AMOUNT
    assert not _invariant(report, ONE_PAYMENT_PER_ENTITLEMENT)
    assert not _invariant(report, EVERY_ELIGIBLE_PAID)
    assert _invariant(report, BUDGET_GUARD)  # the budget held; the money went to the wrong students
    assert next(i.detail for i in report.invariants if i.invariant_id == EVERY_ELIGIBLE_PAID) == (
        "88/100 eligible entitlements paid"
    )
    assert summary.double_paid_beneficiary_ids == tuple(f"STU-{n:03d}" for n in range(1, 13))
    assert summary.unpaid_beneficiary_ids == tuple(f"STU-{n:03d}" for n in range(89, 101))


def test_protected_pattern_passes(entitlements: list[Entitlement]) -> None:
    keys = list(key_entitlements(SCHEME, YEAR, entitlements))
    report = _build(entitlements, {key: 1 for key in keys}, rejected=set(), suppressed={k: 1 for k in keys[:12]})
    summary = report.summary

    assert report.verdict is Verdict.PASS
    assert (summary.deliveries, summary.ledger_effects, summary.paid_once) == (112, 100, 100)
    assert (summary.double_paid, summary.unpaid, summary.budget_exhausted) == (0, 0, 0)
    assert summary.duplicates_suppressed == 12
    assert summary.misallocated_paise == 0
    assert all(invariant.passed for invariant in report.invariants)


def test_installments_of_the_same_student_are_counted_separately() -> None:
    entitlements = [Entitlement("STU-001", "Aarav Iyer", AMOUNT, 1), Entitlement("STU-001", "Aarav Iyer", AMOUNT, 2)]
    keys = list(key_entitlements(SCHEME, YEAR, entitlements))

    report = _build(entitlements, {keys[0]: 1, keys[1]: 1}, rejected=set(), suppressed={})
    assert report.verdict is Verdict.PASS  # one payment per installment is correct, not a double payment

    report = _build(entitlements, {keys[0]: 2, keys[1]: 0}, rejected=set(), suppressed={})
    assert report.verdict is Verdict.FAIL
    assert report.summary.double_paid_entitlement_keys == (keys[0],)
    assert report.summary.unpaid_entitlement_keys == (keys[1],)


def test_budget_guard_fails_when_more_is_paid_than_budgeted() -> None:
    entitlements = [Entitlement("STU-001", "A", AMOUNT, 1)]
    eligible = key_entitlements(SCHEME, YEAR, entitlements)
    key, entitlement = next(iter(eligible.items()))
    effects = [_effect(key, entitlement, 1), _effect(key, entitlement, 2)]
    report = evaluate_run(eligible=eligible, effects=effects, deliveries=[], budget_paise=AMOUNT)
    assert not _invariant(report, BUDGET_GUARD)
    assert report.verdict is Verdict.FAIL


def test_triple_payment_counts_two_misallocated_amounts() -> None:
    entitlements = [Entitlement("STU-001", "A", AMOUNT, 1), Entitlement("STU-002", "B", AMOUNT, 1)]
    keys = list(key_entitlements(SCHEME, YEAR, entitlements))
    report = _build(entitlements, {keys[0]: 3}, rejected=set(), suppressed={})
    assert report.summary.misallocated_paise == 2 * AMOUNT
    assert report.summary.double_paid == 1
