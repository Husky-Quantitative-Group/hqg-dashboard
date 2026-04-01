import json
import os
from decimal import Decimal
from typing import Any, Dict, List, Optional

import boto3
from boto3.dynamodb.conditions import Key

dynamo = boto3.resource("dynamodb")
USERS_TABLE = dynamo.Table(os.environ["USERS_TABLE"])


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Users service Lambda.
    - GET /users/search
    """
    route_key = (event.get("requestContext") or {}).get("routeKey")

    if route_key == "GET /users/search":
        return search_users(event)

    return {"statusCode": 404, "body": "Not found"}


def search_users(event: Dict[str, Any]) -> Dict[str, Any]:
    netid = _get_netid_from_event(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    query_params = event.get("queryStringParameters") or {}
    query = (query_params.get("q") or "").strip()
    if len(query) < 2:
        return _json(200, {"items": []})

    limit_raw = query_params.get("limit")
    try:
        limit = int(limit_raw) if limit_raw is not None else 8
    except ValueError:
        limit = 8
    limit = max(1, min(limit, 20))

    query_lower = query.lower()
    items: List[Dict[str, Any]] = []
    seen = set()

    def add_items(results: List[Dict[str, Any]]) -> None:
        for item in results:
            netid_value = str(item.get("netid") or "")
            if not netid_value or netid_value in seen:
                continue
            seen.add(netid_value)
            items.append(
                {
                    "netid": netid_value,
                    "full_name": item.get("full_name") or "",
                    "uconn_email": item.get("uconn_email") or "",
                }
            )

    pk_value = "USER"

    try:
        netid_resp = USERS_TABLE.query(
            IndexName="users-netid-gsi",
            KeyConditionExpression=Key("search_pk").eq(pk_value)
            & Key("netid").begins_with(query_lower),
            ProjectionExpression="netid, full_name, uconn_email",
            Limit=limit,
        )
        add_items(netid_resp.get("Items", []))
    except Exception:
        pass

    if len(items) < limit:
        remaining = limit - len(items)
        try:
            name_resp = USERS_TABLE.query(
                IndexName="users-full-name-gsi",
                KeyConditionExpression=Key("search_pk").eq(pk_value)
                & Key("full_name_lower").begins_with(query_lower),
                ProjectionExpression="netid, full_name, uconn_email",
                Limit=remaining,
            )
            add_items(name_resp.get("Items", []))
        except Exception:
            pass

    return _json(200, {"items": _clean_decimals(items)})


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
