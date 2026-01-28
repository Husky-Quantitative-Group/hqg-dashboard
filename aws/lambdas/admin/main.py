import json
import os
from decimal import Decimal
from typing import Any, Dict, List
import boto3

dynamo = boto3.resource("dynamodb")

USERS_TABLE = dynamo.Table(os.environ["USERS_TABLE"])
USER_ACCESS_APPLICATIONS_TABLE = dynamo.Table(os.environ["USER_ACCESS_APPLICATIONS_TABLE"])


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Admin service Lambda.
    - GET /admin/users
    - GET /admin/users/{netid}
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

    if route_key == "GET /admin/users/{netid}":
        return _not_implemented()

    if route_key == "PATCH /admin/users/{netid}":
        return _not_implemented()

    if route_key == "GET /admin/access-requests":
        return _not_implemented()

    if route_key == "POST /admin/access-requests/{netid}/approve":
        return _not_implemented()

    if route_key == "POST /admin/access-requests/{netid}/deny":
        return _not_implemented()

    return _json(404, {"message": "Not found"})


def _not_implemented() -> Dict[str, Any]:
    return _json(501, {"message": "Not implemented"})


def _get_auth_context(event: Dict[str, Any]) -> Dict[str, Any]:
    return (event.get("requestContext") or {}).get("authorizer", {}).get("lambda") or {}


def _list_users() -> Dict[str, Any]:
    resp = USERS_TABLE.scan()
    items: List[Dict[str, Any]] = resp.get("Items", [])
    return _json(200, _clean_decimals(items))


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
