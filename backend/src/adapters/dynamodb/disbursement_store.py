"""DynamoDB implementation of the processor storage ports.

Owns: every write a processor makes, including the protected processor's
four-item TransactWriteItems, and the translation of DynamoDB errors and
cancellation reasons into the typed outcomes in processors/base.py.
Must never: decide what an outcome means for the business. It reports what
DynamoDB said; the processor decides.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from botocore.exceptions import ClientError

from adapters.dynamodb.client import dynamodb_client, error_code, from_item, key, to_item
from adapters.dynamodb.items import claim_to_row, delivery_sort_key, delivery_to_row, effect_to_row
from domain.models import Delivery, DeliveryOutcome, LedgerEffect
from processors.base import (
    BudgetDebit,
    DeliveryAlreadyRecorded,
    EntitlementAlreadyClaimed,
    InsufficientBudget,
    WriteConflict,
)

# CancellationReasons is a list aligned by index with TransactItems: reason[i]
# describes item i. These constants are the single source of truth for that
# alignment; the builders below place items at exactly these positions.
COMMIT_IDEMPOTENCY = 0  # Put Idempotency record, condition attribute_not_exists(idem_key)
COMMIT_RUN_BUDGET = 1  # Update Run: budget >= amount -> debit; count the delivery
COMMIT_LEDGER = 2  # Put Ledger effect
COMMIT_DELIVERY = 3  # Put Deliveries row, condition attribute_not_exists(sk)

RECORD_DELIVERY = 0  # Put Deliveries row, condition attribute_not_exists(sk)
RECORD_RUN_COUNTER = 1  # Update Run: count the delivery and its outcome

CONDITION_FAILED = "ConditionalCheckFailed"
# Cancellation codes that mean "contention, nothing written, try again".
TRANSIENT_CANCELLATION_CODES = frozenset(
    {"TransactionConflict", "ThrottlingError", "ProvisionedThroughputExceeded", "RequestLimitExceeded"}
)
# Error codes on single-item requests that mean the same thing.
TRANSIENT_ERROR_CODES = frozenset(
    {
        "TransactionConflictException",
        "ProvisionedThroughputExceededException",
        "ThrottlingException",
        "RequestLimitExceeded",
    }
)

OUTCOME_COUNTER = {
    DeliveryOutcome.COMMITTED: "committed_count",
    DeliveryOutcome.DUPLICATE_SUPPRESSED: "suppressed_count",
    DeliveryOutcome.BUDGET_EXHAUSTED: "budget_exhausted_count",
}


class UnexpectedCancellation(RuntimeError):
    """DynamoDB cancelled a transaction for a reason we do not handle. Not retried in-process."""


def _codes(reasons: Sequence[Mapping[str, Any]]) -> list[str]:
    return [str(reason.get("Code", "None")) for reason in reasons]


def _remaining_budget(reason: Mapping[str, Any]) -> int | None:
    # With ReturnValuesOnConditionCheckFailure=ALL_OLD, DynamoDB returns the Run
    # item as it was when the condition failed, so we can record what we saw.
    item = reason.get("Item")
    if not item or "budget_remaining_paise" not in item:
        return None
    return int(from_item(item)["budget_remaining_paise"])


def classify_commit_cancellation(reasons: Sequence[Mapping[str, Any]]) -> Exception:
    """Map a cancelled protected commit to exactly one typed outcome.

    Precedence matters when several conditions fail at once:
      1. Deliveries row exists -> DeliveryAlreadyRecorded (SQS redelivery; ack)
      2. Idempotency exists    -> EntitlementAlreadyClaimed (business duplicate)
      3. Budget condition      -> InsufficientBudget
      4. Contention            -> WriteConflict (retry)
    A redelivered delivery also fails the idempotency condition, so the delivery
    check must come first or a redelivery would be recorded as a new duplicate.
    """
    codes = _codes(reasons)

    def failed(index: int) -> bool:
        return index < len(codes) and codes[index] == CONDITION_FAILED

    if failed(COMMIT_DELIVERY):
        return DeliveryAlreadyRecorded()
    if failed(COMMIT_IDEMPOTENCY):
        return EntitlementAlreadyClaimed()
    if failed(COMMIT_RUN_BUDGET):
        remaining = _remaining_budget(reasons[COMMIT_RUN_BUDGET])
        if remaining is None:
            # The condition also requires the Run to exist. No Item means no Run.
            return UnexpectedCancellation("run record not found while committing a payment")
        return InsufficientBudget(remaining)
    if any(code in TRANSIENT_CANCELLATION_CODES for code in codes):
        return WriteConflict(f"transaction cancelled: {codes}")
    return UnexpectedCancellation(f"transaction cancelled: {codes}")


def classify_record_cancellation(reasons: Sequence[Mapping[str, Any]]) -> Exception:
    codes = _codes(reasons)
    if len(codes) > RECORD_DELIVERY and codes[RECORD_DELIVERY] == CONDITION_FAILED:
        return DeliveryAlreadyRecorded()
    if any(code in TRANSIENT_CANCELLATION_CODES for code in codes):
        return WriteConflict(f"transaction cancelled: {codes}")
    return UnexpectedCancellation(f"transaction cancelled: {codes}")


class DynamoDisbursementStore:
    """Implements ProtectedLedgerPort, VulnerableLedgerPort and NaiveLedgerPort."""

    def __init__(
        self,
        *,
        runs_table: str,
        ledger_table: str,
        idempotency_table: str,
        deliveries_table: str,
        client: Any | None = None,
    ) -> None:
        self._runs = runs_table
        self._ledger = ledger_table
        self._idempotency = idempotency_table
        self._deliveries = deliveries_table
        self._client = client or dynamodb_client()

    # --- Protected --------------------------------------------------------------

    def commit_payment(self, *, idempotency_key: str, effect: LedgerEffect, delivery: Delivery) -> None:
        items: list[dict[str, Any]] = [{}, {}, {}, {}]
        items[COMMIT_IDEMPOTENCY] = {
            "Put": {
                "TableName": self._idempotency,
                "Item": to_item(claim_to_row(idempotency_key, effect)),
                "ConditionExpression": "attribute_not_exists(idem_key)",
            }
        }
        items[COMMIT_RUN_BUDGET] = {
            "Update": {
                "TableName": self._runs,
                "Key": key(run_id=effect.run_id),
                "UpdateExpression": (
                    "SET budget_remaining_paise = budget_remaining_paise - :amount, "
                    "last_delivery_at = :now "
                    "ADD delivered_count :one, committed_count :one"
                ),
                "ConditionExpression": "attribute_exists(run_id) AND budget_remaining_paise >= :amount",
                "ExpressionAttributeValues": {
                    ":amount": {"N": str(effect.amount_paise)},
                    ":one": {"N": "1"},
                    ":now": {"S": delivery.processed_at},
                },
                "ReturnValuesOnConditionCheckFailure": "ALL_OLD",
            }
        }
        items[COMMIT_LEDGER] = {"Put": {"TableName": self._ledger, "Item": to_item(effect_to_row(effect))}}
        items[COMMIT_DELIVERY] = {
            "Put": {
                "TableName": self._deliveries,
                "Item": to_item(delivery_to_row(delivery)),
                "ConditionExpression": "attribute_not_exists(sk)",
            }
        }
        try:
            # boto3 fills ClientRequestToken automatically, so the SDK's own retry of
            # this call is idempotent within DynamoDB's 10-minute token window.
            self._client.transact_write_items(TransactItems=items)
        except ClientError as error:
            translated = self._translate(error, classify_commit_cancellation)
            if translated is error:
                raise
            raise translated from error

    # --- Shared by every processor --------------------------------------------

    def record_outcome(self, delivery: Delivery) -> None:
        items: list[dict[str, Any]] = [{}, {}]
        items[RECORD_DELIVERY] = {
            "Put": {
                "TableName": self._deliveries,
                "Item": to_item(delivery_to_row(delivery)),
                "ConditionExpression": "attribute_not_exists(sk)",
            }
        }
        items[RECORD_RUN_COUNTER] = {
            "Update": {
                "TableName": self._runs,
                "Key": key(run_id=delivery.run_id),
                "UpdateExpression": "SET last_delivery_at = :now ADD delivered_count :one, #counter :one",
                "ConditionExpression": "attribute_exists(run_id)",
                "ExpressionAttributeNames": {"#counter": OUTCOME_COUNTER[delivery.outcome]},
                "ExpressionAttributeValues": {":one": {"N": "1"}, ":now": {"S": delivery.processed_at}},
            }
        }
        try:
            self._client.transact_write_items(TransactItems=items)
        except ClientError as error:
            translated = self._translate(error, classify_record_cancellation)
            if translated is error:
                raise
            raise translated from error

    def is_delivery_recorded(self, run_id: str, delivery_id: str) -> bool:
        response = self._client.get_item(
            TableName=self._deliveries,
            Key=key(run_id=run_id, sk=delivery_sort_key(delivery_id)),
            ConsistentRead=True,
            ProjectionExpression="run_id",
        )
        return "Item" in response

    # --- Vulnerable and naive -------------------------------------------------

    def debit_budget(self, run_id: str, amount_paise: int) -> BudgetDebit:
        try:
            response = self._client.update_item(
                TableName=self._runs,
                Key=key(run_id=run_id),
                UpdateExpression="SET budget_remaining_paise = budget_remaining_paise - :amount",
                ConditionExpression="attribute_exists(run_id) AND budget_remaining_paise >= :amount",
                ExpressionAttributeValues={":amount": {"N": str(amount_paise)}},
                ReturnValues="UPDATED_NEW",
                ReturnValuesOnConditionCheckFailure="ALL_OLD",
            )
        except ClientError as error:
            code = error_code(error)
            if code == "ConditionalCheckFailedException":
                remaining = _remaining_budget(error.response)
                if remaining is None:
                    raise UnexpectedCancellation("run record not found while debiting budget") from error
                return BudgetDebit(accepted=False, budget_remaining_paise=remaining)
            if code in TRANSIENT_ERROR_CODES:
                raise WriteConflict(code) from error
            raise
        remaining = from_item(response["Attributes"])["budget_remaining_paise"]
        return BudgetDebit(accepted=True, budget_remaining_paise=int(remaining))

    def put_effect(self, effect: LedgerEffect) -> None:
        self._put(self._ledger, effect_to_row(effect))

    def is_entitlement_claimed(self, idempotency_key: str) -> bool:
        response = self._client.get_item(
            TableName=self._idempotency,
            Key=key(idem_key=idempotency_key),
            ConsistentRead=True,
            ProjectionExpression="idem_key",
        )
        return "Item" in response

    def put_claim_unconditionally(self, *, idempotency_key: str, effect: LedgerEffect) -> None:
        self._put(self._idempotency, claim_to_row(idempotency_key, effect))

    # --- Helpers --------------------------------------------------------------

    def _put(self, table: str, row: Mapping[str, object]) -> None:
        try:
            self._client.put_item(TableName=table, Item=to_item(row))
        except ClientError as error:
            if error_code(error) in TRANSIENT_ERROR_CODES:
                raise WriteConflict(error_code(error)) from error
            raise

    @staticmethod
    def _translate(error: ClientError, classify: Any) -> Exception:
        code = error_code(error)
        if code == "TransactionCanceledException":
            result: Exception = classify(error.response.get("CancellationReasons", []))
            return result
        if code in TRANSIENT_ERROR_CODES:
            return WriteConflict(code)
        return error
