"""Structured JSON logging and CloudWatch metrics (aws-lambda-powertools).

Owns: the one Logger and Metrics configuration used by every Lambda. Each log
line is a single JSON object, so CloudWatch Logs filter patterns such as
`{ $.run_id = "run_01J..." }` can pull every line for one run (the AWS evidence
drawer does exactly that). Metrics are emitted with the Embedded Metric Format:
they are written to stdout and need no PutMetricData permission.

Powertools is used for Logger and Metrics only. Its idempotency utility is
deliberately NOT used; implementing and explaining idempotency ourselves is the
point of this project (see docs/adr/0002-transactional-idempotency.md).

Must never: influence business decisions.
"""

from __future__ import annotations

from aws_lambda_powertools import Logger, Metrics
from aws_lambda_powertools.metrics import MetricUnit

METRICS_NAMESPACE = "DisburseProof"

__all__ = ["METRICS_NAMESPACE", "MetricUnit", "get_logger", "get_metrics"]


def get_logger(service: str) -> Logger:
    """A JSON logger whose lines all carry `service` plus any appended context keys."""
    return Logger(service=service)


def get_metrics(service: str) -> Metrics:
    return Metrics(namespace=METRICS_NAMESPACE, service=service)
