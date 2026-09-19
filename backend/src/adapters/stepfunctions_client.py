"""Step Functions access: starting runs, counting active runs, reading history.

Owns: StartExecution (the execution name is the run ID, so a retried start
cannot create a second execution for the same run), ListExecutions for the
active-run cap, and GetExecutionHistory for the per-state timeline shown in the
AWS evidence drawer.
Must never: decide run outcomes.
"""

from __future__ import annotations

import json
from collections import OrderedDict
from datetime import datetime
from functools import cache
from typing import Any

import boto3
from botocore.exceptions import ClientError

from common.clock import to_iso


@cache
def sfn_client() -> Any:
    return boto3.client("stepfunctions")


def execution_arn_for(state_machine_arn: str, run_id: str) -> str:
    # arn:aws:states:<region>:<account>:stateMachine:<name>
    #   -> arn:aws:states:<region>:<account>:execution:<name>:<run_id>
    return f"{state_machine_arn.replace(':stateMachine:', ':execution:', 1)}:{run_id}"


def console_url(execution_arn: str) -> str:
    region = execution_arn.split(":")[3]
    return (
        f"https://{region}.console.aws.amazon.com/states/home?region={region}"
        f"#/v2/executions/details/{execution_arn}"
    )


class StepFunctionsClient:
    def __init__(self, state_machine_arn: str, client: Any | None = None) -> None:
        self._state_machine_arn = state_machine_arn
        self._client = client or sfn_client()

    def start_run(self, run_id: str) -> str:
        try:
            response = self._client.start_execution(
                stateMachineArn=self._state_machine_arn,
                name=run_id,
                input=json.dumps({"run_id": run_id}),
            )
        except ClientError as error:
            if error.response.get("Error", {}).get("Code") == "ExecutionAlreadyExists":
                return execution_arn_for(self._state_machine_arn, run_id)
            raise
        return str(response["executionArn"])

    def count_running(self, cap: int) -> int:
        """Number of RUNNING executions, counted up to `cap` (one small page is enough)."""
        response = self._client.list_executions(
            stateMachineArn=self._state_machine_arn, statusFilter="RUNNING", maxResults=max(cap, 1)
        )
        return len(response.get("executions", []))


def _ms(start: datetime, end: datetime) -> int:
    return int((end - start).total_seconds() * 1000)


def state_timeline(execution_arn: str, client: Any | None = None) -> dict[str, Any]:
    """Per-state durations from the execution history.

    Returns `states` (one row per state name, in first-entered order, with how many
    times it ran and its total time; the drain checks loop) and `steps` (every
    state entry in order, capped at 300).
    """
    sfn = client or sfn_client()
    events: list[dict[str, Any]] = []
    kwargs: dict[str, Any] = {"executionArn": execution_arn, "maxResults": 1000}
    while True:
        response = sfn.get_execution_history(**kwargs)
        events.extend(response.get("events", []))
        token = response.get("nextToken")
        if not token or len(events) >= 5000:
            break
        kwargs["nextToken"] = token

    steps: list[dict[str, Any]] = []
    open_steps: dict[str, dict[str, Any]] = {}
    for event in events:
        entered = event.get("stateEnteredEventDetails")
        exited = event.get("stateExitedEventDetails")
        if entered:
            step = {"name": entered["name"], "type": event["type"].replace("StateEntered", ""),
                    "entered": event["timestamp"], "exited": None}
            steps.append(step)
            open_steps[entered["name"]] = step
        elif exited and exited["name"] in open_steps:
            open_steps.pop(exited["name"])["exited"] = event["timestamp"]

    summary: OrderedDict[str, dict[str, Any]] = OrderedDict()
    for step in steps:
        row = summary.setdefault(
            step["name"],
            {"name": step["name"], "type": step["type"], "runs": 0, "total_ms": 0,
             "first_entered_at": to_iso(step["entered"])},
        )
        row["runs"] += 1
        if step["exited"] is not None:
            row["total_ms"] += _ms(step["entered"], step["exited"])

    return {
        "states": list(summary.values()),
        "steps": [
            {
                "name": step["name"],
                "type": step["type"],
                "entered_at": to_iso(step["entered"]),
                "duration_ms": None if step["exited"] is None else _ms(step["entered"], step["exited"]),
            }
            for step in steps[:300]
        ],
    }
