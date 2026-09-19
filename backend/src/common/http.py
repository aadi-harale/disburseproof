"""HTTP API request parsing, routing and JSON responses (payload format 2.0).

Owns: turning an API Gateway HTTP API event into an `ApiRequest`, dispatching it
to a route function, and turning results or typed errors into JSON responses.

CORS is configured on the HTTP API itself in template.yaml. API Gateway answers
preflight OPTIONS requests and adds the CORS headers to every response, and it
ignores CORS headers returned by an integration, so handlers never set them.

Must never: contain business logic, or put a stack trace in a response body.
"""

from __future__ import annotations

import base64
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from decimal import Decimal
from typing import Any

from aws_lambda_powertools import Logger

from common.errors import DisburseProofError, NotFoundError, ValidationError, http_status_for

MAX_BODY_BYTES = 1_000_000  # 500 CSV rows fit in well under 100 KB


@dataclass(frozen=True, slots=True)
class ApiRequest:
    route_key: str
    path_params: Mapping[str, str]
    query: Mapping[str, str]
    raw_body: str | None
    request_id: str

    @classmethod
    def from_event(cls, event: Mapping[str, Any]) -> ApiRequest:
        body = event.get("body")
        if body is not None and event.get("isBase64Encoded"):
            body = base64.b64decode(body).decode("utf-8")
        return cls(
            route_key=str(event.get("routeKey", "")),
            path_params=event.get("pathParameters") or {},
            query=event.get("queryStringParameters") or {},
            raw_body=body,
            request_id=str(event.get("requestContext", {}).get("requestId", "")),
        )

    def path(self, name: str) -> str:
        value = self.path_params.get(name)
        if not value:
            raise ValidationError(f"Missing path parameter {name}")
        return value

    def json_body(self) -> dict[str, Any]:
        if not self.raw_body:
            raise ValidationError("Request body must be a JSON object")
        if len(self.raw_body.encode("utf-8")) > MAX_BODY_BYTES:
            raise ValidationError("Request body is too large")
        try:
            parsed = json.loads(self.raw_body)
        except json.JSONDecodeError as exc:
            raise ValidationError(f"Request body is not valid JSON: {exc.msg}") from exc
        if not isinstance(parsed, dict):
            raise ValidationError("Request body must be a JSON object")
        return parsed


def _json_default(value: object) -> object:
    # DynamoDB returns numbers as Decimal. Every number we store is an integer
    # (money is integer paise), so an integral Decimal becomes an int.
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else str(value)
    if isinstance(value, (set, frozenset, tuple)):
        return sorted(value) if isinstance(value, (set, frozenset)) else list(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def json_response(status: int, payload: object) -> dict[str, Any]:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json; charset=utf-8", "cache-control": "no-store"},
        "body": json.dumps(payload, default=_json_default, ensure_ascii=False),
    }


def error_response(
    status: int,
    code: str,
    message: str,
    request_id: str,
    details: list[dict[str, object]] | None = None,
) -> dict[str, Any]:
    error: dict[str, object] = {"code": code, "message": message, "request_id": request_id}
    if details:
        error["details"] = details
    return json_response(status, {"error": error})


Route = Callable[[ApiRequest], tuple[int, object]]


def dispatch(
    routes: Mapping[str, Route], event: Mapping[str, Any], logger: Logger
) -> dict[str, Any]:
    """Run the route matching `event.routeKey` and map typed errors to HTTP statuses.

    Unknown errors become a 500 with the API Gateway request ID so the operator can
    find the matching log line; the exception text itself is never returned.
    """
    request = ApiRequest.from_event(event)
    logger.append_keys(route=request.route_key, request_id=request.request_id)
    try:
        route = routes.get(request.route_key)
        if route is None:
            raise NotFoundError(f"No route for {request.route_key}")
        status, payload = route(request)
        return json_response(status, payload)
    except DisburseProofError as error:
        logger.info("request rejected", extra={"error_code": error.code, "error": error.message})
        return error_response(
            http_status_for(error),
            error.code,
            error.message,
            request.request_id,
            [detail.to_dict() for detail in error.details],
        )
    except Exception:
        logger.exception("unhandled error")
        return error_response(
            500,
            "INTERNAL",
            "Unexpected server error. Quote the request ID when reporting it.",
            request.request_id,
        )
