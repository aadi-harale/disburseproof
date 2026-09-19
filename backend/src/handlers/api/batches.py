"""HTTP handler: /batches. Parses the request, calls BatchService, shapes the response.

Must never: contain business logic (services/batch_service.py owns it).
"""

from __future__ import annotations

from typing import Any

from common.http import ApiRequest, dispatch
from common.logging import get_logger
from services.batch_service import BatchService
from services.container import repositories

logger = get_logger("api-batches")


def _service() -> BatchService:
    repos = repositories()
    return BatchService(repos.batches, repos.experiments)


def create_batch(request: ApiRequest) -> tuple[int, object]:
    return _service().create(request.json_body())


def list_batches(_: ApiRequest) -> tuple[int, object]:
    return 200, _service().list()


def get_batch(request: ApiRequest) -> tuple[int, object]:
    return 200, _service().get(request.path("batch_id"))


ROUTES = {
    "POST /batches": create_batch,
    "GET /batches": list_batches,
    "GET /batches/{batch_id}": get_batch,
}


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return dispatch(ROUTES, event, logger)
