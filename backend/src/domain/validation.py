"""Field validators shared by message parsing, CSV import and API bodies.

Owns: the small set of rules for reading a typed value out of untrusted input
and raising a ValidationError that names the field.
Must never: perform I/O.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from enum import Enum

from common.errors import FieldError, ValidationError


def _fail(field: str, message: str) -> ValidationError:
    return ValidationError(f"{field} {message}", details=[FieldError(field, message)])


def require_str(
    data: Mapping[str, object],
    field: str,
    *,
    max_length: int = 200,
    pattern: re.Pattern[str] | None = None,
) -> str:
    value = data.get(field)
    if not isinstance(value, str) or not value.strip():
        raise _fail(field, "is required")
    value = value.strip()
    if len(value) > max_length:
        raise _fail(field, f"must be at most {max_length} characters")
    if pattern is not None and not pattern.fullmatch(value):
        raise _fail(field, "has an invalid format")
    return value


def optional_str(data: Mapping[str, object], field: str, *, max_length: int = 200) -> str | None:
    if data.get(field) is None:
        return None
    return require_str(data, field, max_length=max_length)


def require_int(
    data: Mapping[str, object],
    field: str,
    *,
    minimum: int | None = None,
    maximum: int | None = None,
) -> int:
    value = data.get(field)
    # bool is a subclass of int in Python; true/false must not pass as 1/0.
    if isinstance(value, bool) or not isinstance(value, int):
        raise _fail(field, "must be an integer")
    if minimum is not None and value < minimum:
        raise _fail(field, f"must be at least {minimum}")
    if maximum is not None and value > maximum:
        raise _fail(field, f"must be at most {maximum}")
    return value


def require_enum[E: Enum](data: Mapping[str, object], field: str, enum_type: type[E]) -> E:
    value = data.get(field)
    try:
        return enum_type(value)
    except ValueError:
        allowed = ", ".join(str(member.value) for member in enum_type)
        raise _fail(field, f"must be one of: {allowed}") from None
