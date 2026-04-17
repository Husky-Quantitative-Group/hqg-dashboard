import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


dynamo = boto3.resource("dynamodb")

USERS_TABLE = dynamo.Table(os.environ["USERS_TABLE"])
USER_ACCESS_APPLICATIONS_TABLE = dynamo.Table(os.environ["USER_ACCESS_APPLICATIONS_TABLE"])
USER_ANALYTICS_TABLE = dynamo.Table(os.environ["USER_ANALYTICS_TABLE"])
STRATEGIES_TABLE = dynamo.Table(os.environ["STRATEGIES_TABLE"])
READ_PERMISSIONS_TABLE = dynamo.Table(os.environ["STRATEGIES_READ_PERMISSIONS_TABLE"])
WRITE_PERMISSIONS_TABLE = dynamo.Table(os.environ["STRATEGIES_WRITE_PERMISSIONS_TABLE"])
STRATEGY_BACKTESTS_TABLE = dynamo.Table(os.environ["STRATEGY_BACKTESTS_TABLE"])


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Admin service Lambda.
    - GET /admin/analytics
    - GET /admin/users
    - GET /admin/users/{netid}
    - GET /admin/users/{netid}/analytics
    - PATCH /admin/users/{netid}
    - GET /admin/access-requests
    - POST /admin/access-requests/{netid}/approve
    - POST /admin/access-requests/{netid}/deny
    """
    route_key = (event.get("requestContext") or {}).get("routeKey")

    auth_context = _get_auth_context(event)
    roles = json.loads(auth_context.get("roles", "[]"))
    if "ADMIN" not in roles:
        return _json(403, {"message": "Forbidden"})

    if route_key == "GET /admin/users":
        return _list_users()

    if route_key == "GET /admin/analytics":
        return _get_global_analytics()

    if route_key == "GET /admin/users/{netid}":
        netid = _get_netid_param(event)
        return _get_user(netid)

    if route_key == "GET /admin/users/{netid}/analytics":
        netid = _get_netid_param(event)
        return _get_user_analytics(netid)

    if route_key == "PATCH /admin/users/{netid}":
        netid = _get_netid_param(event)
        body = _parse_body(event)
        return _patch_user(netid, body)

    if route_key == "GET /admin/access-requests":
        return _list_access_requests()

    if route_key == "POST /admin/access-requests/{netid}/approve":
        netid = _get_netid_param(event)
        decision_notes = _get_decision_notes(event)
        return _approve_access_request(netid, decision_notes, auth_context.get("netid"))

    if route_key == "POST /admin/access-requests/{netid}/deny":
        netid = _get_netid_param(event)
        decision_notes = _get_decision_notes(event)
        return _deny_access_request(netid, decision_notes, auth_context.get("netid"))

    return _json(404, {"message": "Not found"})


def _not_implemented() -> Dict[str, Any]:
    return _json(501, {"message": "Not implemented"})


def _get_auth_context(event: Dict[str, Any]) -> Dict[str, Any]:
    return (event.get("requestContext") or {}).get("authorizer", {}).get("lambda") or {}


def _list_users() -> Dict[str, Any]:
    resp = USERS_TABLE.scan()
    items: List[Dict[str, Any]] = resp.get("Items", [])
    return _json(200, _clean_decimals(items))


def _list_access_requests() -> Dict[str, Any]:
    resp = USER_ACCESS_APPLICATIONS_TABLE.scan()
    items: List[Dict[str, Any]] = resp.get("Items", [])
    return _json(200, _clean_decimals(items))


def _get_user(netid: str | None) -> Dict[str, Any]:
    if not netid:
        return _json(400, {"message": "netid is required"})
    resp = USERS_TABLE.get_item(Key={"netid": netid})
    item = resp.get("Item")
    if not item:
        return _json(404, {"message": "User not found"})
    return _json(200, _clean_decimals(item))


def _get_global_analytics() -> Dict[str, Any]:
    payload = {
        "total_users": _count_table_items(USERS_TABLE),
        "total_strategies": _count_table_items(STRATEGIES_TABLE),
        "total_backtests": _count_table_items(STRATEGY_BACKTESTS_TABLE),
        "updated_at": _now_iso(),
    }
    return _json(200, payload)


def _get_user_analytics(netid: str | None) -> Dict[str, Any]:
    if not netid:
        return _json(400, {"message": "netid is required"})

    user_resp = USERS_TABLE.get_item(Key={"netid": netid})
    user_item = user_resp.get("Item")
    if not user_item:
        return _json(404, {"message": "User not found"})

    analytics_resp = USER_ANALYTICS_TABLE.get_item(Key={"netid": netid})
    analytics_item = analytics_resp.get("Item") or {}

    permissions_footprint = _permissions_footprint(netid, user_item)
    payload = {
        "netid": netid,
        "total_strategies_created": analytics_item.get("total_strategies_created", 0),
        "total_backtests_run": analytics_item.get("total_backtests_run", 0),
        "total_revisions": analytics_item.get("total_revisions", 0),
        "last_active_at": analytics_item.get("last_active_at"),
        "updated_at": analytics_item.get("updated_at"),
        "permissions_footprint": permissions_footprint,
    }
    return _json(200, _clean_decimals(payload))


def _patch_user(netid: str | None, body: Dict[str, Any]) -> Dict[str, Any]:
    if not netid:
        return _json(400, {"message": "netid is required"})
    if not body:
        return _json(400, {"message": "body is required"})

    allowed_fields = {
        "full_name",
        "full_name_lower",
        "search_pk",
        "uconn_email",
        "discord_username",
        "linkedin_url",
        "github_url",
        "roles",
        "is_banned",
        "notes",
    }
    body = {k: v for k, v in body.items() if k in allowed_fields}
    if not body:
        return _json(400, {"message": "no updatable fields provided"})

    roles = body.get("roles")
    if roles is not None:
        if not isinstance(roles, list):
            return _json(400, {"message": "roles must be a list of PUBLIC/FUND/ADMIN"})
        allowed_roles = {"PUBLIC", "FUND", "ADMIN"}
        if any(role not in allowed_roles for role in roles):
            return _json(400, {"message": "roles must be a list of PUBLIC/FUND/ADMIN"})
        body["roles"] = roles

    update_parts: List[str] = []
    expr_names: Dict[str, str] = {}
    expr_values: Dict[str, Any] = {}

    if "full_name" in body:
        full_name_value = body.get("full_name")
        if isinstance(full_name_value, str) and full_name_value.strip():
            body["full_name_lower"] = full_name_value.strip().lower()
        else:
            body.pop("full_name_lower", None)

    if "search_pk" in body:
        search_pk_value = body.get("search_pk")
        if not isinstance(search_pk_value, str) or not search_pk_value.strip():
            return _json(400, {"message": "search_pk must be a non-empty string"})
        body["search_pk"] = search_pk_value.strip()
    else:
        body["search_pk"] = "USER"

    for idx, (key, value) in enumerate(body.items()):
        name_key = f"#k{idx}"
        value_key = f":v{idx}"
        expr_names[name_key] = key
        expr_values[value_key] = value
        update_parts.append(f"{name_key} = {value_key}")

    expr_names["#updated_at"] = "updated_at"
    expr_values[":updated_at"] = _now_iso()
    update_parts.append("#updated_at = :updated_at")

    update_expr = "SET " + ", ".join(update_parts)

    try:
        resp = USERS_TABLE.update_item(
            Key={"netid": netid},
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
            ConditionExpression="attribute_exists(netid)",
            ReturnValues="ALL_NEW",
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code == "ConditionalCheckFailedException":
            return _json(404, {"message": "User not found"})
        return _json(500, {"message": "Failed to update user"})

    return _json(200, _clean_decimals(resp.get("Attributes") or {}))


def _approve_access_request(netid: str | None, decision_notes: str, decided_by: str | None) -> Dict[str, Any]:
    if not netid:
        return _json(400, {"message": "netid is required"})

    # get latest request from user
    resp = USER_ACCESS_APPLICATIONS_TABLE.query(
        KeyConditionExpression=Key("netid").eq(netid),
        ScanIndexForward=False,
        Limit=1,
    )
    items = resp.get("Items", [])
    request_item = items[0] if items else None
    if not request_item or request_item.get("status", "").upper() != "PENDING":
        return _json(404, {"message": "Pending access request not found"})

    decided_at = _now_iso()

    update_expr = (
        "SET #status = :status, "
        "decided_at = :decided_at, "
        "decision_notes = :decision_notes, "
        "decided_by = :decided_by"
    )
    expr_names = {"#status": "status"}
    expr_values: Dict[str, Any] = {
        ":status": "APPROVED",
        ":decided_at": decided_at,
        ":decision_notes": decision_notes,
        ":decided_by": decided_by
    }

    roles = ["PUBLIC"]

    full_name = request_item.get("full_name")
    user_item = {
        "netid": netid,
        "full_name": full_name,
        "discord_username": request_item.get("discord_username"),
        "linkedin_url": request_item.get("linkedin_url"),
        "github_url": request_item.get("github_url"),
        "uconn_email": request_item.get("uconn_email"),
        "joined_at": decided_at,
        "roles": roles,
        "is_banned": False,
        "search_pk": "USER",
    }
    if isinstance(full_name, str) and full_name.strip():
        user_item["full_name_lower"] = full_name.strip().lower()

    try:
        dynamo.meta.client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": USER_ACCESS_APPLICATIONS_TABLE.name,
                        "Key": {
                            "netid": netid,
                            "created_at": request_item.get("created_at"),
                        },
                        "UpdateExpression": update_expr,
                        "ExpressionAttributeNames": expr_names,
                        "ExpressionAttributeValues": expr_values,
                    }
                },
                {
                    "Put": {
                        "TableName": USERS_TABLE.name,
                        "Item": user_item,
                        "ConditionExpression": "attribute_not_exists(netid)",
                    }
                },
            ]
        )
    except ClientError:
        return _json(500, {"message": "Failed to approve access request"})

    return _json(200, {"ok": True, "user": _clean_decimals(user_item)})


def _deny_access_request(netid: str | None, decision_notes: str, decided_by: str | None) -> Dict[str, Any]:
    if not netid:
        return _json(400, {"message": "netid is required"})
    
    # get latest request from user
    resp = USER_ACCESS_APPLICATIONS_TABLE.query(
        KeyConditionExpression=Key("netid").eq(netid),
        ScanIndexForward=False,
        Limit=1,
    )
    items = resp.get("Items", [])
    request_item = items[0] if items else None
    if not request_item or request_item.get("status", "").upper() != "PENDING":
        return _json(404, {"message": "Pending access request not found"})

    decided_at = _now_iso()

    update_expr = (
        "SET #status = :status, "
        "decided_at = :decided_at, "
        "decision_notes = :decision_notes, "
        "decided_by = :decided_by"
    )
    expr_names = {"#status": "status"}
    expr_values: Dict[str, Any] = {
        ":status": "DENIED",
        ":decided_at": decided_at,
        ":decision_notes": decision_notes,
        ":decided_by": decided_by
    }

    try:
        USER_ACCESS_APPLICATIONS_TABLE.update_item(
            Key={
                "netid": netid,
                "created_at": request_item.get("created_at"),
            },
            UpdateExpression=update_expr,
            ExpressionAttributeNames=expr_names,
            ExpressionAttributeValues=expr_values,
        )
    except ClientError:
        return _json(500, {"message": "Failed to deny access request"})

    return _json(200, {"ok": True})


def _get_netid_param(event: Dict[str, Any]) -> str | None:
    path_params = event.get("pathParameters") or {}
    netid = path_params.get("netid")
    if not isinstance(netid, str):
        return None
    netid = netid.strip()
    return netid or None

def _get_decision_notes(event: Dict[str, Any]) -> str:
    parsed = _parse_body(event)
    value = parsed.get("decision_notes", "")
    if isinstance(value, str):
        return value
    return str(value)


def _parse_body(event: Dict[str, Any]) -> Dict[str, Any]:
    raw_body = event.get("body")
    if not raw_body:
        return {}
    try:
        parsed = json.loads(raw_body)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _permissions_footprint(netid: str, user_item: Dict[str, Any]) -> Dict[str, int]:
    roles = user_item.get("roles")
    role_set = {role for role in roles if isinstance(role, str)} if isinstance(roles, list) else set()

    if "ADMIN" in role_set:
        total_strategies = _count_table_items(STRATEGIES_TABLE)
        return {
            "readable_strategy_count": total_strategies,
            "writable_strategy_count": total_strategies,
        }

    principals = {f"USER#{netid}"}
    for role in role_set:
        principals.add(f"ROLE#{role}")

    readable = _strategy_ids_for_principals(READ_PERMISSIONS_TABLE, principals)
    writable = _strategy_ids_for_principals(WRITE_PERMISSIONS_TABLE, principals)
    readable.update(writable)

    return {
        "readable_strategy_count": len(readable),
        "writable_strategy_count": len(writable),
    }


def _strategy_ids_for_principals(table, principals: set[str]) -> set[str]:
    strategy_ids: set[str] = set()
    for principal in principals:
        last_key = None
        while True:
            query_kwargs = {
                "IndexName": "principal-strategy-index",
                "KeyConditionExpression": Key("principal").eq(principal),
                "ProjectionExpression": "strategy_id",
            }
            if last_key:
                query_kwargs["ExclusiveStartKey"] = last_key

            resp = table.query(**query_kwargs)
            for item in resp.get("Items", []):
                strategy_id = item.get("strategy_id")
                if isinstance(strategy_id, str):
                    strategy_ids.add(strategy_id)

            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                break

    return strategy_ids


def _count_table_items(table) -> int:
    count = 0
    scan_kwargs = {"Select": "COUNT"}
    while True:
        resp = table.scan(**scan_kwargs)
        count += int(resp.get("Count", 0))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key
    return count


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


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
