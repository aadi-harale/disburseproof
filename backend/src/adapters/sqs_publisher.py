"""SQS access: publishing deliveries and reading queue depths.

Owns: SendMessageBatch (10 messages per call) with retry of individually failed
entries, and GetQueueAttributes for the drain check and the evidence drawer.
Must never: decide which deliveries to send (domain/injection.py does).

SQS Standard is used on purpose: it delivers at least once and does not preserve
order, which is exactly the behaviour this sandbox exists to exercise.
"""

from __future__ import annotations

import json
import time
from collections.abc import Sequence
from functools import cache
from typing import Any

import boto3
from botocore.config import Config

from domain.models import DisbursementEvent

SQS_BATCH_LIMIT = 10


@cache
def sqs_client() -> Any:
    return boto3.client("sqs", config=Config(retries={"mode": "standard", "max_attempts": 5}))


class SqsPublisher:
    def __init__(self, queue_url: str, client: Any | None = None) -> None:
        self._queue_url = queue_url
        self._client = client or sqs_client()

    def publish(self, events: Sequence[DisbursementEvent]) -> int:
        """Send every event. Raises if any entry still fails after retries.

        Resending an entry is safe: delivery IDs are deterministic, so a message
        sent twice is absorbed by the worker as an SQS redelivery.
        """
        for start in range(0, len(events), SQS_BATCH_LIMIT):
            chunk = events[start : start + SQS_BATCH_LIMIT]
            entries = [
                {
                    "Id": str(index),
                    "MessageBody": json.dumps(event.to_message(), separators=(",", ":")),
                }
                for index, event in enumerate(chunk)
            ]
            self._send_with_retry(entries)
        return len(events)

    def _send_with_retry(self, entries: list[dict[str, str]]) -> None:
        pending = entries
        for attempt in range(4):
            response = self._client.send_message_batch(QueueUrl=self._queue_url, Entries=pending)
            failed = response.get("Failed", [])
            if not failed:
                return
            sender_faults = [entry for entry in failed if entry.get("SenderFault")]
            if sender_faults:
                raise RuntimeError(f"SQS rejected messages as malformed: {sender_faults}")
            failed_ids = {entry["Id"] for entry in failed}
            pending = [entry for entry in pending if entry["Id"] in failed_ids]
            time.sleep(0.1 * 2**attempt)
        raise RuntimeError(f"{len(pending)} messages could not be sent to SQS after retries")


def queue_depths(queue_url: str, dlq_url: str, client: Any | None = None) -> dict[str, int]:
    """Approximate depths. SQS documents these counts as approximate; they are shown
    as context only and never used to decide that a phase has drained."""
    sqs = client or sqs_client()
    names = ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible"]
    main = sqs.get_queue_attributes(QueueUrl=queue_url, AttributeNames=names)["Attributes"]
    dead = sqs.get_queue_attributes(QueueUrl=dlq_url, AttributeNames=names[:1])["Attributes"]
    return {
        "visible": int(main.get("ApproximateNumberOfMessages", 0)),
        "in_flight": int(main.get("ApproximateNumberOfMessagesNotVisible", 0)),
        "dlq_visible": int(dead.get("ApproximateNumberOfMessages", 0)),
    }
