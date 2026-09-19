"""Builds DynamoDB update expressions with placeholders for every attribute name.

Why placeholders everywhere: several of our attribute names (`status`, `name`,
`count`, `source`) are DynamoDB reserved words. Always using `#name` placeholders
removes a whole class of "reserved keyword" errors.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from boto3.dynamodb.types import TypeSerializer

_SERIALIZER = TypeSerializer()


@dataclass(slots=True)
class Expression:
    """Accumulates attribute-name and value placeholders for one request."""

    names: dict[str, str] = field(default_factory=dict)
    values: dict[str, Any] = field(default_factory=dict)

    def name(self, attribute: str) -> str:
        placeholder = f"#{attribute}"
        self.names[placeholder] = attribute
        return placeholder

    def value(self, label: str, value: object) -> str:
        placeholder = f":{label}"
        self.values[placeholder] = _SERIALIZER.serialize(value)
        return placeholder

    def set_clause(self, updates: Mapping[str, object]) -> str:
        parts = [
            f"{self.name(attribute)} = {self.value('set_' + attribute, value)}"
            for attribute, value in updates.items()
        ]
        return "SET " + ", ".join(parts)

    def request_args(self) -> dict[str, Any]:
        args: dict[str, Any] = {}
        if self.names:
            args["ExpressionAttributeNames"] = self.names
        if self.values:
            args["ExpressionAttributeValues"] = self.values
        return args
