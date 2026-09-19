"""Hourly rate-limit windows for the public API's write endpoints.

Owns: the counter key and expiry for a fixed one-hour window. The counter itself
is a DynamoDB item incremented with a condition (adapters/dynamodb/rate_limits_repo.py),
so the check and the increment are one atomic request: two concurrent callers can
never both take the last slot.

This is a coarse global cost guard, not per-user fairness: one visitor can use the
whole hour's allowance. That trade-off is documented as an accepted risk.
Must never: perform I/O.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

WINDOW = timedelta(hours=1)
# Counter items outlive their window by an hour, then DynamoDB TTL deletes them.
RETENTION = timedelta(hours=2)


@dataclass(frozen=True, slots=True)
class RateWindow:
    key: str
    expires_at_epoch: int
    resets_at: datetime


def hourly_window(bucket: str, now: datetime) -> RateWindow:
    """`RATE#<bucket>#<yyyymmddhh>` for the UTC hour containing `now`."""
    hour = now.astimezone(UTC).replace(minute=0, second=0, microsecond=0)
    return RateWindow(
        key=f"RATE#{bucket}#{hour:%Y%m%d%H}",
        expires_at_epoch=int((hour + RETENTION).timestamp()),
        resets_at=hour + WINDOW,
    )


def is_allowed(current_count: int, limit: int) -> bool:
    """The condition the store enforces atomically: the next request is allowed while count < limit."""
    return current_count < limit
