"""Canonical JSON and SHA-256 fingerprints.

Owns: the one serialisation used for anything we hash (experiment definitions,
batch contents, receipts). Canonical JSON is
`json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)`
encoded as UTF-8, so the same logical object always produces the same bytes.

We call the result a *replay fingerprint*: it proves two runs used the same
definition. It is not a signature and is not tamper-proof; anyone who can edit
the data can recompute a hash.

Must never: hash floats (their text form is not stable across languages), or
perform I/O.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable

from domain.models import Entitlement


def _reject_floats(value: object, path: str = "$") -> None:
    # Money is integer paise everywhere. A float in hashed data would mean a bug,
    # and its decimal text is not stable across JSON implementations.
    if isinstance(value, float):
        raise TypeError(f"Canonical JSON does not allow floats (found at {path})")
    if isinstance(value, dict):
        for key, item in value.items():
            _reject_floats(item, f"{path}.{key}")
    elif isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            _reject_floats(item, f"{path}[{index}]")


def canonical_json(obj: object) -> str:
    """Serialise `obj` deterministically: sorted keys, no whitespace, UTF-8 text."""
    _reject_floats(obj)
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def fingerprint(obj: object) -> str:
    """SHA-256 of the canonical JSON of `obj`."""
    return sha256_hex(canonical_json(obj))


def batch_content_sha256(entitlements: Iterable[Entitlement]) -> str:
    """Hash of the sorted entitlement list, so an experiment can detect a changed batch."""
    ordered = sorted(entitlements, key=lambda entitlement: entitlement.order_key)
    return fingerprint([entitlement.to_dict() for entitlement in ordered])
