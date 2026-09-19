"""The golden demo configuration and synthetic beneficiary names.

Owns: the demo batch and experiment constants, and a fixed, hard-coded name list.
Names are synthetic: a first name and a surname from the lists below, paired by
index. They are not drawn from any real record and do not refer to real people.
Must never: perform I/O.
"""

from __future__ import annotations

from domain.models import Entitlement

DEMO_BATCH_ID = "bat_demo_postmatric_2026_27"
DEMO_BATCH_NAME = "Post-Matric Scholarship 2026-27 — Demo Batch"
DEMO_SCHEME_ID = "DEMO-POSTMATRIC"
DEMO_ACADEMIC_YEAR = "2026-27"
DEMO_STUDENT_COUNT = 100
DEMO_AMOUNT_PAISE = 1_000_000  # ₹10,000
DEMO_SEED = "FC-2026-0918"
DEMO_DUPLICATE_COUNT = 12
DEMO_CREATED_AT = "2026-09-18T00:00:00.000Z"

MAX_GENERATED_ENTITLEMENTS = 500

FIRST_NAMES: tuple[str, ...] = (
    "Aarav", "Ananya", "Arjun", "Bhavna", "Chetan", "Diya", "Eshan", "Farida", "Gaurav",
    "Hema", "Imran", "Jaya", "Karthik", "Lavanya", "Mohit", "Nandini", "Omkar", "Pallavi",
    "Rehan", "Sneha", "Tarun", "Uma", "Varun", "Yamini", "Zubin",
)  # fmt: skip

SURNAMES: tuple[str, ...] = (
    "Iyer", "Kulkarni", "Banerjee", "Reddy", "Chauhan", "Das", "Fernandes", "Gill", "Hegde",
    "Joshi", "Ansari", "Menon", "Nair", "Pillai", "Kamath", "Rao", "Sethi", "Thakur", "Verma",
    "Wadhwa", "Yadav",
)  # fmt: skip

# 25 and 21 are coprime, so (i mod 25, i mod 21) is unique for 525 consecutive
# indices (Chinese remainder theorem): no two students in a 500-row batch share a
# name. tests/unit/test_demo_data.py checks this.


def synthetic_name(index: int) -> str:
    """Deterministic synthetic name for the 0-based `index`."""
    return f"{FIRST_NAMES[index % len(FIRST_NAMES)]} {SURNAMES[index % len(SURNAMES)]}"


def beneficiary_id(number: int) -> str:
    return f"STU-{number:03d}"


def generate_entitlements(count: int, amount_paise: int) -> list[Entitlement]:
    """`count` students STU-001 ... each owed one installment of `amount_paise`."""
    return [
        Entitlement(
            beneficiary_id=beneficiary_id(number),
            display_name=synthetic_name(number - 1),
            amount_paise=amount_paise,
            installment=1,
        )
        for number in range(1, count + 1)
    ]


def demo_entitlements() -> list[Entitlement]:
    return generate_entitlements(DEMO_STUDENT_COUNT, DEMO_AMOUNT_PAISE)
