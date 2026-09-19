"""Step Functions task: FinishRace. Counts what the race's copies did, from the ledger.

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
    logger.append_keys(run_id=run_id, task="finish_race")
    result = workflow_service().finish_race(run_id)
    logger.info("race finished", extra=result)
    return result
