"""CSV import with row-level errors, and generated batches."""

from __future__ import annotations

import pytest

from common.errors import ValidationError
from domain.batch_import import generated_entitlements, parse_entitlements_csv

HEADER = "beneficiary_id,display_name,amount_paise,installment"


def test_valid_csv_is_parsed() -> None:
    report = parse_entitlements_csv(
        f"{HEADER}\nSTU-001,Aarav Iyer,1000000,1\nSTU-001,Aarav Iyer,1000000,2\n"
    )
    assert report.is_valid
    assert [(e.beneficiary_id, e.installment) for e in report.entitlements] == [
        ("STU-001", 1),
        ("STU-001", 2),
    ]


def test_column_order_is_flexible_and_bom_is_tolerated() -> None:
    report = parse_entitlements_csv(
        "﻿installment,amount_paise,display_name,beneficiary_id\n1,500,Diya Das,STU-9\n"
    )
    assert report.is_valid
    assert report.entitlements[0].amount_paise == 500


def test_every_bad_row_is_reported_with_its_line_number() -> None:
    text = "\n".join(
        [
            HEADER,
            "STU-001,Aarav Iyer,1000000,1",
            "STU#002,Bad Id,1000000,1",  # line 3: '#' is the key separator
            "STU-003,,1000000,1",  # line 4: missing name
            "STU-004,Neg Amount,-5,1",  # line 5: not a positive integer
            "STU-005,Float Amount,100.50,1",  # line 6: paise must be whole
            "STU-006,Zero Inst,100,0",  # line 7: installment >= 1
            "STU-001,Aarav Iyer,1000000,1",  # line 8: duplicate of line 2
            "STU-007,Too,Many,Cells,1",  # line 9: wrong cell count
        ]
    )
    report = parse_entitlements_csv(text)
    assert not report.is_valid
    lines = sorted({error.line for error in report.errors if error.line is not None})
    assert lines == [3, 4, 5, 6, 7, 8, 9]
    duplicate = next(e for e in report.errors if e.line == 8)
    assert "duplicate of line 2" in duplicate.message
    assert len(report.entitlements) == 1
    assert [row.line for row in report.rows] == [2, 3, 4, 5, 6, 7, 8, 9]


def test_missing_and_unexpected_columns_are_reported() -> None:
    report = parse_entitlements_csv("beneficiary_id,name,amount_paise\nSTU-1,A,1\n")
    assert not report.is_valid
    (error,) = report.errors
    assert "missing columns: display_name, installment" in error.message
    assert "unexpected columns: name" in error.message


def test_more_than_500_rows_is_rejected() -> None:
    rows = "\n".join(f"STU-{n},Name {n},100,1" for n in range(1, 502))
    report = parse_entitlements_csv(f"{HEADER}\n{rows}\n")
    assert any("more than 500" in error.message for error in report.errors)


def test_empty_input_and_header_only_are_rejected() -> None:
    assert not parse_entitlements_csv("").is_valid
    assert not parse_entitlements_csv(f"{HEADER}\n\n").is_valid


def test_generated_batch_uses_synthetic_names_and_bounds() -> None:
    entitlements = generated_entitlements(3, 250_000)
    assert [e.beneficiary_id for e in entitlements] == ["STU-001", "STU-002", "STU-003"]
    assert entitlements[0].display_name == "Aarav Iyer"
    with pytest.raises(ValidationError):
        generated_entitlements(501, 100)
    with pytest.raises(ValidationError):
        generated_entitlements(10, 0)
