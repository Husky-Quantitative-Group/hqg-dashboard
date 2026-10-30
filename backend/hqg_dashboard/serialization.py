"""Timestamps and the sparse JSON items the DynamoDB-backed API returned."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any


def utcnow() -> datetime:
    return datetime.now(UTC)


def isoformat(value: datetime | None) -> str | None:
    """UTC ISO 8601 with offset, as datetime.now(timezone.utc).isoformat() wrote it."""
    return value.astimezone(UTC).isoformat() if value else None


def isoformat_seconds(value: datetime | None) -> str | None:
    """UTC ISO 8601 with a Z suffix and whole seconds, used for access applications."""
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ") if value else None


def compact(item: dict[str, Any]) -> dict[str, Any]:
    """Drop unset attributes: DynamoDB items simply did not contain them."""
    return {key: value for key, value in item.items() if value is not None}
