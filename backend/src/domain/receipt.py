"""The integrity receipt: a self-contained JSON record of one evaluated run.

Owns: the receipt's shape. The receipt is serialised with canonical JSON and its
SHA-256 is stored on the run, so the UI can show that the stored receipt still
matches the hash recorded when it was written ("SHA-256 fingerprinted receipt").
Must never: perform I/O or include wall-clock "now" (regenerating a receipt for
the same run must produce the same bytes, so a retried task is harmless).
"""

from __future__ import annotations

from common.clock import millis_between
from domain.models import BatchMeta, InvariantReport, ProcessorName

RECEIPT_VERSION = 1
RECEIPT_KIND = "disburseproof.integrity_receipt"
CLAIM_BOUNDARY = (
    "One business effect per entitlement under the tested replay. This is evidence about "
    "this run only, not a guarantee of exactly-once delivery or of future executions. "
    "All data is synthetic: no real money, bank APIs or personal data."
)


def receipt_s3_key(run_id: str) -> str:
    return f"receipts/{run_id}.json"


def build_receipt(
    *,
    run_id: str,
    processor: ProcessorName,
    experiment_id: str,
    fingerprint: str,
    batch: BatchMeta,
    report: InvariantReport,
    execution_arn: str,
    started_at: str,
    finished_at: str,
) -> dict[str, object]:
    summary = report.summary
    return {
        "receipt_version": RECEIPT_VERSION,
        "kind": RECEIPT_KIND,
        "run_id": run_id,
        "processor": processor.value,
        "experiment_id": experiment_id,
        "replay_fingerprint": fingerprint,
        "batch": {
            "batch_id": batch.batch_id,
            "name": batch.name,
            "scheme_id": batch.scheme_id,
            "academic_year": batch.academic_year,
            "entitlements": batch.count,
            "total_budget_paise": batch.total_budget_paise,
            "content_sha256": batch.content_sha256,
        },
        "counts": {
            "deliveries": summary.deliveries,
            "ledger_effects": summary.ledger_effects,
            "paid_once": summary.paid_once,
            "double_paid": summary.double_paid,
            "unpaid": summary.unpaid,
            "duplicates_suppressed": summary.duplicates_suppressed,
            "budget_exhausted": summary.budget_exhausted,
            "spent_paise": summary.spent_paise,
            "misallocated_paise": summary.misallocated_paise,
        },
        "double_paid_beneficiary_ids": list(summary.double_paid_beneficiary_ids),
        "unpaid_beneficiary_ids": list(summary.unpaid_beneficiary_ids),
        "invariants": [invariant.to_dict() for invariant in report.invariants],
        "verdict": report.verdict.value,
        "execution": {
            "step_functions_execution_arn": execution_arn,
            "started_at": started_at,
            "finished_at": finished_at,
            "duration_ms": millis_between(started_at, finished_at),
        },
        "claim_boundary": CLAIM_BOUNDARY,
    }
