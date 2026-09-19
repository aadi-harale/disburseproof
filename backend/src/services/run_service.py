"""Run use cases for the API: start, list, read, per-student state, overview.

Owns: the active-run cap (a cost guard for a public, unauthenticated endpoint),
creating the Run record and starting its Step Functions execution, and assembling
read models from stored rows.
Must never: compute a verdict (the workflow's Evaluate step does, once).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

from adapters.dynamodb.batches_repo import BatchesRepository
from adapters.dynamodb.deliveries_repo import DeliveriesRepository
from adapters.dynamodb.experiments_repo import ExperimentsRepository
from adapters.dynamodb.ledger_repo import LedgerRepository
from adapters.dynamodb.rate_limits_repo import RateLimiter
from adapters.dynamodb.runs_repo import RunsRepository
from adapters.stepfunctions_client import StepFunctionsClient
from common.clock import utc_now_iso
from common.errors import ConflictError, NotFoundError
from common.ids import new_run_id
from domain.demo_data import DEMO_BATCH_ID
from domain.idempotency import key_entitlements
from domain.models import (
    BatchMeta,
    DeliveryOutcome,
    Entitlement,
    FailureReason,
    ProcessorName,
    RunPhase,
    RunStatus,
    StudentState,
)
from domain.requests import parse_start_run
from domain.student_state import derive_student_views
from services.views import public_batch, public_experiment, public_run

EXPERIMENT_PROCESSORS = (ProcessorName.VULNERABLE, ProcessorName.PROTECTED)


class RunService:
    def __init__(
        self,
        *,
        runs: RunsRepository,
        experiments: ExperimentsRepository,
        batches: BatchesRepository,
        ledger: LedgerRepository,
        deliveries: DeliveriesRepository,
        step_functions: StepFunctionsClient | None,
        max_active_runs: int,
        limiter: RateLimiter | None = None,
        runs_per_hour: int = 30,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        region: str = "",
        now: Callable[[], str] = utc_now_iso,
        new_id: Callable[[], str] = new_run_id,
    ) -> None:
        self._runs = runs
        self._experiments = experiments
        self._batches = batches
        self._ledger = ledger
        self._deliveries = deliveries
        self._step_functions = step_functions
        self._max_active_runs = max_active_runs
        self._limiter = limiter
        self._runs_per_hour = runs_per_hour
        self._clock = clock
        self._region = region
        self._now = now
        self._new_id = new_id
        # Batches are immutable once written, so their entitlements can be cached
        # for the life of the Lambda container (the live grid polls every 2 s).
        self._entitlement_cache: dict[str, tuple[BatchMeta, list[Entitlement]]] = {}

    # --- Commands ---------------------------------------------------------------

    def start(self, body: Mapping[str, Any]) -> tuple[int, dict[str, Any]]:
        """POST /runs: create the Run record, then start its execution (name = run_id)."""
        experiment_id, processor = parse_start_run(body)
        if self._step_functions is None:
            raise RuntimeError("Step Functions client is not configured")

        experiment = self._experiments.require(experiment_id)
        meta, _ = self._batch(experiment["batch_id"])
        # Cost guard: this endpoint is public and unauthenticated (single demo operator).
        if self._step_functions.count_running(self._max_active_runs) >= self._max_active_runs:
            raise ConflictError(
                f"{self._max_active_runs} runs are already in progress. Try again when one finishes."
            )
        # Cost guard: at most N runs started per UTC hour, checked and counted atomically.
        if self._limiter is not None:
            self._limiter.consume("runs", limit=self._runs_per_hour, now=self._clock(), what="runs")

        run_id, now = self._new_id(), self._now()
        run = {
            "run_id": run_id,
            "experiment_id": experiment_id,
            "batch_id": meta.batch_id,
            "batch_name": meta.name,
            "fingerprint": experiment["fingerprint"],
            "processor": processor.value,
            "status": RunStatus.QUEUED.value,
            "phase": RunPhase.QUEUED.value,
            "logical_events": int(experiment["logical_events"]),
            "duplicate_count": int(experiment["duplicate_count"]),
            "phase_a_target": int(experiment["phase_a_deliveries"]),
            "expected_deliveries": int(experiment["expected_deliveries"]),
            "total_budget_paise": meta.total_budget_paise,
            "budget_remaining_paise": meta.total_budget_paise,
            "delivered_count": 0,
            "committed_count": 0,
            "suppressed_count": 0,
            "budget_exhausted_count": 0,
            "created_at": now,
        }
        self._runs.create(run)
        try:
            execution_arn = self._step_functions.start_run(run_id)
        except Exception as error:
            self._runs.update(
                run_id,
                {
                    "status": RunStatus.FAILED.value,
                    "phase": RunPhase.FAILED.value,
                    "failure_reason": FailureReason.START_FAILED.value,
                    "failure_message": f"Could not start the workflow: {type(error).__name__}",
                    "finished_at": self._now(),
                },
            )
            raise
        run = self._runs.update(run_id, {"sfn_execution_arn": execution_arn})
        return 202, {"run": public_run(run)}

    # --- Queries ----------------------------------------------------------------

    def list(self, query: Mapping[str, str]) -> dict[str, Any]:
        runs = self._runs.list_recent(limit=100)
        experiment_id, processor = query.get("experiment_id"), query.get("processor")
        if experiment_id:
            runs = [run for run in runs if run.get("experiment_id") == experiment_id]
        if processor:
            runs = [run for run in runs if run.get("processor") == processor]
        return {"items": [public_run(run) for run in runs]}

    def get(self, run_id: str) -> dict[str, Any]:
        return {"run": public_run(self._runs.require(run_id))}

    def students(self, run_id: str) -> dict[str, Any]:
        """GET /runs/{id}/students: one tile per entitlement."""
        run = self._runs.require(run_id)
        views, _, _ = self._student_views(run)
        counts = {state.value: 0 for state in StudentState}
        for view in views:
            counts[view.state.value] += 1
        return {
            "run_id": run_id,
            "status": run["status"],
            "counts": counts,
            "items": [view.to_dict() for view in views],
        }

    def student_detail(self, run_id: str, beneficiary_id: str) -> dict[str, Any]:
        """GET /runs/{id}/students/{beneficiary_id}: every delivery for one student."""
        run = self._runs.require(run_id)
        views, effects, deliveries = self._student_views(run)
        mine = [view for view in views if view.beneficiary_id == beneficiary_id]
        if not mine:
            raise NotFoundError(f"Student {beneficiary_id} is not in run {run_id}")

        timeline = [
            {
                "delivery_id": d.delivery_id,
                "logical_event_id": d.logical_event_id,
                "entitlement_key": d.entitlement_key,
                "installment": d.installment,
                "phase": d.phase.value,
                "copy_index": d.copy_index,
                "duplicate_of": d.duplicate_of,
                "outcome": d.outcome.value,
                "processed_at": d.processed_at,
                "lambda_request_id": d.lambda_request_id,
                "attempt": d.attempt,
                "effect_id": d.effect_id,
                "budget_remaining_paise_at_rejection": d.budget_remaining_paise_at_rejection,
            }
            for d in deliveries
            if d.beneficiary_id == beneficiary_id
        ]
        payments = [
            {
                "effect_id": e.effect_id,
                "entitlement_key": e.entitlement_key,
                "amount_paise": e.amount_paise,
                "delivery_id": e.delivery_id,
                "committed_at": e.committed_at,
            }
            for e in effects
            if e.beneficiary_id == beneficiary_id
        ]
        # For a starved student: who received the money instead (the double-paid students).
        double_paid = [
            {
                "beneficiary_id": v.beneficiary_id,
                "display_name": v.display_name,
                "payments": v.payments,
            }
            for v in views
            if v.state is StudentState.PAID_TWICE
        ]
        starved = any(view.state is StudentState.UNPAID for view in mine)
        return {
            "run": public_run(run),
            "student": {"beneficiary_id": beneficiary_id, "display_name": mine[0].display_name},
            "entitlements": [view.to_dict() for view in mine],
            "deliveries": timeline,
            "payments": payments,
            "rejections": [
                row for row in timeline if row["outcome"] == DeliveryOutcome.BUDGET_EXHAUSTED.value
            ],
            "double_paid_students": double_paid if starved else [],
        }

    def deliveries(self, run_id: str) -> dict[str, Any]:
        """GET /runs/{id}/deliveries: every recorded delivery, oldest first, for replay.

        Read-only. Each row carries its entitlement's amount so a client can replay
        the budget without guessing; nothing here is derived beyond that join.
        """
        run = self._runs.require(run_id)
        meta, entitlements = self._batch(run["batch_id"])
        keyed = key_entitlements(meta.scheme_id, meta.academic_year, entitlements)
        rows = self._deliveries.list_deliveries(run_id)
        return {
            "run_id": run_id,
            "status": run["status"],
            "items": [
                {
                    "delivery_id": d.delivery_id,
                    "logical_event_id": d.logical_event_id,
                    "entitlement_key": d.entitlement_key,
                    "beneficiary_id": d.beneficiary_id,
                    "installment": d.installment,
                    "amount_paise": keyed[d.entitlement_key].amount_paise
                    if d.entitlement_key in keyed
                    else None,
                    "phase": d.phase.value,
                    "copy_index": d.copy_index,
                    "duplicate_of": d.duplicate_of,
                    "outcome": d.outcome.value,
                    "processed_at": d.processed_at,
                    "effect_id": d.effect_id,
                    "budget_remaining_paise_at_rejection": d.budget_remaining_paise_at_rejection,
                }
                for d in rows
            ],
        }

    def overview(self) -> dict[str, Any]:
        """GET /overview: the demo batch and experiment, plus the latest run of each processor."""
        meta = self._batches.get_meta(DEMO_BATCH_ID)
        experiments = self._experiments.list_for_batch(DEMO_BATCH_ID) if meta else []
        # The demo experiment is the oldest one on the demo batch (created by the deploy seed).
        demo_experiment = min(experiments, key=lambda x: x["created_at"]) if experiments else None
        recent = self._runs.list_recent(limit=100)
        latest: dict[str, Any] = {}
        for processor in EXPERIMENT_PROCESSORS:
            match = next(
                (
                    r
                    for r in recent
                    if r.get("processor") == processor.value
                    and (
                        demo_experiment is None
                        or r.get("experiment_id") == demo_experiment["experiment_id"]
                    )
                ),
                None,
            )
            latest[processor.value] = public_run(match) if match else None
        active = [r for r in recent if not RunStatus(r["status"]).is_terminal]
        return {
            "demo": {
                "batch": public_batch(meta) if meta else None,
                "experiment": public_experiment(demo_experiment) if demo_experiment else None,
            },
            "latest": latest,
            "active_runs": [public_run(r) for r in active],
            "max_active_runs": self._max_active_runs,
            "region": self._region,
        }

    # --- Helpers ----------------------------------------------------------------

    def _batch(self, batch_id: str) -> tuple[BatchMeta, list[Entitlement]]:
        cached = self._entitlement_cache.get(batch_id)
        if cached is None:
            cached = (
                self._batches.require_meta(batch_id),
                self._batches.list_entitlements(batch_id),
            )
            self._entitlement_cache[batch_id] = cached
        return cached

    def _student_views(self, run: Mapping[str, Any]) -> tuple[list[Any], list[Any], list[Any]]:
        meta, entitlements = self._batch(run["batch_id"])
        eligible = key_entitlements(meta.scheme_id, meta.academic_year, entitlements)
        effects = self._ledger.list_effects(run["run_id"])
        deliveries = self._deliveries.list_deliveries(run["run_id"])
        views = derive_student_views(
            eligible=eligible,
            effects=effects,
            deliveries=deliveries,
            run_evaluated=run.get("verdict") is not None,
        )
        return views, effects, deliveries
