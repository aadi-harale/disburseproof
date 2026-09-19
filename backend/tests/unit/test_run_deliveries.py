"""GET /runs/{id}/deliveries: the replay feed is the stored rows, oldest first, plus amounts."""

from __future__ import annotations

from typing import Any

from domain.idempotency import build_entitlement_key
from domain.models import (
    BatchMeta,
    Delivery,
    DeliveryOutcome,
    Entitlement,
    InjectionPhase,
)
from services.run_service import RunService

META = BatchMeta(
    batch_id="bat_x",
    name="Test batch",
    scheme_id="SCH",
    academic_year="2026-27",
    total_budget_paise=3_000_000,
    count=2,
    content_sha256="0" * 64,
    source="generated",
    created_at="2026-09-19T00:00:00Z",
)
ENTITLEMENTS = [
    Entitlement("STU-001", "Asha Rao", 1_000_000, 1),
    Entitlement("STU-002", "Ravi Das", 2_000_000, 1),
]


def _delivery(delivery_id: str, beneficiary: str, outcome: DeliveryOutcome, at: str) -> Delivery:
    return Delivery(
        run_id="run_1",
        delivery_id=delivery_id,
        logical_event_id=f"EVT-{beneficiary[-3:]}",
        entitlement_key=build_entitlement_key("SCH", beneficiary, "2026-27", 1),
        beneficiary_id=beneficiary,
        installment=1,
        phase=InjectionPhase.A,
        copy_index=1,
        duplicate_of=None,
        outcome=outcome,
        processed_at=at,
        lambda_request_id="req",
        attempt=1,
        effect_id="eff" if outcome is DeliveryOutcome.COMMITTED else None,
    )


class _Runs:
    def require(self, run_id: str) -> dict[str, Any]:
        return {"run_id": run_id, "batch_id": "bat_x", "status": "COMPLETED"}


class _Batches:
    def require_meta(self, batch_id: str) -> BatchMeta:
        return META

    def list_entitlements(self, batch_id: str) -> list[Entitlement]:
        return ENTITLEMENTS


class _Deliveries:
    def list_deliveries(self, run_id: str) -> list[Delivery]:
        # The repository returns rows sorted by processed_at.
        return [
            _delivery("d1", "STU-002", DeliveryOutcome.COMMITTED, "2026-09-19T00:00:01.000Z"),
            _delivery(
                "d2", "STU-002", DeliveryOutcome.DUPLICATE_SUPPRESSED, "2026-09-19T00:00:01.200Z"
            ),
            _delivery("d3", "STU-001", DeliveryOutcome.COMMITTED, "2026-09-19T00:00:02.000Z"),
        ]


def test_deliveries_are_returned_in_order_with_amounts() -> None:
    service = RunService(
        runs=_Runs(),  # type: ignore[arg-type]
        experiments=None,  # type: ignore[arg-type]
        batches=_Batches(),  # type: ignore[arg-type]
        ledger=None,  # type: ignore[arg-type]
        deliveries=_Deliveries(),  # type: ignore[arg-type]
        step_functions=None,
        max_active_runs=2,
    )
    body = service.deliveries("run_1")
    assert body["run_id"] == "run_1"
    assert body["status"] == "COMPLETED"
    assert [row["delivery_id"] for row in body["items"]] == ["d1", "d2", "d3"]
    assert [row["amount_paise"] for row in body["items"]] == [2_000_000, 2_000_000, 1_000_000]
    assert body["items"][1]["outcome"] == "DUPLICATE_SUPPRESSED"
    assert body["items"][0]["beneficiary_id"] == "STU-002"
    assert body["items"][0]["phase"] == "A"
