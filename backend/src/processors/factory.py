"""Builds the processor a run asked for.

Owns: the mapping from `ProcessorName` to a processor wired to its storage port.
Must never: choose a processor from the message. The processor is read from the
Run record, so one run can never mix strategies.
"""

from __future__ import annotations

from collections.abc import Callable

from domain.models import ProcessorName
from processors.base import DisbursementProcessor, LedgerStore
from processors.naive import DEFAULT_RACE_WINDOW_SECONDS, NaiveProcessor
from processors.protected import ProtectedProcessor
from processors.retry import ConflictRetrier
from processors.vulnerable import VulnerableProcessor


def build_processor(
    name: ProcessorName,
    store: LedgerStore,
    *,
    retrier_factory: Callable[[], ConflictRetrier] = ConflictRetrier,
    race_window_seconds: float = DEFAULT_RACE_WINDOW_SECONDS,
) -> DisbursementProcessor:
    if name is ProcessorName.PROTECTED:
        return ProtectedProcessor(store, retrier_factory=retrier_factory)
    if name is ProcessorName.VULNERABLE:
        return VulnerableProcessor(store, retrier_factory=retrier_factory)
    return NaiveProcessor(
        store, retrier_factory=retrier_factory, race_window_seconds=race_window_seconds
    )
