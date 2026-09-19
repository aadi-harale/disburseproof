"""Typed runtime configuration, read once from environment variables.

Owns: every environment variable the Lambdas read. Table names, queue URLs, the
receipts bucket and the state machine ARN are injected by template.yaml, so no
resource name is hard-coded anywhere in src/.
Must never: call AWS or hold secrets (there are none; IAM roles grant access).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import cache


class ConfigError(RuntimeError):
    """A required environment variable is missing or malformed. Fails the cold start."""


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"Missing required environment variable {name}")
    return value


def _optional(name: str) -> str | None:
    value = os.environ.get(name, "").strip()
    return value or None


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError as exc:
        raise ConfigError(f"{name} must be an integer, got {raw!r}") from exc


@dataclass(frozen=True, slots=True)
class Settings:
    env_name: str
    aws_region: str
    batches_table: str
    experiments_table: str
    runs_table: str
    ledger_table: str
    idempotency_table: str
    deliveries_table: str
    deliveries_queue_url: str
    deliveries_dlq_url: str
    receipts_bucket: str
    max_active_runs: int
    max_drain_iterations: int
    # Only the API functions that start or inspect executions receive these. The
    # workflow task functions cannot: the state machine references their ARNs, so
    # giving them the state machine ARN would create a CloudFormation cycle.
    state_machine_arn: str | None
    worker_log_group: str | None
    workflow_log_group: str | None

    def require_state_machine_arn(self) -> str:
        if not self.state_machine_arn:
            raise ConfigError("STATE_MACHINE_ARN is not configured for this function")
        return self.state_machine_arn


@cache
def get_settings() -> Settings:
    """Read the environment once per Lambda container; raise ConfigError if incomplete."""
    return Settings(
        env_name=_required("ENV_NAME"),
        aws_region=_required("AWS_REGION"),
        batches_table=_required("BATCHES_TABLE"),
        experiments_table=_required("EXPERIMENTS_TABLE"),
        runs_table=_required("RUNS_TABLE"),
        ledger_table=_required("LEDGER_TABLE"),
        idempotency_table=_required("IDEMPOTENCY_TABLE"),
        deliveries_table=_required("DELIVERIES_TABLE"),
        deliveries_queue_url=_required("DELIVERIES_QUEUE_URL"),
        deliveries_dlq_url=_required("DELIVERIES_DLQ_URL"),
        receipts_bucket=_required("RECEIPTS_BUCKET"),
        max_active_runs=_int("MAX_ACTIVE_RUNS", 2),
        max_drain_iterations=_int("MAX_DRAIN_ITERATIONS", 90),
        state_machine_arn=_optional("STATE_MACHINE_ARN"),
        worker_log_group=_optional("WORKER_LOG_GROUP"),
        workflow_log_group=_optional("WORKFLOW_LOG_GROUP"),
    )
