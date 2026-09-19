"""AWS evidence for one run: execution timeline, queue depths, receipt, log lines.

Owns: assembling the "AWS evidence drawer" and the receipt read model from real
AWS APIs (Step Functions history, SQS attributes, S3, CloudWatch Logs), so a
reviewer can check that the run really executed on AWS.
Must never: compute results; this is evidence about the run, not the run's record.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from adapters.cloudwatch_logs import run_log_lines
from adapters.dynamodb.runs_repo import RunsRepository
from adapters.s3_receipts import S3Receipts
from adapters.sqs_publisher import queue_depths
from adapters.stepfunctions_client import console_url, state_timeline
from common.clock import parse_iso
from common.config import Settings
from common.errors import NotFoundError

LOG_LINES = 60
LOG_LOOKBACK_MS = 60_000


class EvidenceService:
    def __init__(self, *, runs: RunsRepository, receipts: S3Receipts, settings: Settings) -> None:
        self._runs = runs
        self._receipts = receipts
        self._settings = settings

    def evidence(self, run_id: str) -> dict[str, Any]:
        run = self._runs.require(run_id)
        execution_arn = run.get("sfn_execution_arn")
        timeline = state_timeline(execution_arn) if execution_arn else {"states": [], "steps": []}
        start_ms = int(parse_iso(run["created_at"]).timestamp() * 1000) - LOG_LOOKBACK_MS

        lines: list[dict[str, Any]] = []
        for source, group in (
            ("worker", self._settings.worker_log_group),
            ("workflow", self._settings.workflow_log_group),
        ):
            if group:
                for line in run_log_lines(group, run_id, start_ms=start_ms, limit=LOG_LINES):
                    lines.append({"source": source, **line})
        lines.sort(key=lambda line: line["timestamp"])

        return {
            "run_id": run_id,
            "region": self._settings.aws_region,
            "execution_arn": execution_arn,
            "console_url": console_url(execution_arn) if execution_arn else None,
            "states": timeline["states"],
            "steps": timeline["steps"],
            "queue": queue_depths(self._settings.deliveries_queue_url, self._settings.deliveries_dlq_url),
            "log_groups": [g for g in (self._settings.worker_log_group, self._settings.workflow_log_group) if g],
            "logs": lines[-LOG_LINES:],
        }

    def receipt(self, run_id: str) -> dict[str, Any]:
        """The stored receipt, plus a fresh check that its bytes still hash to the recorded SHA-256."""
        run = self._runs.require(run_id)
        key, recorded = run.get("receipt_s3_key"), run.get("receipt_sha256")
        if not key or not recorded:
            raise NotFoundError(f"Run {run_id} has no receipt yet")
        body = self._receipts.get(key)
        actual = hashlib.sha256(body).hexdigest()
        return {
            "run_id": run_id,
            "s3_bucket": self._settings.receipts_bucket,
            "s3_key": key,
            "sha256": recorded,
            "sha256_recomputed": actual,
            "sha256_matches": actual == recorded,
            "receipt": json.loads(body),
            # The exact stored bytes, so a browser can re-hash them independently.
            "receipt_json": body.decode("utf-8"),
        }
