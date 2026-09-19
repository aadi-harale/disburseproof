"""Public JSON shapes for API responses.

Owns: which stored fields leave the API and the few derived fields the UI needs
(progress, console link, duration). One place, so every endpoint describes a run
or an experiment the same way.
Must never: compute business results.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from adapters.dynamodb.batches_repo import meta_to_dict
from adapters.stepfunctions_client import console_url
from common.clock import millis_between
from domain.models import BatchMeta, RunStatus

RUN_FIELDS = (
    "run_id", "experiment_id", "batch_id", "batch_name", "fingerprint", "processor",
    "status", "phase", "created_at", "started_at", "phase_a_started_at", "phase_b_started_at",
    "finished_at", "completed_at", "logical_events", "duplicate_count", "phase_a_target",
    "expected_deliveries", "total_budget_paise", "budget_remaining_paise", "delivered_count",
    "committed_count", "suppressed_count", "budget_exhausted_count", "summary", "invariants",
    "verdict", "receipt_s3_key", "receipt_sha256", "sfn_execution_arn", "failure_reason",
    "failure_message", "dlq_depth_at_failure", "last_delivery_at",
)  # fmt: skip

EXPERIMENT_FIELDS = (
    "experiment_id", "batch_id", "batch_name", "seed", "duplicate_count", "logical_events",
    "duplicated_logical_ids", "phase_a", "phase_b", "fingerprint", "created_at",
    "expected_deliveries", "phase_a_deliveries",
)  # fmt: skip


def public_run(run: Mapping[str, Any]) -> dict[str, Any]:
    view = {name: run.get(name) for name in RUN_FIELDS}
    status = RunStatus(run["status"])
    view["is_terminal"] = status.is_terminal
    arn = run.get("sfn_execution_arn")
    view["console_url"] = console_url(arn) if arn else None
    started, finished = run.get("started_at"), run.get("finished_at")
    view["duration_ms"] = millis_between(started, finished) if started and finished else None
    return view


def public_experiment(experiment: Mapping[str, Any]) -> dict[str, Any]:
    view = {name: experiment.get(name) for name in EXPERIMENT_FIELDS}
    view["definition"] = json.loads(experiment["definition_json"])
    return view


def public_batch(meta: BatchMeta) -> dict[str, object]:
    return meta_to_dict(meta)
