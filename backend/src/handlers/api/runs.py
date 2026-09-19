"""HTTP handler: /runs, /runs/{id}/students, /overview.

Parses the request, calls RunService, shapes the response.
Must never: contain business logic (services/run_service.py owns it).
"""

from __future__ import annotations

from functools import cache
from typing import Any

from adapters.stepfunctions_client import StepFunctionsClient
from common.http import ApiRequest, dispatch
from common.logging import get_logger
from domain.requests import BUSINESS_ID_PATTERN, RUN_ID_PATTERN
from services.container import rate_limiter, repositories, settings
from services.run_service import RunService

logger = get_logger("api-runs")


@cache
def _service() -> RunService:
    # Cached per container: RunService keeps an in-memory cache of immutable batches.
    repos, config = repositories(), settings()
    return RunService(
        runs=repos.runs,
        experiments=repos.experiments,
        batches=repos.batches,
        ledger=repos.ledger,
        deliveries=repos.deliveries,
        step_functions=StepFunctionsClient(config.require_state_machine_arn()),
        max_active_runs=config.max_active_runs,
        limiter=rate_limiter(),
        runs_per_hour=config.runs_per_hour,
        region=config.aws_region,
    )


def start_run(request: ApiRequest) -> tuple[int, object]:
    return _service().start(request.json_body())


def list_runs(request: ApiRequest) -> tuple[int, object]:
    return 200, _service().list(request.query)


def get_run(request: ApiRequest) -> tuple[int, object]:
    return 200, _service().get(request.path("run_id", RUN_ID_PATTERN))


def list_students(request: ApiRequest) -> tuple[int, object]:
    return 200, _service().students(request.path("run_id", RUN_ID_PATTERN))


def get_student(request: ApiRequest) -> tuple[int, object]:
    return 200, _service().student_detail(
        request.path("run_id", RUN_ID_PATTERN), request.path("beneficiary_id", BUSINESS_ID_PATTERN)
    )


def get_overview(_: ApiRequest) -> tuple[int, object]:
    return 200, _service().overview()


ROUTES = {
    "POST /runs": start_run,
    "GET /runs": list_runs,
    "GET /runs/{run_id}": get_run,
    "GET /runs/{run_id}/students": list_students,
    "GET /runs/{run_id}/students/{beneficiary_id}": get_student,
    "GET /overview": get_overview,
}


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return dispatch(ROUTES, event, logger)
