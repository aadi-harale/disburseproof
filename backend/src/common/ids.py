"""Identifiers for things we create (batches, runs, ledger effects).

Owns: random, time-sortable IDs. Run and batch IDs are ULIDs (48-bit millisecond
timestamp + 80 random bits, Crockford base32), so lists sort by creation time and
IDs stay short enough to read in a UI.
Must never: generate delivery IDs. Those are derived deterministically in
domain/injection.py so that a retried injection re-sends the *same* deliveries.
"""

from __future__ import annotations

import os
import time
import uuid

_CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def new_ulid(now_ms: int | None = None, entropy: bytes | None = None) -> str:
    """Return a 26-character ULID."""
    millis = int(time.time() * 1000) if now_ms is None else now_ms
    random_bytes = os.urandom(10) if entropy is None else entropy
    value = (millis << 80) | int.from_bytes(random_bytes, "big")
    chars = []
    for _ in range(26):
        chars.append(_CROCKFORD[value & 0x1F])
        value >>= 5
    return "".join(reversed(chars))


def new_run_id() -> str:
    return f"run_{new_ulid()}"


def new_batch_id() -> str:
    return f"bat_{new_ulid()}"


def new_effect_id() -> str:
    """A ledger effect (payment) ID. Random on purpose: one per commit attempt."""
    return str(uuid.uuid4())
