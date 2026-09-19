"""UTC timestamps in one format.

Owns: how "now" is produced and parsed. Every stored timestamp is an ISO-8601
UTC string with millisecond precision and a `Z` suffix, stored in an `*_at` field.
Must never: be called from domain/ (domain functions receive timestamps as arguments).
"""

from __future__ import annotations

from datetime import UTC, datetime


def utc_now_iso() -> str:
    """Current time, e.g. '2026-09-19T08:30:12.345Z'."""
    return to_iso(datetime.now(UTC))


def to_iso(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def millis_between(start_iso: str, end_iso: str) -> int:
    return int((parse_iso(end_iso) - parse_iso(start_iso)).total_seconds() * 1000)
