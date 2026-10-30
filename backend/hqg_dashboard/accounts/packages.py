"""Saved strategy versions as immutable, version-pinned engine packages.

A registered package is stored among the account's records, in the same
transaction as the registration, and is never rewritten. (The AWS version kept
it as a separate object in the versioned artifacts bucket.)
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from ..db import Database
from ..permissions import can_read
from .control import Forbidden, Invalid
from .validation import MAX_PACKAGE_BYTES, validate_package

MAX_PACKAGE_FILES = 32


class StrategySource:
    def __init__(self, db: Database) -> None:
        self.db = db

    def resolve(
        self, strategy_id: str, version: int, actor: str, roles: Iterable[str]
    ) -> dict[str, Any]:
        """The files of a published strategy version, as a validated package."""
        with self.db.transaction() as conn:
            if not actor or not can_read(conn, strategy_id, actor, roles):
                raise Forbidden("Strategy read permission required")
            metadata = conn.execute(
                "SELECT current_version, entrypoint FROM strategies WHERE id = %s", [strategy_id]
            ).fetchone()
            if (
                not metadata
                or type(version) is not int
                or not 1 <= version <= metadata["current_version"]
            ):
                raise Invalid("Saved strategy version is not published")

            # Each file's newest version at or below the requested strategy version.
            rows = conn.execute(
                """
                SELECT artifacts.artifact_id, artifacts.latest_version, versions.content
                FROM strategy_artifacts AS artifacts
                LEFT JOIN LATERAL (
                    SELECT content FROM strategy_artifact_versions
                    WHERE strategy_id = artifacts.strategy_id
                      AND artifact_id = artifacts.artifact_id
                      AND version <= %(version)s
                    ORDER BY version DESC
                    LIMIT 1
                ) AS versions ON true
                WHERE artifacts.strategy_id = %(strategy_id)s
                ORDER BY artifacts.artifact_id COLLATE "C"
                """,
                {"strategy_id": strategy_id, "version": version},
            ).fetchall()

        files, size = {}, 0
        for row in rows:
            if row["content"] is None:
                if row["latest_version"] <= version:
                    raise Invalid("Artifact history is missing")
                continue  # This file was introduced after the requested version.
            size += len(row["content"])
            if size > MAX_PACKAGE_BYTES or len(files) >= MAX_PACKAGE_FILES:
                raise Invalid("Strategy package exceeds limits")
            files[row["artifact_id"]] = row["content"].decode("utf-8")

        package = dict(
            strategy_id=strategy_id,
            version=version,
            entrypoint=metadata["entrypoint"],
            files=files,
        )
        validate_package(package)
        return package

    def snapshot(self, account_id: str, package: dict[str, Any]) -> dict[str, Any]:
        """The record stored beside a registration: the package itself."""
        validate_package(package)
        return {"package": package}

    def download(self, reference: dict[str, Any], source_digest: str) -> dict[str, Any]:
        package = reference["package"]
        if validate_package(package)[0]["source_digest"] != source_digest:
            raise Invalid("Strategy package digest mismatch")
        return package
