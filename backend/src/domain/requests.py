"""Request schemas for every public write endpoint and path parameter.

Owns: exactly which fields each POST body may contain, their types, formats and
bounds, and the formats of IDs in URLs. The API is public and unauthenticated, so
every rule is explicit and strict: an unknown field is a 400, not something to ignore.
Must never: perform I/O.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

from common.errors import FieldError, ValidationError
from domain.models import ProcessorName
from domain.validation import (
    optional_bool,
    optional_str,
    reject_unknown_fields,
    require_enum,
    require_int,
    require_str,
)

# IDs a caller supplies (beneficiaries, schemes): capital letters, digits and '-'.
# No '#' (the entitlement-key separator), no spaces, no lowercase look-alikes.
BUSINESS_ID_PATTERN = re.compile(r"[A-Z0-9-]{1,32}")
ACADEMIC_YEAR_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}")
# Batch names are shown in the UI; letters, digits and common punctuation only.
BATCH_NAME_PATTERN = re.compile(r"[\w .,'()&:/—-]{1,100}")

# IDs the server generates. Validating them up front turns junk into a 400
# before it reaches DynamoDB, a filter pattern or a log line.
RUN_ID_PATTERN = re.compile(r"run_[0-9A-Z]{26}")
BATCH_ID_PATTERN = re.compile(r"bat_[A-Za-z0-9_]{1,40}")
EXPERIMENT_ID_PATTERN = re.compile(r"exp_[0-9a-f]{16}")

MIN_RACE_COPIES = 2
MAX_RACE_COPIES = 20
RUN_PROCESSORS = (ProcessorName.VULNERABLE, ProcessorName.PROTECTED)
RACE_PROCESSORS = (ProcessorName.NAIVE, ProcessorName.PROTECTED)


def require_path_id(value: str | None, pattern: re.Pattern[str], name: str) -> str:
    if not value or not pattern.fullmatch(value):
        raise ValidationError(
            f"{name} has an invalid format", details=[FieldError(name, "has an invalid format")]
        )
    return value


def _require_object(value: object, name: str) -> Mapping[str, object]:
    if not isinstance(value, dict):
        raise ValidationError(f"{name} must be a JSON object")
    return value


@dataclass(frozen=True, slots=True)
class CreateBatchRequest:
    csv: str | None
    count: int | None
    amount_paise: int | None
    name: str | None
    scheme_id: str | None
    academic_year: str | None
    dry_run: bool


def parse_create_batch(
    body: Mapping[str, object], *, max_csv_characters: int
) -> CreateBatchRequest:
    """POST /batches: exactly one of `generate` or `csv`, plus optional metadata."""
    reject_unknown_fields(
        body, {"generate", "csv", "name", "scheme_id", "academic_year", "dry_run"}
    )
    has_generate, has_csv = "generate" in body, "csv" in body
    if has_generate == has_csv:
        raise ValidationError("Send exactly one of `generate` or `csv`")

    name = optional_str(body, "name", max_length=100)
    if name is not None and not BATCH_NAME_PATTERN.fullmatch(name):
        raise ValidationError("name may contain letters, digits, spaces and . , ' ( ) & : / - only")
    scheme_id = optional_str(body, "scheme_id", max_length=32)
    if scheme_id is not None and not BUSINESS_ID_PATTERN.fullmatch(scheme_id):
        raise ValidationError(
            "scheme_id must match ^[A-Z0-9-]{1,32}$", details=[FieldError("scheme_id", "invalid")]
        )
    academic_year = optional_str(body, "academic_year", max_length=7)
    if academic_year is not None and not ACADEMIC_YEAR_PATTERN.fullmatch(academic_year):
        raise ValidationError("academic_year must look like 2026-27")
    dry_run = optional_bool(body, "dry_run")

    if has_generate:
        if dry_run:
            raise ValidationError("dry_run applies to CSV uploads only")
        spec = _require_object(body["generate"], "generate")
        reject_unknown_fields(spec, {"count", "amount_paise"}, where="generate")
        return CreateBatchRequest(
            csv=None,
            count=require_int(spec, "count", minimum=1),
            amount_paise=require_int(spec, "amount_paise", minimum=1),
            name=name,
            scheme_id=scheme_id,
            academic_year=academic_year,
            dry_run=False,
        )

    text = body["csv"]
    if not isinstance(text, str) or not text.strip() or len(text) > max_csv_characters:
        raise ValidationError(
            f"csv must be non-empty CSV text of at most {max_csv_characters} characters"
        )
    return CreateBatchRequest(
        csv=text,
        count=None,
        amount_paise=None,
        name=name,
        scheme_id=scheme_id,
        academic_year=academic_year,
        dry_run=dry_run,
    )


def parse_create_experiment(body: Mapping[str, object]) -> tuple[str, str, int]:
    """POST /experiments -> (batch_id, seed, duplicate_count). D's upper bound needs N and is
    checked against the batch in domain/experiment.py."""
    reject_unknown_fields(body, {"batch_id", "seed", "duplicate_count"})
    batch_id = require_str(body, "batch_id", max_length=48, pattern=BATCH_ID_PATTERN)
    seed = require_str(body, "seed", max_length=64)
    duplicate_count = require_int(body, "duplicate_count", minimum=1, maximum=250)
    return batch_id, seed, duplicate_count


def parse_start_run(body: Mapping[str, object]) -> tuple[str, ProcessorName]:
    """POST /runs -> (experiment_id, processor). Only vulnerable and protected run experiments."""
    reject_unknown_fields(body, {"experiment_id", "processor"})
    experiment_id = require_str(body, "experiment_id", max_length=32, pattern=EXPERIMENT_ID_PATTERN)
    processor = require_enum(body, "processor", ProcessorName)
    if processor not in RUN_PROCESSORS:
        raise ValidationError("processor must be 'vulnerable' or 'protected'")
    return experiment_id, processor


def parse_start_race(body: Mapping[str, object]) -> tuple[ProcessorName, int]:
    """POST /race -> (processor, copies). Only naive and protected race."""
    reject_unknown_fields(body, {"processor", "copies"})
    processor = require_enum(body, "processor", ProcessorName)
    if processor not in RACE_PROCESSORS:
        raise ValidationError("processor must be 'naive' or 'protected'")
    copies = require_int(body, "copies", minimum=MIN_RACE_COPIES, maximum=MAX_RACE_COPIES)
    return processor, copies
