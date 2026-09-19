"""Money helpers. Money is always an `int` number of paise, never a float.

Owns: amount limits and the Indian-grouped rupee format used in log and receipt
text (the UI formats with Intl.NumberFormat('en-IN') instead).
Must never: perform I/O or accept a float.
"""

from __future__ import annotations

PAISE_PER_RUPEE = 100
# ₹1 crore per entitlement: generous for a scholarship, and it keeps a 500-row
# budget far inside DynamoDB's 38-digit number range.
MAX_AMOUNT_PAISE = 1_00_00_000 * PAISE_PER_RUPEE


def is_valid_amount_paise(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 0 < value <= MAX_AMOUNT_PAISE


def _group_indian(digits: str) -> str:
    # Indian grouping: the last three digits, then groups of two (10,00,000).
    if len(digits) <= 3:
        return digits
    head, tail = digits[:-3], digits[-3:]
    groups: list[str] = []
    while len(head) > 2:
        groups.insert(0, head[-2:])
        head = head[:-2]
    if head:
        groups.insert(0, head)
    return ",".join([*groups, tail])


def format_inr(paise: int) -> str:
    """`1000000000` paise -> `₹1,00,00,000`; keeps paise only when they are non-zero."""
    sign = "-" if paise < 0 else ""
    rupees, remainder = divmod(abs(paise), PAISE_PER_RUPEE)
    text = f"{sign}₹{_group_indian(str(rupees))}"
    return f"{text}.{remainder:02d}" if remainder else text
