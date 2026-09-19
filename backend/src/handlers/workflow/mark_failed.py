"""Step Functions task: MarkFailed. The catch-all: records why the run failed so the UI can show it.

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
    logger.append_keys(run_id=run_id, task="mark_failed")
    error = event.get("error") or {}
    result = workflow_service().mark_failed(run_id, error if isinstance(error, dict) else {})
    logger.warning("run failed", extra={**result, "error": error})
    return result
