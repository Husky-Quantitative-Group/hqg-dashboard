import json
import os
from typing import Any, Dict, List, Optional

import boto3
from boto3.dynamodb.conditions import Key

from hqg_permissions import (
    get_roles_from_event,
    has_read_permission,
    has_write_permission,
)


dynamo = boto3.resource("dynamodb")

STRATEGIES_TABLE = dynamo.Table(os.environ["STRATEGIES_TABLE"])
READ_PERMISSIONS_TABLE = os.environ["STRATEGIES_READ_PERMISSIONS_TABLE"]
WRITE_PERMISSIONS_TABLE = os.environ["STRATEGIES_WRITE_PERMISSIONS_TABLE"]
READ_PERMISSIONS_DDB = dynamo.Table(READ_PERMISSIONS_TABLE)
WRITE_PERMISSIONS_DDB = dynamo.Table(WRITE_PERMISSIONS_TABLE)
USERS_TABLE = dynamo.Table(os.environ["USERS_TABLE"])


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    route_key = (event.get("requestContext") or {}).get("routeKey")
    strategy_id = (event.get("pathParameters") or {}).get("id")

    if route_key == "GET /strategies/{id}/permissions":
        return get_permissions(strategy_id, event)

    if route_key == "PATCH /strategies/{id}/permissions":
        body = json.loads(event.get("body") or "{}")
        return update_permissions(strategy_id, body, event, mode="patch")

    if route_key == "DELETE /strategies/{id}/permissions":
        body = json.loads(event.get("body") or "{}")
        return update_permissions(strategy_id, body, event, mode="delete")

    return {"statusCode": 404, "body": "Not found"}


def get_permissions(strategy_id: Optional[str], event: Dict[str, Any]) -> Dict[str, Any]:
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    netid = _get_netid_from_event(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    strategy = _get_strategy_by_id(strategy_id)
    if not strategy:
        return _json(404, {"message": "Strategy not found"})

    roles = get_roles_from_event(event)
    owner = strategy.get("owner")
    can_read = has_read_permission(
        strategy_id, netid, roles, READ_PERMISSIONS_DDB, WRITE_PERMISSIONS_DDB
    )
    can_write = has_write_permission(strategy_id, netid, roles, WRITE_PERMISSIONS_DDB)
    can_manage = "ADMIN" in roles or (owner and owner == netid)
    if not can_manage and not can_read:
        return _json(403, {"message": "forbidden"})

    return _json(
        200,
        {
            "read": _permission_snapshot(READ_PERMISSIONS_DDB, strategy_id),
            "write": _permission_snapshot(WRITE_PERMISSIONS_DDB, strategy_id),
            "canRead": can_read,
            "canWrite": can_write,
        },
    )


def update_permissions(
    strategy_id: Optional[str],
    body: Dict[str, Any],
    event: Dict[str, Any],
    mode: str,
) -> Dict[str, Any]:
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    netid = _get_netid_from_event(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    strategy = _get_strategy_by_id(strategy_id)
    if not strategy:
        return _json(404, {"message": "Strategy not found"})

    roles = get_roles_from_event(event)
    owner = strategy.get("owner")
    if "ADMIN" not in roles and (not owner or owner != netid):
        return _json(403, {"message": "forbidden"})

    if not isinstance(body, dict):
        return _json(400, {"message": "body must be an object"})

    for scope, table in (("read", READ_PERMISSIONS_DDB), ("write", WRITE_PERMISSIONS_DDB)):
        if scope not in body:
            continue
        scope_body = body.get(scope)
        if not isinstance(scope_body, dict):
            return _json(400, {"message": f"{scope} must be an object"})
        error = _apply_permission_changes(table, strategy_id, scope_body, mode)
        if error:
            return error
        if scope == "write" and mode == "patch":
            implied_read = _read_implied_changes(scope_body)
            if implied_read:
                error = _apply_permission_changes(
                    READ_PERMISSIONS_DDB, strategy_id, implied_read, "patch"
                )
                if error:
                    return error

    return _json(200, {"ok": True})


def _permission_snapshot(table, strategy_id: str) -> Dict[str, Any]:
    resp = table.query(
        KeyConditionExpression=Key("strategy_id").eq(strategy_id),
        ProjectionExpression="principal",
    )
    principals = [item.get("principal") for item in resp.get("Items", [])]
    public = any(principal == "ROLE#PUBLIC" for principal in principals)
    fund = any(principal == "ROLE#FUND" for principal in principals)
    netids = [
        principal.replace("USER#", "", 1)
        for principal in principals
        if isinstance(principal, str) and principal.startswith("USER#")
    ]

    users: List[Dict[str, Any]] = []
    for netid in netids:
        resp = USERS_TABLE.get_item(Key={"netid": netid})
        item = resp.get("Item") or {}
        users.append(
            {
                "netid": netid,
                "full_name": item.get("full_name") or "",
                "uconn_email": item.get("uconn_email") or "",
            }
        )

    return {"public": public, "fund": fund, "users": users}


def _apply_permission_changes(
    table,
    strategy_id: str,
    scope_body: Dict[str, Any],
    mode: str,
) -> Optional[Dict[str, Any]]:
    public = scope_body.get("public")
    fund = scope_body.get("fund")
    add_users = scope_body.get("addUsers", [])
    remove_users = scope_body.get("removeUsers", [])

    if public is not None and not isinstance(public, bool):
        return _json(400, {"message": "public must be a boolean"})
    if fund is not None and not isinstance(fund, bool):
        return _json(400, {"message": "fund must be a boolean"})
    if add_users is not None and not isinstance(add_users, list):
        return _json(400, {"message": "addUsers must be a list"})
    if remove_users is not None and not isinstance(remove_users, list):
        return _json(400, {"message": "removeUsers must be a list"})

    if mode == "patch":
        if public is True:
            table.put_item(Item={"strategy_id": strategy_id, "principal": "ROLE#PUBLIC"})
        elif public is False:
            table.delete_item(Key={"strategy_id": strategy_id, "principal": "ROLE#PUBLIC"})
        if fund is True:
            table.put_item(Item={"strategy_id": strategy_id, "principal": "ROLE#FUND"})
        elif fund is False:
            table.delete_item(Key={"strategy_id": strategy_id, "principal": "ROLE#FUND"})
        for netid in add_users or []:
            if isinstance(netid, str) and netid.strip():
                principal = _principal_for_user(netid.strip())
                table.put_item(Item={"strategy_id": strategy_id, "principal": principal})
    elif mode == "delete":
        if public is True:
            table.delete_item(Key={"strategy_id": strategy_id, "principal": "ROLE#PUBLIC"})
        if fund is True:
            table.delete_item(Key={"strategy_id": strategy_id, "principal": "ROLE#FUND"})
        for netid in remove_users or []:
            if isinstance(netid, str) and netid.strip():
                principal = _principal_for_user(netid.strip())
                table.delete_item(Key={"strategy_id": strategy_id, "principal": principal})
    else:
        return _json(500, {"message": "invalid mode"})

    return None


def _read_implied_changes(scope_body: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    implied: Dict[str, Any] = {}
    if scope_body.get("public") is True:
        implied["public"] = True
    if scope_body.get("fund") is True:
        implied["fund"] = True
    add_users = scope_body.get("addUsers")
    if isinstance(add_users, list) and add_users:
        implied["addUsers"] = add_users
    return implied or None


def _principal_for_user(netid: str) -> str:
    return f"USER#{netid}"


def _get_strategy_by_id(strategy_id: str) -> Optional[Dict[str, Any]]:
    resp = STRATEGIES_TABLE.get_item(Key={"id": strategy_id})
    return resp.get("Item")


def _get_netid_from_event(event: Dict[str, Any]) -> Optional[str]:
    request_context = event.get("requestContext") or {}
    authorizer = request_context.get("authorizer") or {}

    netid = authorizer.get("netid")
    if not netid and isinstance(authorizer.get("lambda"), dict):
        netid = authorizer.get("lambda", {}).get("netid")

    if not isinstance(netid, str):
        return None

    netid = netid.strip()
    return netid or None


def _json(code: int, body: Any) -> Dict[str, Any]:
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }
