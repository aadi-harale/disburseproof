"""Entitlement keys and idempotency keys.

Owns: the business identity of a payment. An entitlement key names *what is
owed*: scheme, beneficiary, academic year and installment. It is built only from
those business fields, never from an SQS message ID, a delivery ID, a timestamp
or a retry count. Those change on every retry, so a key built from them would
treat every retry as a new payment.

The idempotency key is `<run_id>#<entitlement key>`. The run ID prefix is a
sandbox decision, not a production one: every run is an isolated universe, so
replaying the same experiment tomorrow is not suppressed by today's run. In a
real disbursement system the key would be the business identity alone. See
docs/adr/0003-run-scoped-idempotency-key.md.

Must never: perform I/O.
"""

from __future__ import annotations

from collections.abc import Iterable

from common.errors import FieldError, ValidationError
from domain.models import Entitlement

KEY_SEPARATOR = "#"


def _component(name: str, value: str) -> str:
    # The separator must not appear inside a component, or two different
    # entitlements could produce the same key ("A#B" + "C" vs "A" + "B#C").
    if not value or KEY_SEPARATOR in value:
        raise ValidationError(
            f"{name} must be non-empty and must not contain '{KEY_SEPARATOR}'",
            details=[FieldError(name, f"must not contain '{KEY_SEPARATOR}'")],
        )
    return value


def build_entitlement_key(
    scheme_id: str, beneficiary_id: str, academic_year: str, installment: int
) -> str:
    """`<scheme_id>#<beneficiary_id>#<academic_year>#INST-<installment>`."""
    if installment < 1:
        raise ValidationError("installment must be at least 1")
    return KEY_SEPARATOR.join(
        (
            _component("scheme_id", scheme_id),
            _component("beneficiary_id", beneficiary_id),
            _component("academic_year", academic_year),
            f"INST-{installment}",
        )
    )


def build_idempotency_key(
    run_id: str, scheme_id: str, beneficiary_id: str, academic_year: str, installment: int
) -> str:
    """`<run_id>#<scheme_id>#<beneficiary_id>#<academic_year>#INST-<installment>`.

    The signature deliberately has no parameter for a delivery or message ID.
    """
    return idempotency_key_for(
        run_id, build_entitlement_key(scheme_id, beneficiary_id, academic_year, installment)
    )


def idempotency_key_for(run_id: str, entitlement_key: str) -> str:
    return f"{_component('run_id', run_id)}{KEY_SEPARATOR}{entitlement_key}"


def key_entitlements(
    scheme_id: str, academic_year: str, entitlements: Iterable[Entitlement]
) -> dict[str, Entitlement]:
    """Map each entitlement key to its entitlement, in canonical order."""
    ordered = sorted(entitlements, key=lambda entitlement: entitlement.order_key)
    return {
        build_entitlement_key(
            scheme_id, entitlement.beneficiary_id, academic_year, entitlement.installment
        ): entitlement
        for entitlement in ordered
    }
