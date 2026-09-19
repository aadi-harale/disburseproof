"""Step Functions task: GenerateReceipt. Writes the SHA-256 fingerprinted receipt to S3 and completes the run.

Thin entry point: validates the task input and calls WorkflowService.
"""

from __future__ import annotations

from typing import Any

from common.logging import get_logger
from domain.validation import require_str

from services.container import workflow_service

logger = get_logger("workflow")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    run_id = require_str(event, "run_id")
    logger.append_keys(run_id=run_id, task="generate_receipt")
    result = workflow_service().generate_receipt(run_id)
    logger.info("receipt written", extra=result)
    return result
