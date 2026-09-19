"""CloudFormation custom resource: seeds the golden demo batch and experiment on deploy.

Creates "Post-Matric Scholarship 2026-27 — Demo Batch" (100 synthetic students,
₹10,000 each) and its experiment (seed FC-2026-0918, D = 12). Both writes are
idempotent, so stack updates re-run the seed harmlessly. On stack deletion it
does nothing: the tables are deleted with the stack anyway.

It always reports back to CloudFormation (in `finally`); a custom resource that
never answers would leave the stack waiting until the service timeout.
"""

from __future__ import annotations

import json
import urllib.request
from typing import Any

from common.logging import get_logger
from services.batch_service import BatchService
from services.container import repositories
from services.experiment_service import ExperimentService

logger = get_logger("seed")
PHYSICAL_RESOURCE_ID = "disburseproof-demo-seed"


def _send_response(
    event: dict[str, Any], context: Any, status: str, reason: str, data: dict[str, Any]
) -> None:
    body = json.dumps(
        {
            "Status": status,
            "Reason": reason or f"See CloudWatch log stream {context.log_stream_name}",
            "PhysicalResourceId": PHYSICAL_RESOURCE_ID,
            "StackId": event["StackId"],
            "RequestId": event["RequestId"],
            "LogicalResourceId": event["LogicalResourceId"],
            "Data": data,
        }
    ).encode("utf-8")
    request = urllib.request.Request(  # URL: the pre-signed S3 URL CloudFormation sent
        event["ResponseURL"],
        data=body,
        method="PUT",
        headers={"content-type": "", "content-length": str(len(body))},
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        logger.info(
            "custom resource response sent",
            extra={"status": status, "http_status": response.status},
        )


@logger.inject_lambda_context
def handler(event: dict[str, Any], context: Any) -> None:
    status, reason, data = "SUCCESS", "", {}
    try:
        if event["RequestType"] in ("Create", "Update"):
            repos = repositories()
            batch = BatchService(repos.batches, repos.experiments).ensure_demo_batch()
            experiment = ExperimentService(
                repos.batches, repos.experiments
            ).ensure_demo_experiment()
            data = {
                "BatchId": batch.batch_id,
                "ExperimentId": experiment["experiment_id"],
                "Fingerprint": experiment["fingerprint"],
            }
            logger.info("demo data seeded", extra=data)
    except Exception as error:
        logger.exception("seeding failed")
        status, reason = "FAILED", f"{type(error).__name__}: {error}"[:500]
    finally:
        _send_response(event, context, status, reason, data)
