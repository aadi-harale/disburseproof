"""Step Functions task: InjectPhaseA / InjectPhaseB. Publishes one phase of deliveries to SQS.

Thin entry point: validates the task input and calls WorkflowService.
"""

from __future__ import annotations

from typing import Any

from common.logging import get_logger
from domain.validation import require_str
from domain.models import InjectionPhase
from domain.validation import require_enum
from services.container import workflow_service

logger = get_logger("workflow")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    run_id = require_str(event, "run_id")
    logger.append_keys(run_id=run_id, task="inject_phase")
    phase = require_enum(event, "phase", InjectionPhase)
    result = workflow_service().inject_phase(run_id, phase)
    logger.info("phase injected", extra=result)
    return result
