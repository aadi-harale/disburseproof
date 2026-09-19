"""Security negative tests (unit level, no AWS).

Every public write path must reject bad input with a 400 before touching storage,
refuse over-limit callers with a 429, and never leak internals in an error body.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any

import pytest
from botocore.exceptions import ClientError

from adapters.dynamodb.rate_limits_repo import RateLimiter
from common.errors import RateLimitedError
from common.http import ApiRequest, dispatch
from common.logging import get_logger
from domain.batch_import import parse_entitlements_csv
from domain.experiment import build_definition
from domain.rate_limit import hourly_window, is_allowed
from domain.requests import (
    RUN_ID_PATTERN,
    parse_create_batch,
    parse_create_experiment,
    parse_start_race,
    parse_start_run,
)
from services.workflow_service import WorkflowService

logger = get_logger("security-tests")
ERROR_KEYS = {"code", "message", "request_id"}


def _event(route: str, body: object = None, path: dict[str, str] | None = None) -> dict[str, Any]:
    return {
        "routeKey": route,
        "pathParameters": path or {},
        "body": body if isinstance(body, str) or body is None else json.dumps(body),
        "requestContext": {"requestId": "req-test-1"},
    }


def _call(route_fn: Any, event: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    response = dispatch({event["routeKey"]: route_fn}, event, logger)
    return response["statusCode"], json.loads(response["body"])


def _assert_error(status: int, body: dict[str, Any], expected_status: int) -> None:
    assert status == expected_status
    assert set(body) == {"error"}
    assert set(body["error"]) >= ERROR_KEYS
    assert body["error"]["request_id"] == "req-test-1"


def _start_run_route(request: ApiRequest) -> tuple[int, object]:
    return 202, {"parsed": list(parse_start_run(request.json_body()))}


def test_oversized_body_is_rejected_with_400() -> None:
    body = json.dumps({"experiment_id": "exp_0123456789abcdef", "processor": "x" * (257 * 1024)})
    status, payload = _call(_start_run_route, _event("POST /runs", body))
    _assert_error(status, payload, 400)
    assert "too large" in payload["error"]["message"]


def test_unknown_field_is_rejected_with_400() -> None:
    body = {"experiment_id": "exp_0123456789abcdef", "processor": "protected", "admin": True}
    status, payload = _call(_start_run_route, _event("POST /runs", body))
    _assert_error(status, payload, 400)
    assert "admin" in payload["error"]["message"]


@pytest.mark.parametrize(
    "body",
    [
        {"experiment_id": "exp_0123456789abcdef", "processor": "naive"},  # races only
        {"experiment_id": "exp_0123456789abcdef", "processor": "Protected"},
        {"experiment_id": "exp_0123456789abcdef", "processor": 1},
    ],
)
def test_invalid_processor_is_rejected(body: dict[str, object]) -> None:
    status, payload = _call(_start_run_route, _event("POST /runs", body))
    _assert_error(status, payload, 400)


def test_race_rejects_the_vulnerable_processor_and_too_many_copies() -> None:
    from common.errors import ValidationError

    with pytest.raises(ValidationError):
        parse_start_race({"processor": "vulnerable", "copies": 20})
    with pytest.raises(ValidationError):
        parse_start_race({"processor": "naive", "copies": 21})
    assert parse_start_race({"processor": "naive", "copies": 20})[1] == 20


@pytest.mark.parametrize(
    "run_id",
    [
        "run_../../etc/passwd",
        "RUN_01M2W96E2MKW8SPSWC1DRBJVQR",
        "run_01m2w96e2mkw8spswc1drbjvqr",
        "run_1",
    ],
)
def test_bad_id_format_in_the_path_is_rejected(run_id: str) -> None:
    def route(request: ApiRequest) -> tuple[int, object]:
        return 200, {"run_id": request.path("run_id", RUN_ID_PATTERN)}

    status, payload = _call(route, _event("GET /runs/{run_id}", path={"run_id": run_id}))
    _assert_error(status, payload, 400)


def test_bad_id_formats_in_bodies_are_rejected() -> None:
    from common.errors import ValidationError

    with pytest.raises(ValidationError):
        parse_start_run({"experiment_id": "EXP_' OR 1=1", "processor": "protected"})
    with pytest.raises(ValidationError):
        parse_create_experiment({"batch_id": "bat_x#y", "seed": "s", "duplicate_count": 1})
    with pytest.raises(ValidationError):
        parse_create_batch(
            {"generate": {"count": 1, "amount_paise": 1}, "scheme_id": "lower"},
            max_csv_characters=10,
        )


def test_duplicate_count_above_half_n_is_rejected() -> None:
    def route(request: ApiRequest) -> tuple[int, object]:
        batch_id, seed, duplicate_count = parse_create_experiment(request.json_body())
        build_definition(
            batch_id=batch_id, batch_content_sha256="x", entitlement_count=100, seed=seed,
            duplicate_count=duplicate_count,
        )  # fmt: skip
        return 201, {}

    body = {
        "batch_id": "bat_demo_postmatric_2026_27",
        "seed": "FC-2026-0918",
        "duplicate_count": 51,
    }
    status, payload = _call(route, _event("POST /experiments", body))
    _assert_error(status, payload, 400)
    assert "between 1 and 50" in payload["error"]["message"]


def test_batch_request_cannot_name_its_own_id() -> None:
    # The seeded demo batch is read-only: IDs are generated server-side, so a caller
    # has no field through which to target (and overwrite) an existing batch.
    from common.errors import ValidationError

    with pytest.raises(ValidationError, match="batch_id"):
        parse_create_batch(
            {
                "batch_id": "bat_demo_postmatric_2026_27",
                "generate": {"count": 1, "amount_paise": 1},
            },
            max_csv_characters=10,
        )


@pytest.mark.parametrize(
    ("name", "ok"),
    [("Aarav Iyer", True), ("D'Souza", True), ("=HYPERLINK(1)", False), ("+1", False), ("@SUM", False),
     ("-cmd", False), ("<img src=x>", False), ("A" * 61, False)],
)  # fmt: skip
def test_display_names_block_formula_and_markup_characters(name: str, ok: bool) -> None:
    report = parse_entitlements_csv(
        f"beneficiary_id,display_name,amount_paise,installment\nSTU-1,{name},100,1\n"
    )
    assert report.is_valid is ok


def test_lowercase_beneficiary_ids_are_rejected() -> None:
    report = parse_entitlements_csv(
        "beneficiary_id,display_name,amount_paise,installment\nstu-1,Ann,100,1\n"
    )
    assert not report.is_valid


def test_rate_limit_window_key_and_expiry() -> None:
    window = hourly_window("runs", datetime(2026, 9, 19, 13, 42, 7, tzinfo=UTC))
    assert window.key == "RATE#runs#2026091913"
    assert window.expires_at_epoch == int(datetime(2026, 9, 19, 15, 0, tzinfo=UTC).timestamp())
    assert window.resets_at == datetime(2026, 9, 19, 14, 0, tzinfo=UTC)
    assert is_allowed(29, 30) and not is_allowed(30, 30)


class _CountingClient:
    """Mimics DynamoDB's conditional ADD: fails once the stored count reaches the limit."""

    def __init__(self) -> None:
        self.counts: dict[str, int] = {}
        self.requests: list[dict[str, Any]] = []

    def update_item(self, **kwargs: Any) -> dict[str, Any]:
        self.requests.append(kwargs)
        key = kwargs["Key"]["pk"]["S"]
        limit = int(kwargs["ExpressionAttributeValues"][":limit"]["N"])
        if self.counts.get(key, 0) >= limit:
            raise ClientError(
                {"Error": {"Code": "ConditionalCheckFailedException", "Message": "no"}},
                "UpdateItem",
            )
        self.counts[key] = self.counts.get(key, 0) + 1
        return {}


def test_run_limiter_allows_30_per_hour_then_returns_429() -> None:
    client = _CountingClient()
    limiter = RateLimiter("rate-limits", client=client)
    now = datetime(2026, 9, 19, 13, 5, tzinfo=UTC)
    for _ in range(30):
        limiter.consume("runs", limit=30, now=now, what="runs")

    def route(_: ApiRequest) -> tuple[int, object]:
        limiter.consume("runs", limit=30, now=now, what="runs")
        return 202, {}

    status, payload = _call(route, _event("POST /runs", {}))
    _assert_error(status, payload, 429)
    assert payload["error"]["code"] == "RATE_LIMITED"
    assert "30 runs per hour" in payload["error"]["message"]
    # The check and the increment are one conditional request, never a read-then-write.
    assert "ConditionExpression" in client.requests[-1]
    # A new hour is a new window.
    limiter.consume("runs", limit=30, now=datetime(2026, 9, 19, 14, 0, tzinfo=UTC), what="runs")


def test_rate_limited_error_is_a_429() -> None:
    from common.errors import http_status_for

    assert http_status_for(RateLimitedError("x")) == 429


def test_unhandled_errors_leak_no_stack_trace_or_internals() -> None:
    def route(_: ApiRequest) -> tuple[int, object]:
        raise RuntimeError(
            "boom in arn:aws:dynamodb:ap-south-1:123456789012:table/disburseproof-dev-runs"
        )

    status, payload = _call(route, _event("GET /runs", None))
    _assert_error(status, payload, 500)
    text = json.dumps(payload)
    for leaked in ("Traceback", "boom", "arn:aws", "disburseproof-dev-runs", "RuntimeError", ".py"):
        assert leaked not in text


class _CapturingRuns:
    def __init__(self) -> None:
        self.updates: list[dict[str, object]] = []

    def update(self, run_id: str, updates: dict[str, object], **_: object) -> dict[str, object]:
        self.updates.append(updates)
        return {}


def test_failure_messages_on_runs_never_carry_raw_aws_errors() -> None:
    runs = _CapturingRuns()
    service = WorkflowService(
        runs=runs, experiments=None, batches=None, ledger=None, deliveries=None,  # type: ignore[arg-type]
        now=lambda: "2026-09-19T08:00:00.000Z",
    )  # fmt: skip
    cause = json.dumps({
        "errorType": "ClientError",
        "errorMessage": "User: arn:aws:sts::123456789012:assumed-role/x is not authorized on table/disburseproof-dev-ledger",
    })  # fmt: skip
    service.mark_failed("run_X", {"Error": "ClientError", "Cause": cause})
    message = str(runs.updates[-1]["failure_message"])
    assert "arn:" not in message and "disburseproof-dev-ledger" not in message
    assert "ClientError" in message

    service.mark_failed("run_X", {"Error": "<script>alert(1)</script>", "Cause": ""})
    assert "<script>" not in str(runs.updates[-1]["failure_message"])
