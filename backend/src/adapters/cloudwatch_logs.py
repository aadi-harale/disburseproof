"""CloudWatch Logs access for the AWS evidence drawer.

Owns: fetching the structured JSON log lines of one run. Every worker and
workflow log line is a JSON object carrying `run_id`, so a JSON filter pattern
`{ $.run_id = "<run_id>" }` selects exactly that run's lines.
Must never: be used to compute results; logs are evidence, DynamoDB is the record.
"""

from __future__ import annotations

import json
import re
from functools import cache
from typing import Any

import boto3

RUN_ID_PATTERN = re.compile(r"run_[0-9A-Z]{26}")


@cache
def logs_client() -> Any:
    return boto3.client("logs")


def run_log_lines(
    log_group: str, run_id: str, *, start_ms: int, limit: int = 50, client: Any | None = None
) -> list[dict[str, Any]]:
    """The last `limit` JSON log lines for `run_id` in `log_group`, oldest first."""
    if not RUN_ID_PATTERN.fullmatch(run_id):
        raise ValueError("run_id has an unexpected format")  # never interpolate untrusted text
    logs = client or logs_client()
    kwargs: dict[str, Any] = {
        "logGroupName": log_group,
        "filterPattern": f'{{ $.run_id = "{run_id}" }}',
        "startTime": start_ms,
        "limit": 500,
    }
    lines: list[dict[str, Any]] = []
    for _ in range(4):  # a run produces a few hundred lines; four pages is plenty
        response = logs.filter_log_events(**kwargs)
        for event in response.get("events", []):
            try:
                message: Any = json.loads(event["message"])
            except (json.JSONDecodeError, TypeError):
                message = event["message"]
            lines.append({"timestamp": event["timestamp"], "message": message})
        token = response.get("nextToken")
        if not token:
            break
        kwargs["nextToken"] = token
    lines.sort(key=lambda line: line["timestamp"])
    return lines[-limit:]
