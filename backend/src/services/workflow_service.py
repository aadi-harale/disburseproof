"""Step Functions task logic: init, inject, drain check, evaluate, receipt, fail.

Owns: what each state of the run workflow does. Every task is safe to retry:
InitRun only moves QUEUED -> RUNNING, injection re-sends the same deterministic
delivery IDs, evaluation is a pure function of stored rows, and the receipt is
built from stored timestamps so regenerating it yields identical bytes.
Must never: decide a phase has drained from queue depth. Queue counts are
approximate; only the run's `delivered_count` (incremented in the same
transaction that records each delivery) decides.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable, Mapping
from typing import Any

from adapters.dynamodb.batches_repo import BatchesRepository
from adapters.dynamodb.deliveries_repo import DeliveriesRepository
from adapters.dynamodb.experiments_repo import ExperimentsRepository, definition_of
from adapters.dynamodb.ledger_repo import LedgerRepository
from adapters.dynamodb.runs_repo import RunsRepository
from adapters.s3_receipts import S3Receipts
from adapters.sqs_publisher import SqsPublisher
from common.clock import utc_now_iso
from common.errors import ConflictError, NotFoundError
from domain.evaluator import evaluate_run
from domain.fingerprint import canonical_json
from domain.idempotency import key_entitlements
from domain.injection import plan_phase
from domain.models import (
    DeliveryOutcome,
    FailureReason,
    InjectionPhase,
    InvariantReport,
    ProcessorName,
    RunPhase,
    RunStatus,
)
from domain.receipt import build_receipt, receipt_s3_key

DRAIN_TIMEOUT_ERROR = "DRAIN_TIMEOUT"
SAFE_ERROR_NAME = re.compile(r"[A-Za-z][A-Za-z0-9_.]{0,63}")
MAX_FAILURE_MESSAGE = 1000


class InconsistentDeliveriesError(Exception):
    """The number of recorded deliveries does not match the experiment. Fail closed."""


class EvaluationMismatchError(Exception):
    """Re-evaluating for the receipt gave a different verdict than the stored one."""


class WorkflowService:
    def __init__(
        self,
        *,
        runs: RunsRepository,
        experiments: ExperimentsRepository,
        batches: BatchesRepository,
        ledger: LedgerRepository,
        deliveries: DeliveriesRepository,
        publisher: SqsPublisher | None = None,
        receipts: S3Receipts | None = None,
        queue_depths: Callable[[], dict[str, int]] | None = None,
        max_drain_iterations: int = 90,
        now: Callable[[], str] = utc_now_iso,
    ) -> None:
        self._runs = runs
        self._experiments = experiments
        self._batches = batches
        self._ledger = ledger
        self._deliveries = deliveries
        self._publisher = publisher
        self._receipts = receipts
        self._queue_depths = queue_depths
        self._max_drain_iterations = max_drain_iterations
        self._now = now

    def init_run(self, run_id: str) -> dict[str, Any]:
        run = self._runs.require(run_id)
        meta = self._batches.require_meta(run["batch_id"])
        run = self._runs.start(run_id, budget_paise=meta.total_budget_paise, started_at=self._now())
        return {"run_id": run_id, "budget_remaining_paise": run["budget_remaining_paise"]}

    def inject_phase(self, run_id: str, phase: InjectionPhase) -> dict[str, Any]:
        if self._publisher is None:
            raise RuntimeError("publisher not configured")
        run = self._runs.require(run_id)
        definition = definition_of(self._experiments.require(run["experiment_id"]))
        meta = self._batches.require_meta(definition.batch_id)
        events = plan_phase(
            run_id=run_id,
            phase=phase,
            definition=definition,
            batch=meta,
            entitlements=self._batches.list_entitlements(definition.batch_id),
        )
        run_phase = RunPhase.PHASE_A if phase is InjectionPhase.A else RunPhase.PHASE_B
        self._runs.update(
            run_id,
            {"phase": run_phase.value, f"phase_{phase.value.lower()}_started_at": self._now()},
            require_status=RunStatus.RUNNING,
        )
        sent = self._publisher.publish(events)
        return {"phase": phase.value, "sent": sent}

    def check_drain(self, run_id: str, phase: InjectionPhase, iteration: int) -> dict[str, Any]:
        """One pass of the drain loop. `drained` decides; queue depths are context only."""
        run = self._runs.require(run_id)
        target = int(
            run["phase_a_target"] if phase is InjectionPhase.A else run["expected_deliveries"]
        )
        delivered = int(run.get("delivered_count", 0))
        next_iteration = iteration + 1
        drained = delivered >= target
        depths = self._queue_depths() if self._queue_depths else {}
        return {
            "phase": phase.value,
            "iteration": next_iteration,
            "delivered_count": delivered,
            "target": target,
            "drained": drained,
            "timed_out": not drained and next_iteration >= self._max_drain_iterations,
            **depths,
        }

    def _evaluate(self, run: Mapping[str, Any]) -> InvariantReport:
        meta = self._batches.require_meta(run["batch_id"])
        entitlements = self._batches.list_entitlements(run["batch_id"])
        eligible = key_entitlements(meta.scheme_id, meta.academic_year, entitlements)
        effects = self._ledger.list_effects(run["run_id"])
        deliveries = self._deliveries.list_deliveries(run["run_id"])
        if len(deliveries) != int(run["expected_deliveries"]):
            raise InconsistentDeliveriesError(
                f"Recorded {len(deliveries)} deliveries, expected {run['expected_deliveries']}"
            )
        return evaluate_run(
            eligible=eligible,
            effects=effects,
            deliveries=deliveries,
            budget_paise=meta.total_budget_paise,
        )

    def evaluate(self, run_id: str) -> dict[str, Any]:
        run = self._runs.update(
            run_id, {"phase": RunPhase.EVALUATING.value}, require_status=RunStatus.RUNNING
        )
        report = self._evaluate(run)
        self._runs.update(
            run_id,
            {
                "summary": report.summary.to_dict(),
                "invariants": [invariant.to_dict() for invariant in report.invariants],
                "verdict": report.verdict.value,
                "finished_at": self._now(),
            },
            require_status=RunStatus.RUNNING,
        )
        return {"verdict": report.verdict.value}

    def generate_receipt(self, run_id: str) -> dict[str, Any]:
        if self._receipts is None:
            raise RuntimeError("receipt store not configured")
        run = self._runs.require(run_id)
        if run.get("status") == RunStatus.COMPLETED.value and run.get("receipt_sha256"):
            # Step Functions retried this task after it had already succeeded.
            return {
                "receipt_s3_key": run["receipt_s3_key"],
                "receipt_sha256": run["receipt_sha256"],
            }
        report = self._evaluate(run)
        if report.verdict.value != run.get("verdict"):
            raise EvaluationMismatchError(
                f"stored verdict {run.get('verdict')}, recomputed {report.verdict}"
            )
        experiment = self._experiments.require(run["experiment_id"])
        receipt = build_receipt(
            run_id=run_id,
            processor=ProcessorName(run["processor"]),
            experiment_id=run["experiment_id"],
            fingerprint=experiment["fingerprint"],
            batch=self._batches.require_meta(run["batch_id"]),
            report=report,
            execution_arn=run.get("sfn_execution_arn", ""),
            started_at=run["started_at"],
            finished_at=run["finished_at"],
        )
        key = receipt_s3_key(run_id)
        sha256 = self._receipts.put(key, canonical_json(receipt).encode("utf-8"))
        self._runs.update(
            run_id,
            {
                "status": RunStatus.COMPLETED.value,
                "phase": RunPhase.COMPLETE.value,
                "receipt_s3_key": key,
                "receipt_sha256": sha256,
                "completed_at": self._now(),
            },
            require_status=RunStatus.RUNNING,
        )
        return {"receipt_s3_key": key, "receipt_sha256": sha256}

    def finish_race(self, run_id: str) -> dict[str, Any]:
        """Race Lab: count what the parallel copies actually did, from the ledger."""
        run = self._runs.require(run_id)
        effects = self._ledger.list_effects(run_id)
        deliveries = self._deliveries.list_deliveries(run_id)
        amount = int(run.get("amount_paise", 0))
        payments = len(effects)
        outcomes = {outcome.value: 0 for outcome in DeliveryOutcome}
        for delivery in deliveries:
            outcomes[delivery.outcome.value] += 1
        race = {
            "copies": int(run.get("copies", 0)),
            "recorded": len(deliveries),
            "payments": payments,
            "suppressed": outcomes[DeliveryOutcome.DUPLICATE_SUPPRESSED.value],
            "extra_payments": max(0, payments - 1),
            "overpaid_paise": max(0, payments - 1) * amount,
        }
        self._runs.update(
            run_id,
            {
                "race": race,
                # One entitlement, many copies: exactly one payment is the only correct result.
                "verdict": "PASS" if payments == 1 else "FAIL",
                "status": RunStatus.COMPLETED.value,
                "phase": RunPhase.COMPLETE.value,
                "finished_at": self._now(),
            },
            require_status=RunStatus.RUNNING,
        )
        return {"run_id": run_id, **race}

    def mark_failed(self, run_id: str, error: Mapping[str, Any]) -> dict[str, Any]:
        """Record why the workflow stopped. Never overwrites a COMPLETED run."""
        name = str(error.get("Error", "Unknown"))
        message = _describe_cause(error.get("Cause"))
        if name == DRAIN_TIMEOUT_ERROR:
            reason = FailureReason.DRAIN_TIMEOUT
        elif name == InconsistentDeliveriesError.__name__:
            reason = FailureReason.INCONSISTENT_DELIVERIES
        else:
            # Never surface a raw exception message: AWS errors can contain ARNs, table
            # names or role names. The run record gets the error type only; the full
            # error is in the workflow's CloudWatch log line for this run.
            reason = FailureReason.TASK_ERROR
            error_type = name if SAFE_ERROR_NAME.fullmatch(name) else "Error"
            message = (
                f"A workflow step failed ({error_type}). Details are in the run's CloudWatch logs."
            )
        updates: dict[str, object] = {
            "status": RunStatus.FAILED.value,
            "phase": RunPhase.FAILED.value,
            "failure_reason": reason.value,
            "failure_message": message[:MAX_FAILURE_MESSAGE],
            "finished_at": self._now(),
        }
        if self._queue_depths is not None:
            updates["dlq_depth_at_failure"] = self._queue_depths().get("dlq_visible", 0)
        try:
            self._runs.update(run_id, updates, forbid_status=RunStatus.COMPLETED)
        except (ConflictError, NotFoundError):
            return {"run_id": run_id, "recorded": False}
        return {"run_id": run_id, "recorded": True, "failure_reason": reason.value}


def _describe_cause(cause: object) -> str:
    """Step Functions passes a Lambda error's Cause as JSON text; keep only the message."""
    if not isinstance(cause, str) or not cause:
        return ""
    try:
        parsed = json.loads(cause)
    except json.JSONDecodeError:
        return cause
    if isinstance(parsed, dict):
        return str(parsed.get("errorMessage") or parsed.get("Cause") or cause)
    return cause
