"""Smoke test against the deployed stack: runs the golden demo on both processors.

Usage:
    python tests/integration/smoke_test.py --api-url https://<id>.execute-api.ap-south-1.amazonaws.com
    python tests/integration/smoke_test.py --stack disburseproof-dev      # reads ApiUrl from CloudFormation

It starts a vulnerable run and a protected run on the demo experiment, waits for
both to finish, and asserts the headline table exactly. Every number it checks
was computed by the deployed backend from DynamoDB; this script only compares.
Exit code 0 means every check passed.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from typing import Any

EXPECTED: dict[str, dict[str, Any]] = {
    "vulnerable": {
        "deliveries": 112, "ledger_effects": 100, "double_paid": 12, "unpaid": 12,
        "duplicates_suppressed": 0, "budget_exhausted": 12, "misallocated_paise": 12_000_000,
        "budget_guard": "PASS", "one_payment_per_entitlement": "FAIL", "every_eligible_paid": "FAIL",
        "every_eligible_paid_detail": "88/100 eligible entitlements paid", "verdict": "FAIL",
    },
    "protected": {
        "deliveries": 112, "ledger_effects": 100, "double_paid": 0, "unpaid": 0,
        "duplicates_suppressed": 12, "budget_exhausted": 0, "misallocated_paise": 0,
        "budget_guard": "PASS", "one_payment_per_entitlement": "PASS", "every_eligible_paid": "PASS",
        "every_eligible_paid_detail": "100/100 eligible entitlements paid", "verdict": "PASS",
    },
}  # fmt: skip

POLL_SECONDS = 2
RUN_TIMEOUT_SECONDS = 360


class Api:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def call(self, method: str, path: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method, headers={"content-type": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read() or b"null")
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b"null")


def api_url_from_stack(stack: str, region: str) -> str:
    import boto3

    outputs = boto3.client("cloudformation", region_name=region).describe_stacks(StackName=stack)["Stacks"][0]["Outputs"]
    return next(o["OutputValue"] for o in outputs if o["OutputKey"] == "ApiUrl")


def start_run(api: Api, experiment_id: str, processor: str) -> str:
    for _ in range(60):
        status, body = api.call("POST", "/runs", {"experiment_id": experiment_id, "processor": processor})
        if status == 202:
            return str(body["run"]["run_id"])
        if status in (409, 429):  # another run is active, or throttled: wait and retry
            time.sleep(5)
            continue
        raise RuntimeError(f"POST /runs returned {status}: {body}")
    raise RuntimeError("could not start a run")


def wait_for(api: Api, run_id: str) -> dict[str, Any]:
    deadline = time.time() + RUN_TIMEOUT_SECONDS
    last = ""
    while time.time() < deadline:
        status, body = api.call("GET", f"/runs/{run_id}")
        if status == 200:
            run = body["run"]
            line = f"  {run_id}  {run['status']:<9} {run['phase']:<10} delivered {run['delivered_count']}/{run['expected_deliveries']}"
            if line != last:
                print(line)
                last = line
            if run["is_terminal"]:
                return dict(run)
        time.sleep(POLL_SECONDS)
    raise TimeoutError(f"run {run_id} did not finish in {RUN_TIMEOUT_SECONDS}s")


def observed(run: dict[str, Any]) -> dict[str, Any]:
    summary = run.get("summary") or {}
    invariants = {i["id"]: i for i in run.get("invariants") or []}
    return {
        **{key: summary.get(key) for key in (
            "deliveries", "ledger_effects", "double_paid", "unpaid", "duplicates_suppressed",
            "budget_exhausted", "misallocated_paise")},
        "budget_guard": invariants.get("budget_guard", {}).get("result"),
        "one_payment_per_entitlement": invariants.get("one_payment_per_entitlement", {}).get("result"),
        "every_eligible_paid": invariants.get("every_eligible_paid", {}).get("result"),
        "every_eligible_paid_detail": invariants.get("every_eligible_paid", {}).get("detail"),
        "verdict": run.get("verdict"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--api-url")
    parser.add_argument("--stack", default="disburseproof-dev")
    parser.add_argument("--region", default="ap-south-1")
    args = parser.parse_args()
    api = Api(args.api_url or api_url_from_stack(args.stack, args.region))
    print(f"API: {api.base_url}")

    status, overview = api.call("GET", "/overview")
    if status != 200 or not overview["demo"]["experiment"]:
        print(f"FAIL: demo experiment not found (GET /overview -> {status})")
        return 1
    experiment = overview["demo"]["experiment"]
    print(f"Demo experiment {experiment['experiment_id']}  fingerprint {experiment['fingerprint'][:16]}…")

    failures: list[str] = []
    runs: dict[str, dict[str, Any]] = {}
    for processor in ("vulnerable", "protected"):
        print(f"\nStarting {processor} run")
        run_id = start_run(api, experiment["experiment_id"], processor)
        run = wait_for(api, run_id)
        runs[processor] = run
        if run["status"] != "COMPLETED":
            failures.append(f"{processor}: run {run_id} ended {run['status']} "
                            f"({run.get('failure_reason')}: {run.get('failure_message')})")
            continue
        got = observed(run)
        for key, want in EXPECTED[processor].items():
            if got[key] != want:
                failures.append(f"{processor}.{key}: expected {want!r}, got {got[key]!r}")

        status, receipt = api.call("GET", f"/runs/{run_id}/receipt")
        if status != 200 or not receipt.get("sha256_matches"):
            failures.append(f"{processor}: receipt missing or SHA-256 mismatch ({status})")
        status, students = api.call("GET", f"/runs/{run_id}/students")
        want_counts = ({"paid_once": 76, "paid_twice": 12, "unpaid": 12, "pending": 0} if processor == "vulnerable"
                       else {"paid_once": 100, "paid_twice": 0, "unpaid": 0, "pending": 0})
        if status != 200 or students["counts"] != want_counts:
            failures.append(f"{processor}: student grid counts {students.get('counts')} != {want_counts}")

    if len(runs) == 2 and runs["vulnerable"]["fingerprint"] != runs["protected"]["fingerprint"]:
        failures.append("the two runs do not share a replay fingerprint")

    print("\n" + "Metric".ljust(34) + "Vulnerable".ljust(38) + "Protected")
    for key in EXPECTED["vulnerable"]:
        cells = [str(observed(runs[p]).get(key)) if p in runs else "-" for p in ("vulnerable", "protected")]
        print(key.ljust(34) + cells[0].ljust(38) + cells[1])
    for processor, run in runs.items():
        print(f"{processor}: run {run['run_id']}  duration {run.get('duration_ms')} ms  "
              f"receipt sha256 {str(run.get('receipt_sha256'))[:16]}…")

    if failures:
        print("\nSMOKE TEST FAILED")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("\nSMOKE TEST PASSED: every value matches the headline table.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
