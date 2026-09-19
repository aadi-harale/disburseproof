"""The domain vocabulary shared by every layer.

Owns: the enums and immutable records that name things in DisburseProof. The
same words are used in code, API, UI and README:

- entitlement    one (beneficiary, installment) that is owed exactly one payment
- logical event  the single business instruction "pay this entitlement" (EVT-001 ...)
- delivery       one arrival of a logical event at the processor; retries create several
- effect         a payment written to the ledger: the business effect we count
- outcome        what the processor decided for one delivery
- run            one execution of an experiment against one processor
- experiment     a fixed, fingerprinted definition of which events are duplicated

Must never: perform I/O or import an AWS SDK.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from common.errors import ValidationError
from domain.validation import optional_str, require_enum, require_int, require_str


class ProcessorName(StrEnum):
    VULNERABLE = "vulnerable"
    PROTECTED = "protected"
    NAIVE = "naive"


class RunStatus(StrEnum):
    QUEUED = "QUEUED"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"

    @property
    def is_terminal(self) -> bool:
        return self in (RunStatus.COMPLETED, RunStatus.FAILED)


class RunPhase(StrEnum):
    QUEUED = "QUEUED"
    PHASE_A = "PHASE_A"  # the retry wave: each duplicated logical event delivered twice
    PHASE_B = "PHASE_B"  # every other logical event delivered once
    EVALUATING = "EVALUATING"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


class InjectionPhase(StrEnum):
    A = "A"
    B = "B"


class DeliveryOutcome(StrEnum):
    """What the processor recorded for one delivery. Stored on the Deliveries row."""

    COMMITTED = "COMMITTED"
    DUPLICATE_SUPPRESSED = "DUPLICATE_SUPPRESSED"
    BUDGET_EXHAUSTED = "BUDGET_EXHAUSTED"


class StudentState(StrEnum):
    PAID_ONCE = "paid_once"
    PAID_TWICE = "paid_twice"  # two or more payments for one entitlement
    UNPAID = "unpaid"
    PENDING = "pending"


class Verdict(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"


class FailureReason(StrEnum):
    DRAIN_TIMEOUT = "DRAIN_TIMEOUT"
    TASK_ERROR = "TASK_ERROR"
    START_FAILED = "START_FAILED"
    INCONSISTENT_DELIVERIES = "INCONSISTENT_DELIVERIES"


@dataclass(frozen=True, slots=True)
class Entitlement:
    """One payment owed to one beneficiary for one installment."""

    beneficiary_id: str
    display_name: str
    amount_paise: int
    installment: int

    @property
    def order_key(self) -> tuple[str, int]:
        """Canonical order: logical event IDs are assigned in this order."""
        return (self.beneficiary_id, self.installment)

    def to_dict(self) -> dict[str, str | int]:
        return {
            "beneficiary_id": self.beneficiary_id,
            "display_name": self.display_name,
            "amount_paise": self.amount_paise,
            "installment": self.installment,
        }


@dataclass(frozen=True, slots=True)
class BatchMeta:
    batch_id: str
    name: str
    scheme_id: str
    academic_year: str
    total_budget_paise: int
    count: int
    content_sha256: str
    source: str  # "demo" | "generated" | "csv"
    created_at: str


@dataclass(frozen=True, slots=True)
class ExperimentDefinition:
    """The canonical experiment. Its SHA-256 is the replay fingerprint.

    Contains no run ID and no processor: the same definition is replayed against
    both processors, and matching fingerprints prove both runs saw the same workload.
    """

    version: int
    batch_id: str
    batch_content_sha256: str
    seed: str
    logical_events: int
    duplicate_count: int
    duplicated_logical_ids: tuple[str, ...]
    phase_a: tuple[str, ...]
    phase_b: tuple[str, ...]
    scenario: str

    def to_dict(self) -> dict[str, object]:
        return {
            "version": self.version,
            "batch_id": self.batch_id,
            "batch_content_sha256": self.batch_content_sha256,
            "seed": self.seed,
            "logical_events": self.logical_events,
            "duplicate_count": self.duplicate_count,
            "duplicated_logical_ids": list(self.duplicated_logical_ids),
            "phase_a": list(self.phase_a),
            "phase_b": list(self.phase_b),
            "scenario": self.scenario,
        }

    @classmethod
    def from_dict(cls, data: Mapping[str, object]) -> ExperimentDefinition:
        def id_list(name: str) -> tuple[str, ...]:
            raw = data.get(name)
            if not isinstance(raw, list) or not all(isinstance(item, str) for item in raw):
                raise ValidationError(f"definition.{name} must be a list of strings")
            return tuple(str(item) for item in raw)

        return cls(
            version=require_int(data, "version", minimum=1),
            batch_id=require_str(data, "batch_id"),
            batch_content_sha256=require_str(data, "batch_content_sha256"),
            seed=require_str(data, "seed"),
            logical_events=require_int(data, "logical_events", minimum=1),
            duplicate_count=require_int(data, "duplicate_count", minimum=1),
            duplicated_logical_ids=id_list("duplicated_logical_ids"),
            phase_a=id_list("phase_a"),
            phase_b=id_list("phase_b"),
            scenario=require_str(data, "scenario"),
        )


@dataclass(frozen=True, slots=True)
class DisbursementEvent:
    """One delivery of a logical event: the SQS message body.

    `copy_index` is 1 or 2. In Phase A both copies of a duplicated logical event
    are sent; the second carries `duplicate_of` for display only. SQS Standard
    does not preserve order, so copy 2 can arrive first and be the one that pays.
    """

    run_id: str
    delivery_id: str
    logical_event_id: str
    entitlement_key: str
    scheme_id: str
    beneficiary_id: str
    academic_year: str
    installment: int
    amount_paise: int
    phase: InjectionPhase
    copy_index: int
    duplicate_of: str | None

    def to_message(self) -> dict[str, object]:
        return {
            "run_id": self.run_id,
            "delivery_id": self.delivery_id,
            "logical_event_id": self.logical_event_id,
            "entitlement_key": self.entitlement_key,
            "scheme_id": self.scheme_id,
            "beneficiary_id": self.beneficiary_id,
            "academic_year": self.academic_year,
            "installment": self.installment,
            "amount_paise": self.amount_paise,
            "phase": self.phase.value,
            "copy_index": self.copy_index,
            "duplicate_of": self.duplicate_of,
        }

    @classmethod
    def from_message(cls, body: Mapping[str, object]) -> DisbursementEvent:
        """Parse and validate a message body. Raises ValidationError on a malformed message."""
        return cls(
            run_id=require_str(body, "run_id"),
            delivery_id=require_str(body, "delivery_id"),
            logical_event_id=require_str(body, "logical_event_id"),
            entitlement_key=require_str(body, "entitlement_key"),
            scheme_id=require_str(body, "scheme_id"),
            beneficiary_id=require_str(body, "beneficiary_id"),
            academic_year=require_str(body, "academic_year"),
            installment=require_int(body, "installment", minimum=1),
            amount_paise=require_int(body, "amount_paise", minimum=1),
            phase=require_enum(body, "phase", InjectionPhase),
            copy_index=require_int(body, "copy_index", minimum=1, maximum=2),
            duplicate_of=optional_str(body, "duplicate_of"),
        )


@dataclass(frozen=True, slots=True)
class Delivery:
    """The recorded outcome of one delivery (a Deliveries row)."""

    run_id: str
    delivery_id: str
    logical_event_id: str
    entitlement_key: str
    beneficiary_id: str
    installment: int
    phase: InjectionPhase
    copy_index: int
    duplicate_of: str | None
    outcome: DeliveryOutcome
    processed_at: str
    lambda_request_id: str
    attempt: int
    effect_id: str | None = None
    # Set on BUDGET_EXHAUSTED rows: the budget the processor saw when it refused.
    budget_remaining_paise_at_rejection: int | None = None

    @classmethod
    def for_event(
        cls,
        event: DisbursementEvent,
        *,
        outcome: DeliveryOutcome,
        processed_at: str,
        lambda_request_id: str,
        attempt: int,
        effect_id: str | None = None,
        budget_remaining_paise_at_rejection: int | None = None,
    ) -> Delivery:
        return cls(
            run_id=event.run_id,
            delivery_id=event.delivery_id,
            logical_event_id=event.logical_event_id,
            entitlement_key=event.entitlement_key,
            beneficiary_id=event.beneficiary_id,
            installment=event.installment,
            phase=event.phase,
            copy_index=event.copy_index,
            duplicate_of=event.duplicate_of,
            outcome=outcome,
            processed_at=processed_at,
            lambda_request_id=lambda_request_id,
            attempt=attempt,
            effect_id=effect_id,
            budget_remaining_paise_at_rejection=budget_remaining_paise_at_rejection,
        )


@dataclass(frozen=True, slots=True)
class LedgerEffect:
    """One payment written to the ledger. Evaluation counts these, never deliveries."""

    run_id: str
    effect_id: str
    entitlement_key: str
    beneficiary_id: str
    installment: int
    amount_paise: int
    logical_event_id: str
    delivery_id: str
    committed_at: str

    @classmethod
    def for_event(cls, event: DisbursementEvent, *, effect_id: str, committed_at: str) -> LedgerEffect:
        return cls(
            run_id=event.run_id,
            effect_id=effect_id,
            entitlement_key=event.entitlement_key,
            beneficiary_id=event.beneficiary_id,
            installment=event.installment,
            amount_paise=event.amount_paise,
            logical_event_id=event.logical_event_id,
            delivery_id=event.delivery_id,
            committed_at=committed_at,
        )


@dataclass(frozen=True, slots=True)
class InvariantResult:
    invariant_id: str
    title: str
    passed: bool
    detail: str

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.invariant_id,
            "title": self.title,
            "result": Verdict.PASS.value if self.passed else Verdict.FAIL.value,
            "detail": self.detail,
        }


@dataclass(frozen=True, slots=True)
class RunSummary:
    """Every count in the headline comparison table, computed from stored rows."""

    eligible_entitlements: int
    deliveries: int
    ledger_effects: int
    paid_once: int
    double_paid: int
    unpaid: int
    duplicates_suppressed: int
    budget_exhausted: int
    budget_paise: int
    spent_paise: int
    misallocated_paise: int
    double_paid_entitlement_keys: tuple[str, ...]
    unpaid_entitlement_keys: tuple[str, ...]
    double_paid_beneficiary_ids: tuple[str, ...]
    unpaid_beneficiary_ids: tuple[str, ...]

    def to_dict(self) -> dict[str, object]:
        return {
            "eligible_entitlements": self.eligible_entitlements,
            "deliveries": self.deliveries,
            "ledger_effects": self.ledger_effects,
            "paid_once": self.paid_once,
            "double_paid": self.double_paid,
            "unpaid": self.unpaid,
            "duplicates_suppressed": self.duplicates_suppressed,
            "budget_exhausted": self.budget_exhausted,
            "budget_paise": self.budget_paise,
            "spent_paise": self.spent_paise,
            "misallocated_paise": self.misallocated_paise,
            "double_paid_entitlement_keys": list(self.double_paid_entitlement_keys),
            "unpaid_entitlement_keys": list(self.unpaid_entitlement_keys),
            "double_paid_beneficiary_ids": list(self.double_paid_beneficiary_ids),
            "unpaid_beneficiary_ids": list(self.unpaid_beneficiary_ids),
        }


@dataclass(frozen=True, slots=True)
class InvariantReport:
    summary: RunSummary
    invariants: tuple[InvariantResult, ...]
    verdict: Verdict

    def to_dict(self) -> dict[str, object]:
        return {
            "summary": self.summary.to_dict(),
            "invariants": [invariant.to_dict() for invariant in self.invariants],
            "verdict": self.verdict.value,
        }


@dataclass(frozen=True, slots=True)
class StudentView:
    """One tile in the student grid (one entitlement)."""

    entitlement_key: str
    beneficiary_id: str
    display_name: str
    installment: int
    amount_paise: int
    state: StudentState
    payments: int
    deliveries: int

    def to_dict(self) -> dict[str, object]:
        return {
            "entitlement_key": self.entitlement_key,
            "beneficiary_id": self.beneficiary_id,
            "display_name": self.display_name,
            "installment": self.installment,
            "amount_paise": self.amount_paise,
            "state": self.state.value,
            "payments": self.payments,
            "deliveries": self.deliveries,
        }
