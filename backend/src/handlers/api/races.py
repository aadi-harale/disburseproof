"""HTTP handler: /race and /races (Race Lab). Parses the request, calls RaceService.

Must never: contain business logic (services/race_service.py owns it).
"""

from __future__ import annotations

from functools import cache
from typing import Any

from adapters.stepfunctions_client import StepFunctionsClient
from common.http import ApiRequest, dispatch
from common.logging import get_logger
from domain.requests import RUN_ID_PATTERN
from services.container import rate_limiter, repositories, settings
from services.race_service import RaceService

logger = get_logger("api-races")


@cache
def _service() -> RaceService:
    repos, config = repositories(), settings()
    return RaceService(
        runs=repos.runs,
        ledger=repos.ledger,
        deliveries=repos.deliveries,
        step_functions=StepFunctionsClient(config.require_race_state_machine_arn()),
        limiter=rate_limiter(),
        races_per_hour=config.races_per_hour,
    )


def start_race(request: ApiRequest) -> tuple[int, object]:
    return _service().start(request.json_body())


def list_races(_: ApiRequest) -> tuple[int, object]:
    return 200, _service().list()


def get_race(request: ApiRequest) -> tuple[int, object]:
    return 200, _service().get(request.path("run_id", RUN_ID_PATTERN))


ROUTES = {
    "POST /race": start_race,
    "GET /races": list_races,
    "GET /races/{run_id}": get_race,
}


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return dispatch(ROUTES, event, logger)
