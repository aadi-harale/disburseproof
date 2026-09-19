"""Typed application errors and their single HTTP mapping.

Owns: the exception hierarchy that crosses layer boundaries (domain, services,
handlers) and the one table that maps each exception type to an HTTP status.
Must never: import an AWS SDK or build HTTP responses (common/http.py does that).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class FieldError:
    """One problem with one input field.

    `line` is the 1-based line number in an uploaded CSV (the header is line 1),
    so the UI can point at the exact row the operator needs to fix.
    """

    field: str
    message: str
    line: int | None = None

    def to_dict(self) -> dict[str, object]:
        data: dict[str, object] = {"field": self.field, "message": self.message}
        if self.line is not None:
            data["line"] = self.line
        return data


class DisburseProofError(Exception):
    """Base class for errors we raise on purpose. `code` is stable and machine-readable."""

    code = "INTERNAL"

    def __init__(self, message: str, *, details: list[FieldError] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details: list[FieldError] = details or []


class ValidationError(DisburseProofError):
    """The caller sent something we will not accept (bad field, bad CSV row, D > N/2 ...)."""

    code = "VALIDATION_FAILED"


class NotFoundError(DisburseProofError):
    """The requested batch, experiment, run or student does not exist."""

    code = "NOT_FOUND"


class ConflictError(DisburseProofError):
    """The request is valid but conflicts with current state (e.g. too many active runs)."""

    code = "CONFLICT"


class RateLimitedError(DisburseProofError):
    """A cost guard refused the request (e.g. more than 30 runs started this hour)."""

    code = "RATE_LIMITED"


# The only place an error type becomes an HTTP status. Anything not listed is a 500.
HTTP_STATUS_BY_ERROR: dict[type[DisburseProofError], int] = {
    ValidationError: 400,
    NotFoundError: 404,
    ConflictError: 409,
    RateLimitedError: 429,
}


def http_status_for(error: DisburseProofError) -> int:
    """Return the HTTP status for a typed error (subclasses inherit their parent's status)."""
    for error_type, status in HTTP_STATUS_BY_ERROR.items():
        if isinstance(error, error_type):
            return status
    return 500
