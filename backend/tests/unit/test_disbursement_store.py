"""CancellationReasons mapping and error translation, with a stubbed DynamoDB client."""

from __future__ import annotations

from typing import Any

import pytest
from botocore.exceptions import ClientError

from adapters.dynamodb.disbursement_store import (
    COMMIT_DELIVERY,
    COMMIT_IDEMPOTENCY,
    COMMIT_LEDGER,
    COMMIT_RUN_BUDGET,
    DynamoDisbursementStore,
    UnexpectedCancellation,
    classify_commit_cancellation,
    classify_record_cancellation,
)
from domain.models import Delivery, DeliveryOutcome, InjectionPhase, LedgerEffect
from processors.base import (
    DeliveryAlreadyRecorded,
    EntitlementAlreadyClaimed,
    InsufficientBudget,
    WriteConflict,
)

NONE = {"Code": "None"}
FAILED = {"Code": "ConditionalCheckFailed"}
CONFLICT = {"Code": "TransactionConflict"}


def _reasons(**codes: dict[str, Any]) -> list[dict[str, Any]]:
    reasons = [NONE, NONE, NONE, NONE]
    positions = {
        "idem": COMMIT_IDEMPOTENCY,
        "run": COMMIT_RUN_BUDGET,
        "ledger": COMMIT_LEDGER,
        "delivery": COMMIT_DELIVERY,
    }
    for name, reason in codes.items():
        reasons[positions[name]] = reason
    return reasons


def test_transaction_items_are_in_the_documented_order() -> None:
    assert (COMMIT_IDEMPOTENCY, COMMIT_RUN_BUDGET, COMMIT_LEDGER, COMMIT_DELIVERY) == (0, 1, 2, 3)


def test_recorded_delivery_wins_over_everything() -> None:
    # A redelivery also fails the idempotency condition; it must not look like a new duplicate.
    assert isinstance(
        classify_commit_cancellation(_reasons(idem=FAILED, delivery=FAILED)),
        DeliveryAlreadyRecorded,
    )


def test_claimed_key_is_a_business_duplicate_even_if_budget_also_fails() -> None:
    result = classify_commit_cancellation(_reasons(idem=FAILED, run=FAILED))
    assert isinstance(result, EntitlementAlreadyClaimed)


def test_budget_failure_reports_the_remaining_budget() -> None:
    run = {
        "Code": "ConditionalCheckFailed",
        "Item": {"run_id": {"S": "r"}, "budget_remaining_paise": {"N": "0"}},
    }
    result = classify_commit_cancellation(_reasons(run=run))
    assert isinstance(result, InsufficientBudget)
    assert result.budget_remaining_paise == 0


def test_budget_failure_without_a_run_item_is_unexpected() -> None:
    assert isinstance(classify_commit_cancellation(_reasons(run=FAILED)), UnexpectedCancellation)


def test_conflict_is_retryable() -> None:
    assert isinstance(classify_commit_cancellation(_reasons(run=CONFLICT)), WriteConflict)


def test_unknown_cancellation_is_not_swallowed() -> None:
    assert isinstance(
        classify_commit_cancellation(_reasons(ledger={"Code": "ValidationError"})),
        UnexpectedCancellation,
    )


def test_record_cancellation_mapping() -> None:
    assert isinstance(classify_record_cancellation([FAILED, NONE]), DeliveryAlreadyRecorded)
    assert isinstance(classify_record_cancellation([NONE, CONFLICT]), WriteConflict)


class _StubClient:
    def __init__(self, error: ClientError | None = None) -> None:
        self.error = error
        self.calls: list[dict[str, Any]] = []

    def transact_write_items(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return {}


def _cancelled(reasons: list[dict[str, Any]]) -> ClientError:
    return ClientError(
        {
            "Error": {"Code": "TransactionCanceledException", "Message": "cancelled"},
            "CancellationReasons": reasons,
        },
        "TransactWriteItems",
    )


def _store(client: _StubClient) -> DynamoDisbursementStore:
    return DynamoDisbursementStore(
        runs_table="runs",
        ledger_table="ledger",
        idempotency_table="idem",
        deliveries_table="deliveries",
        client=client,
    )


EFFECT = LedgerEffect(
    "run_X", "eff-1", "S#STU-1#2026-27#INST-1", "STU-1", 1, 100, "EVT-001", "del-1", "t"
)
DELIVERY = Delivery(
    "run_X",
    "del-1",
    "EVT-001",
    "S#STU-1#2026-27#INST-1",
    "STU-1",
    1,
    InjectionPhase.A,
    1,
    None,
    DeliveryOutcome.COMMITTED,
    "t",
    "req",
    1,
    "eff-1",
)


def test_commit_sends_four_items_with_their_conditions() -> None:
    client = _StubClient()
    _store(client).commit_payment(
        idempotency_key="run_X#S#STU-1#2026-27#INST-1", effect=EFFECT, delivery=DELIVERY
    )
    items = client.calls[0]["TransactItems"]
    assert [next(iter(item)) for item in items] == ["Put", "Update", "Put", "Put"]
    assert items[COMMIT_IDEMPOTENCY]["Put"]["TableName"] == "idem"
    assert (
        items[COMMIT_IDEMPOTENCY]["Put"]["ConditionExpression"] == "attribute_not_exists(idem_key)"
    )
    assert (
        "budget_remaining_paise >= :amount"
        in items[COMMIT_RUN_BUDGET]["Update"]["ConditionExpression"]
    )
    assert items[COMMIT_LEDGER]["Put"]["TableName"] == "ledger"
    assert items[COMMIT_DELIVERY]["Put"]["ConditionExpression"] == "attribute_not_exists(sk)"
    assert items[COMMIT_DELIVERY]["Put"]["Item"]["sk"] == {"S": "DELIVERY#del-1"}


def test_commit_translates_a_cancellation_into_a_typed_outcome() -> None:
    client = _StubClient(_cancelled(_reasons(idem=FAILED)))
    with pytest.raises(EntitlementAlreadyClaimed):
        _store(client).commit_payment(idempotency_key="k", effect=EFFECT, delivery=DELIVERY)


def test_other_client_errors_propagate_unchanged() -> None:
    error = ClientError(
        {"Error": {"Code": "AccessDeniedException", "Message": "no"}}, "TransactWriteItems"
    )
    with pytest.raises(ClientError) as raised:
        _store(_StubClient(error)).commit_payment(
            idempotency_key="k", effect=EFFECT, delivery=DELIVERY
        )
    assert raised.value is error
