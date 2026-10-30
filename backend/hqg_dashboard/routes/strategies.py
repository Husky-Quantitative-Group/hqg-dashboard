"""Listing, reading and branching strategies (formerly the strategies Lambda)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from psycopg import Connection

from ..artifacts import save_files
from ..dependencies import CurrentUser, Db, RawBody, parse_json_object
from ..errors import ApiError
from ..permissions import caller_principals, can_read, user_principal
from ..serialization import compact, isoformat, utcnow

router = APIRouter()

STRATEGY_NAME_MAX_CHARS = 60
DESCRIPTION_MAX_CHARS = 75
README_MAX_CHARS = 10_000
TAGS_MAX_COUNT = 5
TAG_MAX_CHARS = 15

# Strategies with their owner's current name, for strategy_json.
SELECT_STRATEGIES = """
    SELECT strategies.*, owners.full_name AS owner_full_name
    FROM strategies
    LEFT JOIN users AS owners ON owners.netid = strategies.owner
"""


@router.get("/strategies")
def list_strategies(user: CurrentUser, db: Db) -> list[dict[str, Any]]:
    with db.transaction() as conn:
        rows = conn.execute(
            SELECT_STRATEGIES
            + """
            WHERE %(is_admin)s OR strategies.id IN (
                SELECT strategy_id FROM strategy_permissions WHERE principal = ANY(%(principals)s)
            )
            ORDER BY strategies.created_at, strategies.id
            """,
            {"is_admin": user.is_admin, "principals": caller_principals(user.netid, user.roles)},
        ).fetchall()
    return [strategy_json(row) for row in rows]


@router.get("/strategies/{strategy_id}")
def get_strategy(strategy_id: str, user: CurrentUser, db: Db) -> dict[str, Any]:
    with db.transaction() as conn:
        if not can_read(conn, strategy_id, user.netid, user.roles):
            raise ApiError(403, "forbidden")
        row = conn.execute(
            SELECT_STRATEGIES + " WHERE strategies.id = %s", [strategy_id]
        ).fetchone()
    if row is None:
        raise ApiError(404, "Not found")
    return strategy_json(row)


@router.post("/strategies")
def create_strategy(user: CurrentUser, raw_body: RawBody, db: Db) -> JSONResponse:
    """Branch a new strategy from the latest files of one the caller can read."""
    body = parse_json_object(raw_body)
    source_id = body.get("source_strategy_id") or body.get("sourceStrategyId")
    if not source_id:
        raise ApiError(400, "source_strategy_id is required")
    source_id = str(source_id)
    name, description, readme_content, tags = _validate_new_strategy(body)

    with db.transaction() as conn:
        source = conn.execute("SELECT * FROM strategies WHERE id = %s", [source_id]).fetchone()
        if source is None:
            raise ApiError(404, f"Source strategy {source_id} not found")
        if not can_read(conn, source_id, user.netid, user.roles):
            raise ApiError(403, "forbidden")

        now = utcnow()
        strategy = {
            "id": str(conn.execute("SELECT nextval('strategy_id_seq') AS id").fetchone()["id"]),
            "name": name,
            "entrypoint": source["entrypoint"],
            "current_version": 1,
            "created_at": now,
            "updated_at": now,
            "description": description,
            "owner": user.netid,
            "owner_display": user.display_name.strip() or user.netid,
            "tags": tags,
        }
        conn.execute(
            """
            INSERT INTO strategies (
                id, name, entrypoint, current_version, created_at, updated_at,
                description, owner, owner_display, tags
            )
            VALUES (
                %(id)s, %(name)s, %(entrypoint)s, %(current_version)s, %(created_at)s,
                %(updated_at)s, %(description)s, %(owner)s, %(owner_display)s, %(tags)s
            )
            """,
            strategy,
        )
        files = _branch_files(conn, source_id, readme_content)
        save_files(conn, strategy["id"], 1, files, now)
        owner = user_principal(user.netid)
        conn.execute(
            """
            INSERT INTO strategy_permissions (strategy_id, access, principal)
            VALUES (%(id)s, 'read', %(owner)s), (%(id)s, 'write', %(owner)s)
            """,
            {"id": strategy["id"], "owner": owner},
        )

    return JSONResponse(strategy_json(strategy), status_code=201)


def strategy_json(row: dict[str, Any]) -> dict[str, Any]:
    owner_display = row["owner_display"]
    # Strategies created before their owner had a profile name show the current name.
    owner_name = (row.get("owner_full_name") or "").strip()
    if owner_name and (not owner_display or owner_display == row["owner"]):
        owner_display = owner_name

    return compact(
        {
            "id": row["id"],
            "name": row["name"],
            "entrypoint": row["entrypoint"],
            "current_version": row["current_version"],
            "created_at": isoformat(row["created_at"]),
            "updated_at": isoformat(row["updated_at"]),
            "description": row["description"],
            "owner": row["owner"],
            "owner_display": owner_display,
            "tags": row["tags"],
            "metrics": row.get("metrics"),
        }
    )


def _branch_files(conn: Connection, source_id: str, readme_content: str) -> dict[str, bytes]:
    """The source's latest files, with the README replaced (or added)."""
    rows = conn.execute(
        """
        SELECT artifacts.artifact_id, artifacts.latest_version, versions.content
        FROM strategy_artifacts AS artifacts
        LEFT JOIN strategy_artifact_versions AS versions
            ON versions.strategy_id = artifacts.strategy_id
            AND versions.artifact_id = artifacts.artifact_id
            AND versions.version = artifacts.latest_version
        WHERE artifacts.strategy_id = %s
        """,
        [source_id],
    ).fetchall()

    readme = readme_content.encode()
    files: dict[str, bytes] = {}
    for row in rows:
        artifact_id = row["artifact_id"]
        if row["content"] is None:
            raise ApiError(
                500,
                "Failed to copy artifacts: "
                f"Missing version record for {artifact_id} v{row['latest_version']}",
            )
        files[artifact_id] = readme if artifact_id.lower() == "readme.md" else row["content"]

    if not any(artifact_id.lower() == "readme.md" for artifact_id in files):
        files["README.md"] = readme
    return files


def _validate_new_strategy(body: dict[str, Any]) -> tuple[str, str, str, list[str]]:
    name = body.get("name", "")
    if not isinstance(name, str):
        raise ApiError(400, "name must be a string")
    name = name.strip()
    if not name:
        raise ApiError(400, "name is required")
    if len(name) > STRATEGY_NAME_MAX_CHARS:
        raise ApiError(400, f"name must be {STRATEGY_NAME_MAX_CHARS} characters or fewer")

    description = body.get("description", "")
    if not isinstance(description, str):
        raise ApiError(400, "description must be a string")
    description = description.strip()
    if len(description) > DESCRIPTION_MAX_CHARS:
        raise ApiError(400, f"description must be {DESCRIPTION_MAX_CHARS} characters or fewer")

    if "readme_content" not in body:
        raise ApiError(400, "readme_content is required")
    readme_content = body["readme_content"]
    if not isinstance(readme_content, str):
        raise ApiError(400, "readme_content must be a string")
    if len(readme_content) > README_MAX_CHARS:
        raise ApiError(400, f"readme_content must be {README_MAX_CHARS} characters or fewer")

    return name, description, readme_content, _validate_tags(body.get("tags"))


def _validate_tags(raw_tags: Any) -> list[str]:
    if raw_tags is None:
        return []
    if not isinstance(raw_tags, list):
        raise ApiError(400, "tags must be a list of strings")
    if len(raw_tags) > TAGS_MAX_COUNT:
        raise ApiError(400, f"tags must contain at most {TAGS_MAX_COUNT} items")

    tags: list[str] = []
    seen: set[str] = set()
    for raw_tag in raw_tags:
        if not isinstance(raw_tag, str):
            raise ApiError(400, "each tag must be a string")
        tag = raw_tag.strip()
        if not tag:
            raise ApiError(400, "tags cannot be empty")
        if len(tag) > TAG_MAX_CHARS:
            raise ApiError(400, f"each tag must be {TAG_MAX_CHARS} characters or fewer")
        if tag.lower() in seen:
            raise ApiError(400, "duplicate tags are not allowed")
        seen.add(tag.lower())
        tags.append(tag)
    return tags
