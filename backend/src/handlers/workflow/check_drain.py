"""Step Functions task: WaitDrainA / WaitDrainB loop body. Reports whether the phase has drained.

Thin entry point: validates the task input and calls WorkflowService.
"""

from __future__ import annotations

from typing import Any

from common.logging import get_logger
from domain.validation import require_str
from domain.models import InjectionPhase
from domain.validation import require_enum, require_int
from services.container import workflow_service

logger = get_logger("workflow")


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    run_id = require_str(event, "run_id")
    logger.append_keys(run_id=run_id, task="check_drain")
    phase = require_enum(event, "phase", InjectionPhase)
    iteration = require_int(event, "iteration", minimum=0)
    result = workflow_service().check_drain(run_id, phase, iteration)
    logger.info("drain check", extra=result)
    return result
