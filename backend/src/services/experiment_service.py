"""Experiment use cases: define (content-addressed, idempotent) and read.

Owns: re-verifying the batch content hash, building the canonical definition,
fingerprinting it and storing it.
Must never: talk to AWS directly (repositories do).
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from adapters.dynamodb.batches_repo import BatchesRepository
from adapters.dynamodb.experiments_repo import ExperimentsRepository
from common.clock import utc_now_iso
from common.errors import ConflictError
from domain.demo_data import DEMO_BATCH_ID, DEMO_CREATED_AT, DEMO_DUPLICATE_COUNT, DEMO_SEED
from domain.experiment import (
    assign_logical_events,
    build_definition,
    expected_deliveries,
    experiment_id_for,
)
from domain.fingerprint import batch_content_sha256, canonical_json, fingerprint
from domain.validation import require_int, require_str
from services.views import public_experiment


class ExperimentService:
    def __init__(
        self,
        batches: BatchesRepository,
        experiments: ExperimentsRepository,
        *,
        now: Callable[[], str] = utc_now_iso,
    ) -> None:
        self._batches = batches
        self._experiments = experiments
        self._now = now

    def create(self, body: Mapping[str, Any]) -> tuple[int, dict[str, Any]]:
        """POST /experiments. Returns 201 when new, 200 when the same definition exists."""
        batch_id = require_str(body, "batch_id", max_length=64)
        seed = require_str(body, "seed", max_length=64)
        duplicate_count = require_int(body, "duplicate_count", minimum=1)
        experiment, created = self.define(batch_id, seed, duplicate_count, self._now())
        return (201 if created else 200), {"experiment": public_experiment(experiment)}

    def define(
        self, batch_id: str, seed: str, duplicate_count: int, created_at: str
    ) -> tuple[dict[str, Any], bool]:
        meta = self._batches.require_meta(batch_id)
        entitlements = self._batches.list_entitlements(batch_id)
        content_sha256 = batch_content_sha256(entitlements)
        if content_sha256 != meta.content_sha256 or len(entitlements) != meta.count:
            raise ConflictError(f"Batch {batch_id} content does not match its recorded hash")

        definition = build_definition(
            batch_id=batch_id,
            batch_content_sha256=content_sha256,
            entitlement_count=len(entitlements),
            seed=seed,
            duplicate_count=duplicate_count,
        )
        definition_dict = definition.to_dict()
        replay_fingerprint = fingerprint(definition_dict)
        phase_a_deliveries, total_deliveries = expected_deliveries(definition)
        experiment: dict[str, Any] = {
            "experiment_id": experiment_id_for(replay_fingerprint),
            "batch_id": batch_id,
            "batch_name": meta.name,
            "seed": seed,
            "duplicate_count": duplicate_count,
            "logical_events": definition.logical_events,
            "duplicated_logical_ids": list(definition.duplicated_logical_ids),
            "phase_a": list(definition.phase_a),
            "phase_b": list(definition.phase_b),
            # The exact bytes the fingerprint was computed from.
            "definition_json": canonical_json(definition_dict),
            "fingerprint": replay_fingerprint,
            "phase_a_deliveries": phase_a_deliveries,
            "expected_deliveries": total_deliveries,
            "created_at": created_at,
        }
        created = self._experiments.put_if_absent(experiment)
        if not created:
            experiment = self._experiments.require(experiment["experiment_id"])
        return experiment, created

    def get(self, experiment_id: str) -> dict[str, Any]:
        experiment = self._experiments.require(experiment_id)
        entitlements = self._batches.list_entitlements(experiment["batch_id"])
        duplicated = set(experiment["duplicated_logical_ids"])
        # Which student each logical event pays, so the UI can name the duplicated ones.
        events = [
            {
                "logical_event_id": logical_id,
                "beneficiary_id": entitlement.beneficiary_id,
                "display_name": entitlement.display_name,
                "installment": entitlement.installment,
                "amount_paise": entitlement.amount_paise,
                "phase": "A" if logical_id in duplicated else "B",
            }
            for logical_id, entitlement in assign_logical_events(entitlements)
        ]
        return {"experiment": public_experiment(experiment), "logical_events": events}

    def ensure_demo_experiment(self) -> dict[str, Any]:
        experiment, _ = self.define(DEMO_BATCH_ID, DEMO_SEED, DEMO_DUPLICATE_COUNT, DEMO_CREATED_AT)
        return experiment
