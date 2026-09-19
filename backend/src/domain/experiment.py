"""Experiment definitions: logical events, duplicate selection, phase split.

Owns: the deterministic rules that turn (batch, seed, D) into an experiment
definition and its replay fingerprint.
Must never: perform I/O or depend on a run or a processor.

Why two phases (docs/adr/0001-two-phase-injection.md):
SQS Standard delivers at least once and in no guaranteed order. If all N + D
deliveries were sent at once, the budget would run out at an order-dependent
moment: a duplicate that arrived after exhaustion would be rejected instead of
paid, so even the *number* of double-paid and starved students would change
from run to run. Instead we send the retry wave first. Phase A delivers each of
the D duplicated logical events twice (2D deliveries). Phase B, which starts only
after every Phase A delivery is recorded, delivers the other N - D events once.
A vulnerable processor then always pays 2D times in Phase A, leaving budget for
N - 2D of the N - D Phase B events: exactly D students receive ₹0 when all
amounts are equal. *Which* D students are starved still depends on SQS order.
This models a first wave of payments that was retried before the rest of the
batch went out.
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Sequence

from common.errors import FieldError, ValidationError
from domain.fingerprint import sha256_hex
from domain.models import Entitlement, ExperimentDefinition

SCENARIO = "duplicate_delivery_two_phase"
DEFINITION_VERSION = 1
SEED_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")


def logical_event_ids(count: int) -> list[str]:
    """`EVT-001` ... zero-padded to at least three digits, so string order is numeric order."""
    width = max(3, len(str(count)))
    return [f"EVT-{index:0{width}d}" for index in range(1, count + 1)]


def assign_logical_events(entitlements: Iterable[Entitlement]) -> list[tuple[str, Entitlement]]:
    """Pair each entitlement with its logical event ID, in (beneficiary, installment) order."""
    ordered = sorted(entitlements, key=lambda entitlement: entitlement.order_key)
    return list(zip(logical_event_ids(len(ordered)), ordered, strict=True))


def validate_seed(seed: str) -> str:
    if not SEED_PATTERN.fullmatch(seed):
        raise ValidationError(
            "seed must be 1-64 characters: letters, digits, '.', '_', ':' or '-'",
            details=[FieldError("seed", "has an invalid format")],
        )
    return seed


def validate_duplicate_count(logical_events: int, duplicate_count: int) -> None:
    """Require 1 <= D <= floor(N / 2).

    Above N / 2 the retry wave alone would exceed the budget, and the "exactly D
    starved" property of the two-phase design no longer holds.
    """
    upper = logical_events // 2
    if not 1 <= duplicate_count <= upper:
        raise ValidationError(
            f"duplicate_count must be between 1 and {upper} for {logical_events} entitlements",
            details=[FieldError("duplicate_count", f"must be between 1 and {upper}")],
        )


def select_duplicates(logical_ids: Sequence[str], seed: str, duplicate_count: int) -> list[str]:
    """Pick D logical events to duplicate, reproducibly from the seed.

    Rank every logical ID by sha256(seed + ":" + id), take the first D, then sort
    those by ID. The same seed and batch always give the same selection, and a
    reader can recompute it by hand without our code.
    """
    validate_duplicate_count(len(logical_ids), duplicate_count)
    ranked = sorted(logical_ids, key=lambda logical_id: (sha256_hex(f"{seed}:{logical_id}"), logical_id))
    return sorted(ranked[:duplicate_count])


def split_phases(
    logical_ids: Sequence[str], duplicated: Sequence[str]
) -> tuple[list[str], list[str]]:
    """Phase A = the duplicated events (each sent twice); Phase B = all others (sent once)."""
    duplicated_set = set(duplicated)
    unknown = duplicated_set.difference(logical_ids)
    if unknown:
        raise ValidationError(f"Unknown logical event IDs: {sorted(unknown)}")
    phase_a = sorted(duplicated_set)
    phase_b = [logical_id for logical_id in logical_ids if logical_id not in duplicated_set]
    return phase_a, phase_b


def build_definition(
    *,
    batch_id: str,
    batch_content_sha256: str,
    entitlement_count: int,
    seed: str,
    duplicate_count: int,
) -> ExperimentDefinition:
    ids = logical_event_ids(entitlement_count)
    duplicated = select_duplicates(ids, validate_seed(seed), duplicate_count)
    phase_a, phase_b = split_phases(ids, duplicated)
    return ExperimentDefinition(
        version=DEFINITION_VERSION,
        batch_id=batch_id,
        batch_content_sha256=batch_content_sha256,
        seed=seed,
        logical_events=entitlement_count,
        duplicate_count=duplicate_count,
        duplicated_logical_ids=tuple(duplicated),
        phase_a=tuple(phase_a),
        phase_b=tuple(phase_b),
        scenario=SCENARIO,
    )


def experiment_id_for(fingerprint_hex: str) -> str:
    """Experiments are content-addressed: the same definition always has the same ID,
    so creating it twice is naturally idempotent."""
    return f"exp_{fingerprint_hex[:16]}"


def expected_deliveries(definition: ExperimentDefinition) -> tuple[int, int]:
    """(Phase A target, total target) = (2D, N + D)."""
    return 2 * definition.duplicate_count, definition.logical_events + definition.duplicate_count
