"""HTTP handler: /runs/{id}/receipt and /runs/{id}/evidence (read-only AWS evidence).

Parses the request, calls EvidenceService, shapes the response.
Must never: contain business logic (services/evidence_service.py owns it).
"""

from __future__ import annotations

from functools import cache
from typing import Any

from adapters.s3_receipts import S3Receipts
from common.http import ApiRequest, dispatch
from common.logging import get_logger
from services.container import repositories, settings
from services.evidence_service import EvidenceService

logger = get_logger("api-receipts")


@cache
def _service() -> EvidenceService:
    config = settings()
    return EvidenceService(
        runs=repositories().runs, receipts=S3Receipts(config.receipts_bucket), settings=config
    )


def get_receipt(request: ApiRequest) -> tuple[int, object]:
    return 200, _service().receipt(request.path("run_id"))


def get_evidence(request: ApiRequest) -> tuple[int, object]:
    return 200, _service().evidence(request.path("run_id"))


ROUTES = {
    "GET /runs/{run_id}/receipt": get_receipt,
    "GET /runs/{run_id}/evidence": get_evidence,
}


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    return dispatch(ROUTES, event, logger)
