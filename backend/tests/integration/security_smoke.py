"""Security smoke test against the deployed stack (read-only; creates nothing).

Usage:
    python tests/integration/security_smoke.py --stack disburseproof-dev

Checks what a reviewer would probe from outside, plus two configuration facts:
  - CORS preflight from a disallowed origin gets no Access-Control-Allow-Origin
  - a receipt object fetched straight from S3 (no presigning) is refused (403)
  - the site sends CSP, HSTS, nosniff, Referrer-Policy and Permissions-Policy
  - bad input gets a 400 JSON error with no stack trace or internals
  - API stage throttling (10 rps / 20 burst) and access logging are configured
  - no stack function has a Lambda Function URL
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from typing import Any

import boto3

EVIL_ORIGIN = "https://evil.example"
REQUIRED_SITE_HEADERS = {
    "content-security-policy": "default-src 'self'",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=()",
}


def http(
    method: str, url: str, *, body: bytes | None = None, headers: dict[str, str] | None = None
) -> tuple[int, dict[str, str], bytes]:
    request = urllib.request.Request(url, data=body, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return (
                response.status,
                {k.lower(): v for k, v in response.headers.items()},
                response.read(),
            )
    except urllib.error.HTTPError as error:
        return error.code, {k.lower(): v for k, v in error.headers.items()}, error.read()


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--stack", default="disburseproof-dev")
    parser.add_argument("--region", default="ap-south-1")
    args = parser.parse_args()

    cfn = boto3.client("cloudformation", region_name=args.region)
    stack = cfn.describe_stacks(StackName=args.stack)["Stacks"][0]
    outputs = {o["OutputKey"]: o["OutputValue"] for o in stack["Outputs"]}
    api, site = outputs["ApiUrl"].rstrip("/"), outputs["FrontendUrl"].rstrip("/")
    results: list[tuple[str, bool, str]] = []

    def check(name: str, passed: bool, detail: str = "") -> None:
        results.append((name, passed, detail))

    # 1. CORS: a disallowed origin gets no allow-origin header; the site's origin does.
    for origin, should_allow in ((EVIL_ORIGIN, False), (site, True)):
        _, headers, _ = http(
            "OPTIONS",
            f"{api}/runs",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        allowed = headers.get("access-control-allow-origin")
        ok = (allowed == origin) if should_allow else (allowed is None)
        check(
            f"CORS preflight from {origin} {'allowed' if should_allow else 'rejected'}",
            ok,
            f"allow-origin={allowed}",
        )

    # 2. Receipts are not public objects.
    status, _, body = http("GET", f"{api}/runs")
    runs = json.loads(body)["items"] if status == 200 else []
    with_receipt = next((r for r in runs if r.get("receipt_s3_key")), None)
    if with_receipt:
        direct = (
            f"https://{outputs['ReceiptsBucketRegionalDomain']}/{with_receipt['receipt_s3_key']}"
        )
        status, _, _ = http("GET", direct)
        check("Receipt object without presigning is refused", status == 403, f"HTTP {status}")
    else:
        check(
            "Receipt object without presigning is refused",
            False,
            "no completed run with a receipt to test",
        )

    # 3. Security headers on the site.
    status, headers, _ = http("GET", f"{site}/")
    for header, expected in REQUIRED_SITE_HEADERS.items():
        value = headers.get(header, "")
        check(f"Site sends {header}", expected in value, value[:90] or "missing")
    csp = headers.get("content-security-policy", "")
    check(
        "CSP connect-src names only self and the API", f"connect-src 'self' {api}" in csp, csp[:120]
    )

    # 4. Bad input -> 400 JSON error, no internals.
    probes = [
        (
            "unknown field",
            "POST",
            f"{api}/runs",
            {"experiment_id": "exp_0123456789abcdef", "processor": "protected", "admin": True},
        ),
        (
            "invalid processor",
            "POST",
            f"{api}/runs",
            {"experiment_id": "exp_0123456789abcdef", "processor": "naive"},
        ),
        ("oversized body", "POST", f"{api}/batches", {"csv": "x" * (300 * 1024)}),
        ("bad path id", "GET", f"{api}/runs/run_not-a-valid-id", None),
    ]
    for name, method, url, payload in probes:
        data = json.dumps(payload).encode() if payload is not None else None
        status, _, raw = http(
            method, url, body=data, headers={"content-type": "application/json"} if data else None
        )
        text = raw.decode("utf-8", "replace")
        try:
            error: Any = json.loads(text).get("error", {})
        except json.JSONDecodeError:
            error = {}
        clean = not any(
            marker in text for marker in ("Traceback", "arn:aws", "disburseproof-dev-", '.py"')
        )
        ok = status == 400 and {"code", "message", "request_id"} <= set(error) and clean
        check(f"Bad input rejected: {name}", ok, f"HTTP {status} {error.get('code', '')}")

    # 5. API stage configuration.
    api_id = api.split("//", 1)[1].split(".", 1)[0]
    stage = boto3.client("apigatewayv2", region_name=args.region).get_stage(
        ApiId=api_id, StageName="$default"
    )
    route = stage.get("DefaultRouteSettings", {})
    check(
        "Stage throttling 10 rps / burst 20",
        route.get("ThrottlingRateLimit") == 10 and route.get("ThrottlingBurstLimit") == 20,
        f"{route.get('ThrottlingRateLimit')} / {route.get('ThrottlingBurstLimit')}",
    )
    check("API access logging on", bool(stage.get("AccessLogSettings", {}).get("DestinationArn")))

    # 6. No Lambda Function URLs on stack functions.
    lam = boto3.client("lambda", region_name=args.region)
    names = [
        resource["PhysicalResourceId"]
        for page in cfn.get_paginator("list_stack_resources").paginate(StackName=args.stack)
        for resource in page["StackResourceSummaries"]
        if resource["ResourceType"] == "AWS::Lambda::Function"
    ]
    with_urls = [
        n for n in names if lam.list_function_url_configs(FunctionName=n).get("FunctionUrlConfigs")
    ]
    check(f"No Function URLs on {len(names)} functions", not with_urls, ", ".join(with_urls))

    width = max(len(name) for name, _, _ in results)
    for name, passed, detail in results:
        print(f"  {'PASS' if passed else 'FAIL'}  {name.ljust(width)}  {detail}")
    failed = [r for r in results if not r[1]]
    print(
        "SECURITY SMOKE PASSED" if not failed else f"SECURITY SMOKE FAILED ({len(failed)} check(s))"
    )
    return 0 if not failed else 1


if __name__ == "__main__":
    sys.exit(main())
