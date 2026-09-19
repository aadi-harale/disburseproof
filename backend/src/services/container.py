"""Wiring: builds repositories and clients from Settings, once per Lambda container.

Owns: object construction. Handlers ask the container for a service instead of
constructing adapters themselves, which keeps handlers thin and lets tests build
services with fakes instead.
Must never: contain logic.
"""

from __future__ import annotations

from dataclasses import dataclass
from functools import cache

from adapters.dynamodb.batches_repo import BatchesRepository
from adapters.dynamodb.deliveries_repo import DeliveriesRepository
from adapters.dynamodb.disbursement_store import DynamoDisbursementStore
from adapters.dynamodb.experiments_repo import ExperimentsRepository
from adapters.dynamodb.ledger_repo import LedgerRepository
from adapters.dynamodb.rate_limits_repo import RateLimiter
from adapters.dynamodb.runs_repo import RunsRepository
from adapters.s3_receipts import S3Receipts
from adapters.sqs_publisher import SqsPublisher, queue_depths
from common.config import Settings, get_settings
from services.workflow_service import WorkflowService


@dataclass(frozen=True, slots=True)
class Repositories:
    batches: BatchesRepository
    experiments: ExperimentsRepository
    runs: RunsRepository
    ledger: LedgerRepository
    deliveries: DeliveriesRepository


@cache
def settings() -> Settings:
    return get_settings()


@cache
def repositories() -> Repositories:
    config = settings()
    return Repositories(
        batches=BatchesRepository(config.batches_table),
        experiments=ExperimentsRepository(config.experiments_table),
        runs=RunsRepository(config.runs_table),
        ledger=LedgerRepository(config.ledger_table),
        deliveries=DeliveriesRepository(config.deliveries_table),
    )


@cache
def disbursement_store() -> DynamoDisbursementStore:
    config = settings()
    return DynamoDisbursementStore(
        runs_table=config.runs_table,
        ledger_table=config.ledger_table,
        idempotency_table=config.idempotency_table,
        deliveries_table=config.deliveries_table,
    )


@cache
def workflow_service() -> WorkflowService:
    config, repos = settings(), repositories()
    return WorkflowService(
        runs=repos.runs,
        experiments=repos.experiments,
        batches=repos.batches,
        ledger=repos.ledger,
        deliveries=repos.deliveries,
        publisher=SqsPublisher(config.deliveries_queue_url),
        receipts=S3Receipts(config.receipts_bucket),
        queue_depths=lambda: queue_depths(config.deliveries_queue_url, config.deliveries_dlq_url),
        max_drain_iterations=config.max_drain_iterations,
    )


@cache
def rate_limiter() -> RateLimiter:
    return RateLimiter(settings().require_rate_limits_table())
