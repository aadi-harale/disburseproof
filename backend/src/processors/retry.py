"""Bounded, jittered exponential backoff for transient write conflicts.

Why this exists: every delivery updates the same Runs item (remaining budget and
delivery counters), so that item is a deliberate hot key. With up to five
workers running at once, DynamoDB will sometimes cancel a transaction with
`TransactionConflict`, or reject a plain write that collides with another
worker's transaction (`TransactionConflictException`). Nothing was written in
either case, so trying again is safe.

Delays use "full jitter": a random wait between 0 and min(cap, base * 2^n), so
workers that collided once do not retry in lockstep and collide again. After
MAX_ATTEMPTS the processor gives up and the worker reports the message as a
batch item failure; SQS redelivers it after the visibility timeout.

Must never: retry anything except WriteConflict. A failed condition (duplicate,
no budget, already recorded) is an answer, not a transient error.
"""

from __future__ import annotations

import random
import time
from collections.abc import Callable

from processors.base import RetriesExhausted, WriteConflict

MAX_ATTEMPTS = 6
BASE_DELAY_SECONDS = 0.05
MAX_DELAY_SECONDS = 1.0


class ConflictRetrier:
    """Runs operations for one delivery, counting every attempt across them."""

    def __init__(
        self,
        *,
        max_attempts: int = MAX_ATTEMPTS,
        base_delay_seconds: float = BASE_DELAY_SECONDS,
        max_delay_seconds: float = MAX_DELAY_SECONDS,
        sleep: Callable[[float], None] = time.sleep,
        jitter: Callable[[], float] = random.random,
        on_retry: Callable[[int, float], None] | None = None,
    ) -> None:
        self._max_attempts = max_attempts
        self._base_delay = base_delay_seconds
        self._max_delay = max_delay_seconds
        self._sleep = sleep
        self._jitter = jitter
        self._on_retry = on_retry
        self._attempts = 0

    @property
    def attempts(self) -> int:
        """Total operation attempts made so far (for logs and the Deliveries row)."""
        return self._attempts

    def backoff_seconds(self, failures: int) -> float:
        """Full-jitter delay after the `failures`-th consecutive conflict (1-based)."""
        ceiling: float = min(self._max_delay, self._base_delay * 2 ** (failures - 1))
        return self._jitter() * ceiling

    def run[T](self, operation: Callable[[int], T]) -> T:
        """Call `operation(attempt_number)` until it succeeds or conflicts MAX_ATTEMPTS times."""
        for failures in range(1, self._max_attempts + 1):
            self._attempts += 1
            try:
                return operation(self._attempts)
            except WriteConflict as conflict:
                if failures == self._max_attempts:
                    raise RetriesExhausted(
                        f"write still conflicting after {self._max_attempts} attempts"
                    ) from conflict
                delay = self.backoff_seconds(failures)
                if self._on_retry is not None:
                    self._on_retry(failures, delay)
                self._sleep(delay)
        raise AssertionError("unreachable")  # the loop always returns or raises
