"""HTTP handler: /experiments. Parses the request, calls ExperimentService, shapes the response.

Must never: contain business logic (services/experiment_service.py owns it).
"""

from __future__ import annotations

from typing import Any

from common.http import ApiRequest, dispatch
from common.logging import get_logger
from domain.requests import EXPERIMENT_ID_PATTERN
from services.container import rate_limiter, repositories, settings
from services.experiment_service import ExperimentService

logger = get_logger("api-experiments")


def _service() -> ExperimentService:
    repos = repositories()
    return ExperimentService(
        repos.batches,
        repos.experiments,
        limiter=rate_limiter(),
        experiments_per_hour=settings().experiments_per_hour,
    )


def create_experiment(request: ApiRequest) -> tuple[int, object]:
    return _service().create(request.json_body())


def get_experiment(request: ApiRequest) -> tuple[int, object]:
    return 200, _service().get(request.path("experiment_id", EXPERIMENT_ID_PATTERN))


ROUTES = {
    "POST /experiments": create_experiment,
    "GET /experiments/{experiment_id}": get_experiment,
}


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return dispatch(ROUTES, event, logger)
