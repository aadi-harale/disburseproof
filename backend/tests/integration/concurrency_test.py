"""Protected-path concurrency check against the deployed worker Lambda.

Usage:
    python tests/integration/concurrency_test.py --stack disburseproof-dev [--copies 20] [--processor protected]

Creates an isolated test run directly in the Runs table (hidden from the runs
list), then invokes the worker Lambda `copies` times in parallel, each with a
*different* delivery of the *same* entitlement. For the protected processor it
asserts exactly one ledger effect, `copies - 1` suppressed duplicates and one
budget debit. `--processor naive` runs the check-then-write anti-pattern instead
and reports how many payments it made (that number can vary between attempts).

Note: accounts with a low Lambda concurrency quota throttle some of the parallel
invocations; boto3 retries them, which reduces how many truly overlap.
"""

from __future__ import annotations

import argparse
import json
import sys
import threading
import time
import uuid
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

import boto3
from botocore.config import Config

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src"))

from common.ids import new_run_id
from domain.demo_data import DEMO_ACADEMIC_YEAR, DEMO_AMOUNT_PAISE, DEMO_SCHEME_ID
from domain.idempotency import build_entitlement_key, idempotency_key_for
from domain.models import DisbursementEvent, InjectionPhase


def outputs(stack: str, region: str) -> dict[str, str]:
    raw = boto3.client("cloudformation", region_name=region).describe_stacks(StackName=stack)[
        "Stacks"
    ][0]["Outputs"]
    return {o["OutputKey"]: o["OutputValue"] for o in raw}


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--stack", default="disburseproof-dev")
    parser.add_argument("--region", default="ap-south-1")
    parser.add_argument("--copies", type=int, default=20)
    parser.add_argument("--processor", choices=["protected", "naive"], default="protected")
    args = parser.parse_args()

    stack = outputs(args.stack, args.region)
    dynamodb = boto3.client("dynamodb", region_name=args.region)
    lambda_client = boto3.client(
        "lambda",
        region_name=args.region,
        config=Config(
            max_pool_connections=args.copies, retries={"mode": "standard", "max_attempts": 8}
        ),
    )

    run_id = new_run_id()
    budget = (
        args.copies * DEMO_AMOUNT_PAISE
    )  # enough for every copy: only idempotency may stop a payment
    now = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    # No entity_type attribute: the sparse index behind GET /runs does not list this test run.
    dynamodb.put_item(
        TableName=stack["RunsTableName"],
        Item={
            "run_id": {"S": run_id},
            "processor": {"S": args.processor},
            "status": {"S": "RUNNING"},
            "phase": {"S": "PHASE_A"},
            "budget_remaining_paise": {"N": str(budget)},
            "total_budget_paise": {"N": str(budget)},
            "delivered_count": {"N": "0"},
            "committed_count": {"N": "0"},
            "suppressed_count": {"N": "0"},
            "budget_exhausted_count": {"N": "0"},
            "created_at": {"S": now},
            "race_window_ms": {"N": "200"},
            "purpose": {"S": "concurrency_test"},
        },
        ConditionExpression="attribute_not_exists(run_id)",
    )

    entitlement_key = build_entitlement_key(DEMO_SCHEME_ID, "STU-001", DEMO_ACADEMIC_YEAR, 1)
    messages = [
        DisbursementEvent(
            run_id=run_id,
            delivery_id=str(uuid.uuid4()),
            logical_event_id="EVT-001",
            entitlement_key=entitlement_key,
            scheme_id=DEMO_SCHEME_ID,
            beneficiary_id="STU-001",
            academic_year=DEMO_ACADEMIC_YEAR,
            installment=1,
            amount_paise=DEMO_AMOUNT_PAISE,
            phase=InjectionPhase.A,
            copy_index=1,
            duplicate_of=None,
        ).to_message()
        for _ in range(args.copies)
    ]

    barrier = threading.Barrier(args.copies)

    def invoke(message: dict[str, Any]) -> dict[str, Any]:
        barrier.wait()  # release all invocations at the same instant
        response = lambda_client.invoke(
            FunctionName=stack["WorkerFunctionName"], Payload=json.dumps({"event": message})
        )
        payload = json.loads(response["Payload"].read())
        if response.get("FunctionError"):
            return {"status": f"ERROR: {payload.get('errorMessage')}"}
        return dict(payload)

    print(
        f"Run {run_id}: invoking {stack['WorkerFunctionName']} {args.copies}x in parallel ({args.processor})"
    )
    with ThreadPoolExecutor(max_workers=args.copies) as pool:
        results = list(pool.map(invoke, messages))

    statuses = Counter(result["status"] for result in results)
    effects = dynamodb.query(
        TableName=stack["LedgerTableName"],
        KeyConditionExpression="run_id = :r",
        ExpressionAttributeValues={":r": {"S": run_id}},
        ConsistentRead=True,
    )["Items"]
    claim = dynamodb.get_item(
        TableName=stack["IdempotencyTableName"],
        Key={"idem_key": {"S": idempotency_key_for(run_id, entitlement_key)}},
        ConsistentRead=True,
    ).get("Item")
    run = dynamodb.get_item(
        TableName=stack["RunsTableName"], Key={"run_id": {"S": run_id}}, ConsistentRead=True
    )["Item"]
    debited = budget - int(run["budget_remaining_paise"]["N"])

    print(f"Outcomes: {dict(statuses)}")
    print(
        f"Ledger effects: {len(effects)}   budget debited: {debited} paise   claim present: {claim is not None}"
    )

    if args.processor == "naive":
        print(
            f"Naive check-then-write made {len(effects)} payment(s) for one entitlement "
            "(the number can vary between attempts; anything above 1 is the bug)."
        )
        return 0

    checks = {
        "exactly one ledger effect": len(effects) == 1,
        f"{args.copies - 1} duplicates suppressed": statuses.get("DUPLICATE_SUPPRESSED")
        == args.copies - 1,
        "one COMMITTED outcome": statuses.get("COMMITTED") == 1,
        "budget debited exactly once": debited == DEMO_AMOUNT_PAISE,
        "idempotency record written": claim is not None,
    }
    for name, passed in checks.items():
        print(f"  {'PASS' if passed else 'FAIL'}  {name}")
    ok = all(checks.values())
    print("CONCURRENCY TEST PASSED" if ok else "CONCURRENCY TEST FAILED")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
