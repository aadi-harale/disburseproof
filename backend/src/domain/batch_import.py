"""Batch import: CSV parsing and validation with row-level errors.

Owns: the rules for accepting a batch of entitlements from an operator, and a
preview of every row so the UI can show exactly which line is wrong and why.
Must never: perform I/O or store anything.

Uniqueness is per (beneficiary_id, installment): one student may appear once per
installment, because each installment is a separate entitlement.
"""

from __future__ import annotations

import csv
import io
import re
from dataclasses import dataclass, field

from common.errors import FieldError, ValidationError
from domain.demo_data import MAX_GENERATED_ENTITLEMENTS, generate_entitlements
from domain.models import Entitlement
from domain.money import MAX_AMOUNT_PAISE, is_valid_amount_paise

CSV_COLUMNS = ("beneficiary_id", "display_name", "amount_paise", "installment")
MAX_ROWS = 500
MAX_DISPLAY_NAME_LENGTH = 80
MAX_INSTALLMENT = 99
# No '#': it separates the parts of an entitlement key.
BENEFICIARY_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,31}")
DIGITS = re.compile(r"[0-9]{1,15}")
CONTROL_CHARACTERS = re.compile(r"[\x00-\x1f\x7f]")


@dataclass(slots=True)
class RowPreview:
    line: int
    values: dict[str, str]
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, object]:
        return {"line": self.line, "values": self.values, "errors": self.errors}


@dataclass(frozen=True, slots=True)
class ImportReport:
    entitlements: tuple[Entitlement, ...]
    errors: tuple[FieldError, ...]
    rows: tuple[RowPreview, ...]

    @property
    def is_valid(self) -> bool:
        return not self.errors and bool(self.entitlements)


def _parse_row(line: int, values: dict[str, str]) -> tuple[Entitlement | None, list[FieldError]]:
    errors: list[FieldError] = []

    beneficiary = values["beneficiary_id"]
    if not BENEFICIARY_ID_PATTERN.fullmatch(beneficiary):
        errors.append(FieldError("beneficiary_id", "1-32 letters, digits, '-' or '_'", line))

    name = values["display_name"]
    if not name:
        errors.append(FieldError("display_name", "is required", line))
    elif len(name) > MAX_DISPLAY_NAME_LENGTH:
        errors.append(
            FieldError("display_name", f"at most {MAX_DISPLAY_NAME_LENGTH} characters", line)
        )
    elif CONTROL_CHARACTERS.search(name):
        errors.append(FieldError("display_name", "contains control characters", line))

    amount_text = values["amount_paise"]
    amount = int(amount_text) if DIGITS.fullmatch(amount_text) else None
    if amount is None or not is_valid_amount_paise(amount):
        errors.append(
            FieldError(
                "amount_paise", f"a whole number of paise from 1 to {MAX_AMOUNT_PAISE}", line
            )
        )

    installment_text = values["installment"]
    installment = int(installment_text) if DIGITS.fullmatch(installment_text) else None
    if installment is None or not 1 <= installment <= MAX_INSTALLMENT:
        errors.append(
            FieldError("installment", f"a whole number from 1 to {MAX_INSTALLMENT}", line)
        )

    if errors or amount is None or installment is None:
        return None, errors
    return Entitlement(beneficiary, name, amount, installment), []


def parse_entitlements_csv(text: str) -> ImportReport:
    """Parse `beneficiary_id,display_name,amount_paise,installment` CSV text.

    Returns every row's preview plus all errors; never raises for bad rows, so the
    operator sees every problem at once instead of one per upload.
    """
    reader = csv.reader(io.StringIO(text.lstrip("\ufeff")))  # tolerate an Excel BOM
    errors: list[FieldError] = []
    rows: list[RowPreview] = []

    header: list[str] | None = None
    for raw in reader:
        if any(cell.strip() for cell in raw):
            header = [cell.strip().lower() for cell in raw]
            break
    if header is None:
        return ImportReport((), (FieldError("csv", "is empty"),), ())

    missing = [column for column in CSV_COLUMNS if column not in header]
    unexpected = [column for column in header if column not in CSV_COLUMNS]
    if missing or unexpected or len(set(header)) != len(header):
        problems = []
        if missing:
            problems.append(f"missing columns: {', '.join(missing)}")
        if unexpected:
            problems.append(f"unexpected columns: {', '.join(unexpected)}")
        if len(set(header)) != len(header):
            problems.append("duplicate column names")
        message = "; ".join(problems) + f" (expected: {','.join(CSV_COLUMNS)})"
        return ImportReport((), (FieldError("header", message, reader.line_num),), ())

    entitlements: list[Entitlement] = []
    first_line_of: dict[tuple[str, int], int] = {}
    data_rows = 0
    for raw in reader:
        line = reader.line_num
        if not any(cell.strip() for cell in raw):
            continue  # blank lines, typically a trailing newline
        data_rows += 1
        if data_rows > MAX_ROWS:
            errors.append(FieldError("csv", f"has more than {MAX_ROWS} data rows", line))
            break
        if len(raw) != len(header):
            preview = RowPreview(line, {"raw": ",".join(raw)})
            preview.errors.append(f"expected {len(header)} cells, found {len(raw)}")
            errors.append(FieldError("row", preview.errors[-1], line))
            rows.append(preview)
            continue

        values = {column: cell.strip() for column, cell in zip(header, raw, strict=True)}
        preview = RowPreview(line, values)
        rows.append(preview)
        entitlement, row_errors = _parse_row(line, values)
        preview.errors.extend(f"{error.field}: {error.message}" for error in row_errors)
        errors.extend(row_errors)
        if entitlement is None:
            continue
        identity = entitlement.order_key
        if identity in first_line_of:
            message = (
                f"duplicate of line {first_line_of[identity]} (same beneficiary_id and installment)"
            )
            preview.errors.append(message)
            errors.append(FieldError("beneficiary_id", message, line))
            continue
        first_line_of[identity] = line
        entitlements.append(entitlement)

    if data_rows == 0:
        errors.append(FieldError("csv", "has a header but no data rows"))
    return ImportReport(tuple(entitlements), tuple(errors), tuple(rows))


def generated_entitlements(count: int, amount_paise: int) -> list[Entitlement]:
    """Validate a generate request and build STU-001 ... with synthetic names."""
    details: list[FieldError] = []
    if not 1 <= count <= MAX_GENERATED_ENTITLEMENTS:
        details.append(
            FieldError("generate.count", f"must be between 1 and {MAX_GENERATED_ENTITLEMENTS}")
        )
    if not is_valid_amount_paise(amount_paise):
        details.append(
            FieldError("generate.amount_paise", f"must be between 1 and {MAX_AMOUNT_PAISE}")
        )
    if details:
        raise ValidationError("Invalid generate request", details=details)
    return generate_entitlements(count, amount_paise)
