"""Strategy files (formerly the strategy_artifacts Lambda)."""

from __future__ import annotations

import re
from typing import Any
from urllib.parse import quote

import psycopg
from fastapi import APIRouter
from fastapi.responses import Response

from ..artifacts import StaleVersion, publish_version
from ..dependencies import CurrentUser, Db, RawBody, parse_json_object
from ..errors import ApiError
from ..permissions import can_read, can_write

router = APIRouter()

MAX_FILE_BYTES = 1_000_000
# DynamoDB's transaction size capped saves at 49 files; clients still see that rule.
MAX_FILES_PER_SAVE = 49
PRINTABLE_ASCII = re.compile(r"[ -~]+")


@router.get("/strategies/{strategy_id}/artifacts")
def list_artifacts(strategy_id: str, user: CurrentUser, db: Db) -> dict[str, Any]:
    with db.transaction() as conn:
        if not can_read(conn, strategy_id, user.netid, user.roles):
            raise ApiError(403, "forbidden")
        rows = conn.execute(
            """
            SELECT artifact_id FROM strategy_artifacts
            WHERE strategy_id = %s
            ORDER BY artifact_id COLLATE "C"
            """,
            [strategy_id],
        )
        return {"artifacts": [row["artifact_id"] for row in rows]}


@router.get("/strategies/{strategy_id}/artifacts/{artifact_id:path}")
def download_artifact(strategy_id: str, artifact_id: str, user: CurrentUser, db: Db) -> Response:
    """The latest version of one file."""
    with db.transaction() as conn:
        if not can_read(conn, strategy_id, user.netid, user.roles):
            raise ApiError(403, "forbidden")
        row = conn.execute(
            """
            SELECT versions.content
            FROM strategy_artifacts AS artifacts
            LEFT JOIN strategy_artifact_versions AS versions
                ON versions.strategy_id = artifacts.strategy_id
                AND versions.artifact_id = artifacts.artifact_id
                AND versions.version = artifacts.latest_version
            WHERE artifacts.strategy_id = %s AND artifacts.artifact_id = %s
            """,
            [strategy_id, artifact_id],
        ).fetchone()

    if row is None:
        raise ApiError(404, "Artifact not found")
    if row["content"] is None:
        raise ApiError(404, "Artifact version not found")
    if len(row["content"]) > MAX_FILE_BYTES:
        raise ApiError(413, "Artifact too large")
    return Response(
        row["content"],
        media_type="application/octet-stream",
        headers={"Content-Disposition": _attachment(artifact_id)},
    )


@router.post("/strategies/{strategy_id}/artifacts")
def save_artifacts(
    strategy_id: str, user: CurrentUser, raw_body: RawBody, db: Db
) -> dict[str, Any]:
    """Publish the given files as the strategy's next version.

    Expects {"files": [{"artifactId": "main.py", "content": "<text>"}, ...]}.
    """
    files = parse_json_object(raw_body).get("files") or []
    if not isinstance(files, list) or not files:
        raise ApiError(400, "files must be a non-empty list")

    with db.transaction() as conn:
        if not can_write(conn, strategy_id, user.netid, user.roles):
            raise ApiError(403, "forbidden")
        strategy = conn.execute(
            "SELECT current_version FROM strategies WHERE id = %s", [strategy_id]
        ).fetchone()
    if strategy is None:
        raise ApiError(404, "Strategy not found")

    contents = _validated_contents(files)
    try:
        version = publish_version(db, strategy_id, strategy["current_version"], contents)
    except StaleVersion as exc:
        raise ApiError(409, "Strategy changed; refresh before saving") from exc
    except psycopg.Error as exc:
        raise ApiError(503, "Artifact save unavailable") from exc

    return {"ok": True, "version": version, "artifacts": list(contents)}


def _validated_contents(files: list[Any]) -> dict[str, bytes]:
    prepared: list[tuple[str, bytes]] = []
    for file in files:
        file = file if isinstance(file, dict) else {}
        artifact_id, content = file.get("artifactId"), file.get("content")
        if not isinstance(artifact_id, str) or not artifact_id or content is None:
            raise ApiError(400, "Each file must include artifactId and content")
        if not isinstance(content, str):
            raise ApiError(400, f"Invalid content for {artifact_id}")
        try:
            data = content.encode("utf-8")
        except UnicodeEncodeError as exc:  # Unpaired surrogates in the JSON string.
            raise ApiError(400, f"Invalid content for {artifact_id}") from exc
        if len(data) > MAX_FILE_BYTES:
            raise ApiError(413, f"{artifact_id} exceeds max size of 1MB")
        prepared.append((artifact_id, data))

    contents = dict(prepared)
    if len(prepared) > MAX_FILES_PER_SAVE or len(contents) != len(prepared):
        raise ApiError(400, "Save 1-49 unique artifacts at a time")
    return contents


def _attachment(filename: str) -> str:
    """A Content-Disposition value that is valid for any file name."""
    if PRINTABLE_ASCII.fullmatch(filename) and '"' not in filename and "\\" not in filename:
        return f'attachment; filename="{filename}"'
    return f"attachment; filename*=UTF-8''{quote(filename, safe='')}"
