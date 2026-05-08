import json
import os
import secrets
import time
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from hqg_permissions import (
    get_roles_from_event,
    has_read_permission,
)


dynamo = boto3.resource("dynamodb")

STRATEGY_DISCUSSION_TABLE = os.environ.get("STRATEGY_DISCUSSION_TABLE", "")
READ_PERMISSIONS_TABLE = os.environ.get("STRATEGIES_READ_PERMISSIONS_TABLE", "")
WRITE_PERMISSIONS_TABLE = os.environ.get("STRATEGIES_WRITE_PERMISSIONS_TABLE", "")
READ_PERMISSIONS_DDB = dynamo.Table(READ_PERMISSIONS_TABLE) if READ_PERMISSIONS_TABLE else None
WRITE_PERMISSIONS_DDB = dynamo.Table(WRITE_PERMISSIONS_TABLE) if WRITE_PERMISSIONS_TABLE else None
COMMENT_MAX_CHARS = 5000

_CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Strategy discussion service Lambda.
    - GET /strategies/{id}/discussion
    - POST /strategies/{id}/discussion
    """
    route_key = (event.get("requestContext") or {}).get("routeKey")

    if route_key == "GET /strategies/{id}/discussion":
        return list_discussion_comments(event)

    if route_key == "POST /strategies/{id}/discussion":
        return create_discussion_comment(event)

    return _json(404, {"message": "Not found"})


def list_discussion_comments(event: Dict[str, Any]) -> Dict[str, Any]:
    ctx = _require_strategy_context(event, require_table=True)
    if isinstance(ctx, dict):
        return ctx
    strategy_id, netid = ctx

    roles = get_roles_from_event(event)
    if not READ_PERMISSIONS_DDB or not WRITE_PERMISSIONS_DDB:
        return _json(500, {"message": "strategy permission tables are not configured"})
    if "ADMIN" not in roles and not has_read_permission(
        strategy_id, netid, roles, READ_PERMISSIONS_DDB, WRITE_PERMISSIONS_DDB
    ):
        return _json(403, {"message": "forbidden"})

    query_params = event.get("queryStringParameters") or {}
    try:
        limit = int(query_params.get("limit") or 50)
    except Exception:
        limit = 50
    limit = max(1, min(limit, 100))

    cursor = query_params.get("cursor")
    exclusive_start_key = None
    if isinstance(cursor, str) and cursor.strip():
        try:
            exclusive_start_key = json.loads(cursor)
        except Exception:
            return _json(400, {"message": "invalid cursor"})

    order = str(query_params.get("order") or "asc").strip().lower()
    if order not in {"asc", "desc"}:
        return _json(400, {"message": "order must be asc or desc"})

    table = dynamo.Table(STRATEGY_DISCUSSION_TABLE)
    try:
        query_kwargs = {
            "KeyConditionExpression": Key("strategy_id").eq(strategy_id),
            "ScanIndexForward": order == "asc",
            "Limit": limit,
        }
        if exclusive_start_key:
            query_kwargs["ExclusiveStartKey"] = exclusive_start_key
        resp = table.query(**query_kwargs)
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        return _json(500, {"message": f"Failed to query discussion comments: {code or 'error'}"})

    items = _clean_decimals(resp.get("Items", []))
    next_cursor = resp.get("LastEvaluatedKey")
    return _json(
        200,
        {
            "strategy_id": strategy_id,
            "items": items,
            "next_cursor": next_cursor,
        },
    )


def create_discussion_comment(event: Dict[str, Any]) -> Dict[str, Any]:
    ctx = _require_strategy_context(event, require_table=True)
    if isinstance(ctx, dict):
        return ctx
    strategy_id, netid = ctx

    roles = get_roles_from_event(event)
    if not READ_PERMISSIONS_DDB or not WRITE_PERMISSIONS_DDB:
        return _json(500, {"message": "strategy permission tables are not configured"})
    if "ADMIN" not in roles and not has_read_permission(
        strategy_id, netid, roles, READ_PERMISSIONS_DDB, WRITE_PERMISSIONS_DDB
    ):
        return _json(403, {"message": "forbidden"})

    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return _json(400, {"message": "invalid JSON body"})

    message = body.get("message")
    if not isinstance(message, str):
        return _json(400, {"message": "message must be a string"})

    trimmed_message = message.strip()
    if not trimmed_message:
        return _json(400, {"message": "message is required"})
    if len(trimmed_message) > COMMENT_MAX_CHARS:
        return _json(400, {"message": f"message must be {COMMENT_MAX_CHARS} characters or fewer"})

    comment_id = _ulid()
    now = _now()
    author_display = _display_name_from_authorizer(event) or netid
    item = {
        "strategy_id": strategy_id,
        "comment_id": comment_id,
        "message": trimmed_message,
        "author_netid": netid,
        "author_display": author_display,
        "created_at": now,
        "updated_at": now,
    }

    table = dynamo.Table(STRATEGY_DISCUSSION_TABLE)
    try:
        table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(strategy_id) AND attribute_not_exists(comment_id)",
        )
    except ClientError as exc:
        code = (exc.response.get("Error") or {}).get("Code")
        if code == "ConditionalCheckFailedException":
            return _json(409, {"message": "comment id already exists"})
        return _json(500, {"message": f"Failed to write discussion comment: {code or 'error'}"})

    return _json(201, _clean_decimals(item))


def _require_strategy_context(event: Dict[str, Any], *, require_table: bool = False):
    if require_table and not STRATEGY_DISCUSSION_TABLE:
        return _json(500, {"message": "STRATEGY_DISCUSSION_TABLE is not configured"})

    strategy_id = (event.get("pathParameters") or {}).get("id")
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    netid = _netid_from_authorizer(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    return strategy_id, netid


def _netid_from_authorizer(event: Dict[str, Any]):
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}

    if isinstance(authorizer.get("lambda"), dict):
        netid = authorizer["lambda"].get("netid")
        if isinstance(netid, str) and netid.strip():
            return netid.strip()

    netid = authorizer.get("netid")
    if isinstance(netid, str) and netid.strip():
        return netid.strip()

    return None


def _display_name_from_authorizer(event: Dict[str, Any]):
    authorizer = (event.get("requestContext") or {}).get("authorizer") or {}

    if isinstance(authorizer.get("lambda"), dict):
        display_name = authorizer["lambda"].get("display_name")
        if isinstance(display_name, str) and display_name.strip():
            return display_name.strip()

    display_name = authorizer.get("display_name")
    if isinstance(display_name, str) and display_name.strip():
        return display_name.strip()

    return None


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _ulid() -> str:
    ts_ms = int(time.time() * 1000)
    ts_str = _encode_crockford(ts_ms, 10)
    rand_str = _encode_crockford(secrets.randbits(80), 16)
    return ts_str + rand_str


def _encode_crockford(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(_CROCKFORD_BASE32[value & 31])
        value >>= 5
    return "".join(reversed(chars))


def _clean_decimals(data: Any) -> Any:
    if isinstance(data, list):
        return [_clean_decimals(item) for item in data]
    if isinstance(data, dict):
        return {k: _clean_decimals(v) for k, v in data.items()}
    if isinstance(data, Decimal):
        return int(data) if data % 1 == 0 else float(data)
    return data


def _json(code: int, body: Any) -> Dict[str, Any]:
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
