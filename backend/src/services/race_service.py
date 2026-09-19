"""Race Lab: many copies of ONE payment released at the same instant.

Owns: starting a race (a Step Functions Map state invokes the worker directly,
once per copy, all for the same entitlement) and reading its lanes back.

The naive processor checks the idempotency record and writes it later, with an
injected 200 ms race window in between, so overlapping copies can all see "not
paid" and all pay. The protected processor claims the key in the same
transaction as the payment, so exactly one copy can ever pay. How many naive
copies overlap depends on timing and on the account's Lambda concurrency quota,
so the naive result can vary between attempts; the UI says so.

Must never: be counted as an experiment run. Races are stored with a separate
entity type and never appear in the runs list or the comparison.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from datetime import UTC, datetime
from typing import Any

from adapters.dynamodb.deliveries_repo import DeliveriesRepository
from adapters.dynamodb.ledger_repo import LedgerRepository
from adapters.dynamodb.rate_limits_repo import RateLimiter
from adapters.dynamodb.runs_repo import RACE_ENTITY_TYPE, RunsRepository
from adapters.stepfunctions_client import StepFunctionsClient, console_url
from common.clock import utc_now_iso
from common.errors import ConflictError, NotFoundError
from common.ids import new_run_id
from domain.idempotency import build_entitlement_key
from domain.injection import derive_delivery_id
from domain.models import DisbursementEvent, InjectionPhase, ProcessorName, RunStatus
from domain.requests import parse_start_race

# One synthetic entitlement that every copy tries to pay.
RACE_SCHEME_ID = "DEMO-RACE"
RACE_BENEFICIARY_ID = "RACE-001"
RACE_ACADEMIC_YEAR = "2026-27"
RACE_LOGICAL_EVENT_ID = "EVT-001"
RACE_AMOUNT_PAISE = 1_000_000  # ₹10,000
RACE_WINDOW_MS = 200  # the naive processor's injected gap between check and write

RACE_FIELDS = (
    "run_id", "processor", "copies", "race_window_ms", "amount_paise", "status", "phase",
    "created_at", "finished_at", "verdict", "race", "failure_reason", "failure_message",
)  # fmt: skip


def public_race(run: Mapping[str, Any]) -> dict[str, Any]:
    view = {name: run.get(name) for name in RACE_FIELDS}
    view["is_terminal"] = RunStatus(run["status"]).is_terminal
    arn = run.get("sfn_execution_arn")
    view["console_url"] = console_url(arn) if arn else None
    return view


class RaceService:
    def __init__(
        self,
        *,
        runs: RunsRepository,
        ledger: LedgerRepository,
        deliveries: DeliveriesRepository,
        step_functions: StepFunctionsClient | None,
        limiter: RateLimiter | None = None,
        races_per_hour: int = 30,
        now: Callable[[], str] = utc_now_iso,
        clock: Callable[[], datetime] = lambda: datetime.now(UTC),
        new_id: Callable[[], str] = new_run_id,
    ) -> None:
        self._runs = runs
        self._ledger = ledger
        self._deliveries = deliveries
        self._step_functions = step_functions
        self._limiter = limiter
        self._races_per_hour = races_per_hour
        self._now = now
        self._clock = clock
        self._new_id = new_id

    def start(self, body: Mapping[str, Any]) -> tuple[int, dict[str, Any]]:
        """POST /race {processor, copies}: release `copies` deliveries of one entitlement at once."""
        processor, copies = parse_start_race(body)
        if self._step_functions is None:
            raise RuntimeError("Race state machine is not configured")
        # One race at a time: they share the worker and the account's concurrency quota.
        if self._step_functions.count_running(1) >= 1:
            raise ConflictError("A race is already running. Try again in a few seconds.")
        if self._limiter is not None:
            self._limiter.consume(
                "races", limit=self._races_per_hour, now=self._clock(), what="races"
            )

        run_id, now = self._new_id(), self._now()
        budget = copies * RACE_AMOUNT_PAISE  # enough for every copy: only idempotency may stop one
        run = {
            "run_id": run_id,
            "kind": "race",
            "processor": processor.value,
            "copies": copies,
            "race_window_ms": RACE_WINDOW_MS if processor is ProcessorName.NAIVE else 0,
            "amount_paise": RACE_AMOUNT_PAISE,
            "status": RunStatus.RUNNING.value,
            "phase": "RACING",
            "total_budget_paise": budget,
            "budget_remaining_paise": budget,
            "delivered_count": 0,
            "committed_count": 0,
            "suppressed_count": 0,
            "budget_exhausted_count": 0,
            "created_at": now,
            "started_at": now,
        }
        self._runs.create(run, entity_type=RACE_ENTITY_TYPE)
        arn = self._step_functions.start_run(
            run_id, {"deliveries": self._deliveries_for(run_id, copies)}
        )
        run = self._runs.update(run_id, {"sfn_execution_arn": arn})
        return 202, {"race": public_race(run)}

    @staticmethod
    def _deliveries_for(run_id: str, copies: int) -> list[dict[str, object]]:
        """`copies` different deliveries (distinct delivery IDs) of the same logical event."""
        entitlement_key = build_entitlement_key(
            RACE_SCHEME_ID, RACE_BENEFICIARY_ID, RACE_ACADEMIC_YEAR, 1
        )
        return [
            DisbursementEvent(
                run_id=run_id,
                delivery_id=derive_delivery_id(
                    run_id, InjectionPhase.A, RACE_LOGICAL_EVENT_ID, copy
                ),
                logical_event_id=RACE_LOGICAL_EVENT_ID,
                entitlement_key=entitlement_key,
                scheme_id=RACE_SCHEME_ID,
                beneficiary_id=RACE_BENEFICIARY_ID,
                academic_year=RACE_ACADEMIC_YEAR,
                installment=1,
                amount_paise=RACE_AMOUNT_PAISE,
                phase=InjectionPhase.A,
                copy_index=copy,
                duplicate_of=None if copy == 1 else RACE_LOGICAL_EVENT_ID,
            ).to_message()
            for copy in range(1, copies + 1)
        ]

    def list(self) -> dict[str, Any]:
        races = self._runs.list_recent(limit=20, entity_type=RACE_ENTITY_TYPE)
        return {"items": [public_race(run) for run in races]}

    def get(self, run_id: str) -> dict[str, Any]:
        run = self._runs.require(run_id)
        if run.get("kind") != "race":
            raise NotFoundError(f"Race {run_id} not found")
        deliveries = sorted(self._deliveries.list_deliveries(run_id), key=lambda d: d.copy_index)
        lanes = [
            {
                "copy_index": d.copy_index,
                "outcome": d.outcome.value,
                "processed_at": d.processed_at,
                "attempt": d.attempt,
                "lambda_request_id": d.lambda_request_id,
            }
            for d in deliveries
        ]
        return {
            "race": public_race(run),
            "lanes": lanes,
            "payments_so_far": len(self._ledger.list_effects(run_id)),
        }
