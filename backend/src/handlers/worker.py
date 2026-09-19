"""SQS consumer: processes each delivery with the processor its run asked for.

Event source: SQS Standard, BatchSize 10, ReportBatchItemFailures, and
MaximumConcurrency 5 on the event source mapping (no reserved concurrency).
A message that fails (for example, a write that kept conflicting) is reported in
`batchItemFailures`, so SQS redelivers only that message; after 5 receives it
moves to the dead-letter queue, where the drain check reports it.

Also accepts direct invocation `{"event": <message body>}`, used by the
concurrency test and the Race Lab to hit one entitlement from many workers.

Every log line is JSON with run_id, delivery_id, logical_event_id, processor,
outcome, attempt and duration_ms.
"""

from __future__ import annotations

import json
import time
from typing import Any

from common.clock import utc_now_iso
from common.logging import MetricUnit, get_logger, get_metrics
from domain.models import DisbursementEvent, ProcessorName
from processors.base import DisbursementProcessor, ProcessingContext, ProcessingOutcome
from processors.factory import build_processor
from processors.retry import ConflictRetrier
from services.container import disbursement_store, repositories

logger = get_logger("worker")
metrics = get_metrics("worker")
CONTEXT_KEYS = ["run_id", "delivery_id", "logical_event_id", "processor"]

# A run's processor never changes, so the lookup is cached per container.
_processors: dict[str, DisbursementProcessor] = {}


def _on_conflict_retry(failures: int, delay_seconds: float) -> None:
    # The Runs item is a deliberate hot key; conflicts are expected and measured.
    metrics.add_metric(name="TransactionConflictRetries", unit=MetricUnit.Count, value=1)
    logger.info(
        "write conflict, backing off",
        extra={"conflicts": failures, "backoff_ms": round(delay_seconds * 1000)},
    )


def _new_retrier() -> ConflictRetrier:
    return ConflictRetrier(on_retry=_on_conflict_retry)


def _processor_for(run_id: str) -> DisbursementProcessor:
    processor = _processors.get(run_id)
    if processor is None:
        run = repositories().runs.require(run_id)
        race_window_ms = int(run.get("race_window_ms", 200))
        processor = build_processor(
            ProcessorName(run["processor"]),
            disbursement_store(),
            retrier_factory=_new_retrier,
            race_window_seconds=race_window_ms / 1000,
        )
        _processors[run_id] = processor
    return processor


def _process(body: dict[str, Any], request_id: str) -> ProcessingOutcome:
    started = time.perf_counter()
    event = DisbursementEvent.from_message(body)
    logger.append_keys(
        run_id=event.run_id, delivery_id=event.delivery_id, logical_event_id=event.logical_event_id
    )
    processor = _processor_for(event.run_id)
    logger.append_keys(processor=processor.name.value)
    outcome = processor.process(
        event, ProcessingContext(lambda_request_id=request_id, now=utc_now_iso)
    )
    logger.info(
        "delivery processed",
        extra={
            "outcome": outcome.status.value,
            "attempt": outcome.attempts,
            "duration_ms": round((time.perf_counter() - started) * 1000, 1),
            "effect_id": outcome.effect_id,
        },
    )
    metrics.add_metric(
        name=f"Deliveries{outcome.status.value.title().replace('_', '')}",
        unit=MetricUnit.Count,
        value=1,
    )
    return outcome


@metrics.log_metrics
@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    if "Records" in event:
        failures: list[dict[str, str]] = []
        for record in event["Records"]:
            try:
                _process(json.loads(record["body"]), context.aws_request_id)
            except Exception:
                # Report only this message; SQS redelivers it, then dead-letters it after 5 receives.
                logger.exception(
                    "delivery failed, SQS will redeliver", extra={"message_id": record["messageId"]}
                )
                failures.append({"itemIdentifier": record["messageId"]})
            finally:
                logger.remove_keys(CONTEXT_KEYS)
        return {"batchItemFailures": failures}

    if "event" in event:
        try:
            outcome = _process(event["event"], context.aws_request_id)
        finally:
            logger.remove_keys(CONTEXT_KEYS)
        return {
            "status": outcome.status.value,
            "attempts": outcome.attempts,
            "effect_id": outcome.effect_id,
        }

    raise ValueError(
        "Unsupported event: expected SQS Records or a direct {'event': ...} invocation"
    )
