"""The real processor code against an in-memory store that mimics DynamoDB semantics.

The replay test runs the full two-phase experiment with SQS-like behaviour
(arbitrary order within a phase plus genuine redeliveries) and checks the
headline table for both processors, across many random orders.
"""

from __future__ import annotations

import random
import threading
from collections.abc import Callable
from dataclasses import replace

import pytest

from common.errors import ValidationError
from domain.evaluator import evaluate_run
from domain.idempotency import key_entitlements
from domain.injection import plan_phase
from domain.models import (
    BatchMeta,
    DeliveryOutcome,
    DisbursementEvent,
    Entitlement,
    ExperimentDefinition,
    InjectionPhase,
    ProcessorName,
    Verdict,
)
from processors.base import ProcessingContext, ProcessingStatus, RetriesExhausted
from processors.factory import build_processor
from processors.naive import NaiveProcessor
from processors.protected import ProtectedProcessor
from processors.retry import ConflictRetrier
from tests.unit.fakes import InMemoryLedgerStore

RUN_ID = "run_01J8ZQSIMULATED0000000000"
AMOUNT = 1_000_000


def _no_sleep_retrier() -> ConflictRetrier:
    return ConflictRetrier(sleep=lambda _seconds: None)


def _replay(
    processor_name: ProcessorName,
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
    order_seed: int,
) -> InMemoryLedgerStore:
    store = InMemoryLedgerStore({RUN_ID: batch.total_budget_paise})
    processor = build_processor(processor_name, store, retrier_factory=_no_sleep_retrier)
    context = ProcessingContext("req-sim", clock)
    rng = random.Random(order_seed)
    for phase in (InjectionPhase.A, InjectionPhase.B):
        events = plan_phase(
            run_id=RUN_ID,
            phase=phase,
            definition=definition,
            batch=batch,
            entitlements=entitlements,
        )
        arrivals = events + rng.sample(events, k=4)  # SQS may redeliver the same delivery
        rng.shuffle(arrivals)  # ... and does not preserve order
        for event in arrivals:
            processor.process(event, context)
        # Phase B starts only after every Phase A delivery is recorded.
    return store


@pytest.mark.parametrize("order_seed", range(25))
def test_vulnerable_replay_reproduces_the_headline_numbers(
    order_seed: int,
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = _replay(ProcessorName.VULNERABLE, batch, entitlements, definition, clock, order_seed)
    eligible = key_entitlements(batch.scheme_id, batch.academic_year, entitlements)
    report = evaluate_run(
        eligible=eligible,
        effects=store.effects,
        deliveries=store.recorded(RUN_ID),
        budget_paise=batch.total_budget_paise,
    )
    summary = report.summary

    assert summary.deliveries == 112  # redeliveries were absorbed, not recorded twice
    assert summary.ledger_effects == 100
    assert summary.double_paid == 12
    assert summary.unpaid == 12
    assert summary.duplicates_suppressed == 0
    assert summary.budget_exhausted == 12
    assert summary.misallocated_paise == 12 * AMOUNT
    assert summary.spent_paise == batch.total_budget_paise
    assert report.verdict is Verdict.FAIL
    # The double-paid students are exactly the duplicated logical events...
    duplicated = {f"STU-{int(e[4:]):03d}" for e in definition.duplicated_logical_ids}
    assert set(summary.double_paid_beneficiary_ids) == duplicated
    # ...and the starved ones are Phase B students (which ones depends on arrival order).
    assert duplicated.isdisjoint(summary.unpaid_beneficiary_ids)
    assert store.runs[RUN_ID].delivered_count == 112


@pytest.mark.parametrize("order_seed", range(25))
def test_protected_replay_pays_everyone_exactly_once(
    order_seed: int,
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = _replay(ProcessorName.PROTECTED, batch, entitlements, definition, clock, order_seed)
    eligible = key_entitlements(batch.scheme_id, batch.academic_year, entitlements)
    report = evaluate_run(
        eligible=eligible,
        effects=store.effects,
        deliveries=store.recorded(RUN_ID),
        budget_paise=batch.total_budget_paise,
    )
    summary = report.summary

    assert (summary.deliveries, summary.ledger_effects, summary.paid_once) == (112, 100, 100)
    assert (summary.double_paid, summary.unpaid, summary.budget_exhausted) == (0, 0, 0)
    assert summary.duplicates_suppressed == 12
    assert summary.misallocated_paise == 0
    assert report.verdict is Verdict.PASS
    assert store.runs[RUN_ID].budget_remaining_paise == 0
    assert len(store.claims) == 100


def _event(
    entitlements: list[Entitlement], batch: BatchMeta, definition: ExperimentDefinition
) -> DisbursementEvent:
    events = plan_phase(
        run_id=RUN_ID,
        phase=InjectionPhase.A,
        definition=definition,
        batch=batch,
        entitlements=entitlements,
    )
    return events[0]


def test_protected_absorbs_an_exact_redelivery(
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = InMemoryLedgerStore({RUN_ID: batch.total_budget_paise})
    processor = ProtectedProcessor(store, retrier_factory=_no_sleep_retrier)
    event = _event(entitlements, batch, definition)
    context = ProcessingContext("req", clock)

    assert processor.process(event, context).status is ProcessingStatus.COMMITTED
    assert processor.process(event, context).status is ProcessingStatus.ALREADY_PROCESSED
    assert len(store.effects) == 1
    assert store.runs[RUN_ID].delivered_count == 1  # a redelivery is not a new delivery


def test_protected_suppresses_a_business_duplicate(
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = InMemoryLedgerStore({RUN_ID: batch.total_budget_paise})
    processor = ProtectedProcessor(store, retrier_factory=_no_sleep_retrier)
    first = _event(entitlements, batch, definition)
    retry = replace(
        first, delivery_id="another-delivery-id", copy_index=2, duplicate_of=first.logical_event_id
    )
    context = ProcessingContext("req", clock)

    assert (
        processor.process(retry, context).status is ProcessingStatus.COMMITTED
    )  # arrival order is not send order
    assert processor.process(first, context).status is ProcessingStatus.DUPLICATE_SUPPRESSED
    assert len(store.effects) == 1
    assert store.outcomes(RUN_ID)[DeliveryOutcome.DUPLICATE_SUPPRESSED] == 1


def test_protected_records_budget_exhaustion_with_the_budget_it_saw(
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = InMemoryLedgerStore({RUN_ID: AMOUNT - 1})
    processor = ProtectedProcessor(store, retrier_factory=_no_sleep_retrier)
    outcome = processor.process(
        _event(entitlements, batch, definition), ProcessingContext("req", clock)
    )
    assert outcome.status is ProcessingStatus.BUDGET_EXHAUSTED
    assert not store.effects and not store.claims
    (delivery,) = store.recorded(RUN_ID)
    assert delivery.budget_remaining_paise_at_rejection == AMOUNT - 1


def test_protected_retries_write_conflicts(
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = InMemoryLedgerStore({RUN_ID: batch.total_budget_paise}, conflicts_before_success=3)
    processor = ProtectedProcessor(store, retrier_factory=_no_sleep_retrier)
    outcome = processor.process(
        _event(entitlements, batch, definition), ProcessingContext("req", clock)
    )
    assert outcome.status is ProcessingStatus.COMMITTED
    assert outcome.attempts == 4
    assert store.recorded(RUN_ID)[0].attempt == 4
    assert len(store.effects) == 1


def test_protected_gives_up_after_six_conflicting_attempts(
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = InMemoryLedgerStore({RUN_ID: batch.total_budget_paise}, conflicts_before_success=6)
    processor = ProtectedProcessor(store, retrier_factory=_no_sleep_retrier)
    with pytest.raises(RetriesExhausted):
        processor.process(_event(entitlements, batch, definition), ProcessingContext("req", clock))
    assert not store.effects and not store.deliveries  # nothing half-written; SQS will redeliver


def test_vulnerable_pays_a_business_duplicate_twice(
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = InMemoryLedgerStore({RUN_ID: batch.total_budget_paise})
    processor = build_processor(ProcessorName.VULNERABLE, store, retrier_factory=_no_sleep_retrier)
    first = _event(entitlements, batch, definition)
    retry = replace(
        first, delivery_id="another-delivery-id", copy_index=2, duplicate_of=first.logical_event_id
    )
    context = ProcessingContext("req", clock)

    assert processor.process(first, context).status is ProcessingStatus.COMMITTED
    assert processor.process(first, context).status is ProcessingStatus.ALREADY_PROCESSED
    assert processor.process(retry, context).status is ProcessingStatus.COMMITTED
    assert len(store.effects) == 2


def test_inconsistent_entitlement_key_is_rejected(
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = InMemoryLedgerStore({RUN_ID: batch.total_budget_paise})
    tampered = replace(
        _event(entitlements, batch, definition),
        entitlement_key="DEMO-POSTMATRIC#STU-999#2026-27#INST-1",
    )
    with pytest.raises(ValidationError):
        ProtectedProcessor(store).process(tampered, ProcessingContext("req", clock))
    assert not store.effects


def _race(
    processor_factory: Callable[[InMemoryLedgerStore], object],
    copies: int,
    clock: Callable[[], str],
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
) -> InMemoryLedgerStore:
    """`copies` distinct deliveries of one entitlement, started at the same instant."""
    store = InMemoryLedgerStore({RUN_ID: copies * AMOUNT})
    processor = processor_factory(store)
    base = _event(entitlements, batch, definition)
    barrier = threading.Barrier(copies)
    errors: list[BaseException] = []

    def worker(index: int) -> None:
        try:
            barrier.wait()
            processor.process(
                replace(base, delivery_id=f"race-{index}"), ProcessingContext(f"req-{index}", clock)
            )  # type: ignore[attr-defined]
        except BaseException as error:  # surfaced below
            errors.append(error)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(copies)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    assert not errors
    return store


def test_protected_allows_exactly_one_payment_under_concurrency(
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = _race(
        lambda s: ProtectedProcessor(s, retrier_factory=_no_sleep_retrier),
        20,
        clock,
        batch,
        entitlements,
        definition,
    )
    assert len(store.effects) == 1
    assert store.outcomes(RUN_ID)[DeliveryOutcome.DUPLICATE_SUPPRESSED] == 19


def test_naive_check_then_write_pays_more_than_once_under_concurrency(
    batch: BatchMeta,
    entitlements: list[Entitlement],
    definition: ExperimentDefinition,
    clock: Callable[[], str],
) -> None:
    store = _race(
        lambda s: NaiveProcessor(s, race_window_seconds=0.05, retrier_factory=_no_sleep_retrier),
        20,
        clock,
        batch,
        entitlements,
        definition,
    )
    assert len(store.effects) > 1  # every copy passed the check before any copy wrote the claim
