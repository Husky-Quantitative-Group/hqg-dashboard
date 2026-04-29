import json
import os
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Dict, List

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


dynamo = boto3.resource("dynamodb")

USERS_TABLE = dynamo.Table(os.environ["USERS_TABLE"])
USER_ACCESS_APPLICATIONS_TABLE = dynamo.Table(os.environ["USER_ACCESS_APPLICATIONS_TABLE"])
ANALYTICS_TABLE = dynamo.Table(os.environ["ANALYTICS_TABLE"])
STRATEGIES_TABLE = dynamo.Table(os.environ["STRATEGIES_TABLE"])
READ_PERMISSIONS_TABLE = dynamo.Table(os.environ["STRATEGIES_READ_PERMISSIONS_TABLE"])
WRITE_PERMISSIONS_TABLE = dynamo.Table(os.environ["STRATEGIES_WRITE_PERMISSIONS_TABLE"])
STRATEGY_BACKTESTS_TABLE = dynamo.Table(os.environ["STRATEGY_BACKTESTS_TABLE"])

USERS_JOINED_METRIC = "users_joined"
STRATEGIES_CREATED_METRIC = "strategies_created"
BACKTESTS_CREATED_METRIC = "backtests_created"
USERS_LOGGED_IN_METRIC = "users_logged_in"
DEFAULT_ANALYTICS_DAYS = 30
MAX_ANALYTICS_DAYS = 365


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    route_key = (event.get("requestContext") or {}).get("routeKey")

    auth_context = _get_auth_context(event)
    roles = json.loads(auth_context.get("roles", "[]"))
    if "ADMIN" not in roles:
        return _json(403, {"message": "Forbidden"})

    if route_key == "GET /admin/users":
        return _list_users()

    if route_key == "GET /admin/analytics":
        return _get_global_analytics()

    if route_key == "GET /admin/analytics/timeseries":
        return _get_global_analytics_timeseries(event)

    if route_key == "GET /admin/users/{netid}":
        return _get_user(_get_netid_param(event))

    if route_key == "GET /admin/users/{netid}/analytics":
        return _get_user_analytics(_get_netid_param(event))

    if route_key == "PATCH /admin/users/{netid}":
        return _patch_user(_get_netid_param(event), _parse_body(event))

    if route_key == "GET /admin/access-requests":
        return _list_access_requests()

    if route_key == "POST /admin/access-requests/{netid}/approve":
        return _approve_access_request(
            _get_netid_param(event),
            _get_decision_notes(event),
            auth_context.get("netid"),
        )

    if route_key == "POST /admin/access-requests/{netid}/deny":
        return _deny_access_request(
            _get_netid_param(event),
            _get_decision_notes(event),
            auth_context.get("netid"),
        )

    return _json(404, {"message": "Not found"})


def _get_auth_context(event: Dict[str, Any]) -> Dict[str, Any]:
    return (event.get("requestContext") or {}).get("authorizer", {}).get("lambda") or {}


def _list_users() -> Dict[str, Any]:
    resp = USERS_TABLE.scan()
    return _json(200, _clean_decimals(resp.get("Items", [])))


def _list_access_requests() -> Dict[str, Any]:
    resp = USER_ACCESS_APPLICATIONS_TABLE.scan()
    return _json(200, _clean_decimals(resp.get("Items", [])))


def _get_user(netid: str | None) -> Dict[str, Any]:
    if not netid:
        return _json(400, {"message": "netid is required"})
    resp = USERS_TABLE.get_item(Key={"netid": netid})
    item = resp.get("Item")
    if not item:
        return _json(404, {"message": "User not found"})
    return _json(200, _clean_decimals(item))


def _get_global_analytics() -> Dict[str, Any]:
    today = _today_date()
    payload = {
        "total_users": _metric_cumulative_total(USERS_JOINED_METRIC, today),
        "total_strategies": _metric_cumulative_total(STRATEGIES_CREATED_METRIC, today),
        "total_backtests": _metric_cumulative_total(BACKTESTS_CREATED_METRIC, today),
        "users_logged_in_today": _metric_daily_count(USERS_LOGGED_IN_METRIC, today),
        "updated_at": _now_iso(),
    }
    return _json(200, payload)


def _get_global_analytics_timeseries(event: Dict[str, Any]) -> Dict[str, Any]:
    query_params = event.get("queryStringParameters") or {}
    end_date = _parse_day(query_params.get("to")) or _today_date()
    days = _parse_days(query_params.get("days"))
    start_date = _parse_day(query_params.get("from"))
    if not start_date:
        start_date = end_date - timedelta(days=days - 1)
    if start_date > end_date:
        return _json(400, {"message": "`from` must be on or before `to`"})

    dates = _date_range(start_date, end_date)
    users_daily = _metric_daily_map(USERS_JOINED_METRIC, start_date, end_date)
    strategies_daily = _metric_daily_map(STRATEGIES_CREATED_METRIC, start_date, end_date)
    backtests_daily = _metric_daily_map(BACKTESTS_CREATED_METRIC, start_date, end_date)
    users_logged_in_daily = _metric_daily_map(USERS_LOGGED_IN_METRIC, start_date, end_date)

    payload = {
        "from": start_date.isoformat(),
        "to": end_date.isoformat(),
        "updated_at": _now_iso(),
        "series": {
            "total_users": _build_cumulative_series(
                dates, users_daily, _metric_cumulative_total(USERS_JOINED_METRIC, start_date - timedelta(days=1))
            ),
            "total_strategies": _build_cumulative_series(
                dates,
                strategies_daily,
                _metric_cumulative_total(STRATEGIES_CREATED_METRIC, start_date - timedelta(days=1)),
            ),
            "total_backtests": _build_cumulative_series(
                dates,
                backtests_daily,
                _metric_cumulative_total(BACKTESTS_CREATED_METRIC, start_date - timedelta(days=1)),
            ),
            "users_logged_in": _build_daily_series(dates, users_logged_in_daily),
        },
    }
    return _json(200, payload)


def _get_user_analytics(netid: str | None) -> Dict[str, Any]:
    if not netid:
        return _json(400, {"message": "netid is required"})

    user_resp = USERS_TABLE.get_item(Key={"netid": netid})
    user_item = user_resp.get("Item")
    if not user_item:
        return _json(404, {"message": "User not found"})

    analytics_item = _load_user_summary(netid)
    payload = {
        "netid": netid,
        "total_strategies_created": analytics_item.get("total_strategies_created", 0),
        "total_backtests_run": analytics_item.get("total_backtests_run", 0),
        "total_revisions": analytics_item.get("total_revisions", 0),
        "last_active_at": analytics_item.get("last_active_at"),
        "updated_at": analytics_item.get("updated_at"),
        "permissions_footprint": _permissions_footprint(netid, user_item),
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

    update_parts: List[str] = []
    expr_names: Dict[str, str] = {}
    expr_values: Dict[str, Any] = {}

    for idx, (key, value) in enumerate(body.items()):
        name_key = f"#k{idx}"
        value_key = f":v{idx}"
        expr_names[name_key] = key
        expr_values[value_key] = value
        update_parts.append(f"{name_key} = {value_key}")

    expr_names["#updated_at"] = "updated_at"
    expr_values[":updated_at"] = _now_iso()
    update_parts.append("#updated_at = :updated_at")

    try:
        resp = USERS_TABLE.update_item(
            Key={"netid": netid},
            UpdateExpression="SET " + ", ".join(update_parts),
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
    user_item = {
        "netid": netid,
        "full_name": request_item.get("full_name"),
        "discord_username": request_item.get("discord_username"),
        "linkedin_url": request_item.get("linkedin_url"),
        "github_url": request_item.get("github_url"),
        "uconn_email": request_item.get("uconn_email"),
        "joined_at": decided_at,
        "roles": ["PUBLIC"],
        "is_banned": False,
        "search_pk": "USER",
    }
    if isinstance(user_item["full_name"], str) and user_item["full_name"].strip():
        user_item["full_name_lower"] = user_item["full_name"].strip().lower()

    try:
        dynamo.meta.client.transact_write_items(
            TransactItems=[
                {
                    "Update": {
                        "TableName": USER_ACCESS_APPLICATIONS_TABLE.name,
                        "Key": {
                            "netid": {"S": netid},
                            "created_at": {"S": request_item.get("created_at")},
                        },
                        "UpdateExpression": (
                            "SET #status = :status, decided_at = :decided_at, "
                            "decision_notes = :decision_notes, decided_by = :decided_by"
                        ),
                        "ExpressionAttributeNames": {"#status": "status"},
                        "ExpressionAttributeValues": {
                            ":status": {"S": "APPROVED"},
                            ":decided_at": {"S": decided_at},
                            ":decision_notes": {"S": decision_notes},
                            ":decided_by": {"S": decided_by or ""},
                        },
                    }
                },
                {
                    "Put": {
                        "TableName": USERS_TABLE.name,
                        "Item": _ddb_item(user_item),
                        "ConditionExpression": "attribute_not_exists(netid)",
                    }
                },
            ]
        )
    except ClientError:
        return _json(500, {"message": "Failed to approve access request"})

    _increment_daily_metric(USERS_JOINED_METRIC, _day_bucket(decided_at))
    return _json(200, {"ok": True, "user": _clean_decimals(user_item)})


def _deny_access_request(netid: str | None, decision_notes: str, decided_by: str | None) -> Dict[str, Any]:
    if not netid:
        return _json(400, {"message": "netid is required"})

    resp = USER_ACCESS_APPLICATIONS_TABLE.query(
        KeyConditionExpression=Key("netid").eq(netid),
        ScanIndexForward=False,
        Limit=1,
    )
    items = resp.get("Items", [])
    request_item = items[0] if items else None
    if not request_item or request_item.get("status", "").upper() != "PENDING":
        return _json(404, {"message": "Pending access request not found"})

    try:
        USER_ACCESS_APPLICATIONS_TABLE.update_item(
            Key={"netid": netid, "created_at": request_item.get("created_at")},
            UpdateExpression=(
                "SET #status = :status, decided_at = :decided_at, "
                "decision_notes = :decision_notes, decided_by = :decided_by"
            ),
            ExpressionAttributeNames={"#status": "status"},
            ExpressionAttributeValues={
                ":status": "DENIED",
                ":decided_at": _now_iso(),
                ":decision_notes": decision_notes,
                ":decided_by": decided_by,
            },
        )
    except ClientError:
        return _json(500, {"message": "Failed to deny access request"})

    return _json(200, {"ok": True})


def _load_user_summary(netid: str) -> Dict[str, Any]:
    resp = ANALYTICS_TABLE.get_item(Key={"pk": f"USER#{netid}", "sk": "SUMMARY"})
    return resp.get("Item") or {}


def _increment_daily_metric(metric_name: str, day_bucket: str, increment: int = 1) -> None:
    ANALYTICS_TABLE.update_item(
        Key={"pk": f"METRIC#{metric_name}", "sk": f"DAY#{day_bucket}"},
        UpdateExpression="SET #count = if_not_exists(#count, :zero) + :inc, #updated_at = :updated_at",
        ExpressionAttributeNames={"#count": "count", "#updated_at": "updated_at"},
        ExpressionAttributeValues={
            ":zero": 0,
            ":inc": increment,
            ":updated_at": _now_iso(),
        },
    )


def _metric_daily_count(metric_name: str, target_date: date) -> int:
    resp = ANALYTICS_TABLE.get_item(
        Key={"pk": f"METRIC#{metric_name}", "sk": f"DAY#{target_date.isoformat()}"}
    )
    item = resp.get("Item") or {}
    return int(item.get("count", 0))


def _metric_cumulative_total(metric_name: str, end_date: date) -> int:
    if not isinstance(end_date, date):
        return 0
    return _sum_metric_query(metric_name, end_key=f"DAY#{end_date.isoformat()}")


def _metric_daily_map(metric_name: str, start_date: date, end_date: date) -> Dict[str, int]:
    daily: Dict[str, int] = {}
    query_kwargs: Dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq(f"METRIC#{metric_name}") & Key("sk").between(
            f"DAY#{start_date.isoformat()}",
            f"DAY#{end_date.isoformat()}",
        )
    }
    while True:
        resp = ANALYTICS_TABLE.query(**query_kwargs)
        for item in resp.get("Items", []):
            sk = item.get("sk")
            if isinstance(sk, str) and sk.startswith("DAY#"):
                daily[sk[4:]] = int(item.get("count", 0))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        query_kwargs["ExclusiveStartKey"] = last_key
    return daily


def _sum_metric_query(metric_name: str, *, end_key: str) -> int:
    total = 0
    query_kwargs: Dict[str, Any] = {
        "KeyConditionExpression": Key("pk").eq(f"METRIC#{metric_name}") & Key("sk").lte(end_key),
        "ProjectionExpression": "#count",
        "ExpressionAttributeNames": {"#count": "count"},
    }
    while True:
        resp = ANALYTICS_TABLE.query(**query_kwargs)
        for item in resp.get("Items", []):
            total += int(item.get("count", 0))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        query_kwargs["ExclusiveStartKey"] = last_key
    return total


def _build_cumulative_series(dates: List[date], daily_counts: Dict[str, int], baseline: int) -> List[Dict[str, int | str]]:
    running = baseline
    points: List[Dict[str, int | str]] = []
    for current_date in dates:
        running += daily_counts.get(current_date.isoformat(), 0)
        points.append({"date": current_date.isoformat(), "value": running})
    return points


def _build_daily_series(dates: List[date], daily_counts: Dict[str, int]) -> List[Dict[str, int | str]]:
    return [{"date": current_date.isoformat(), "value": daily_counts.get(current_date.isoformat(), 0)} for current_date in dates]


def _date_range(start_date: date, end_date: date) -> List[date]:
    cursor = start_date
    dates: List[date] = []
    while cursor <= end_date:
        dates.append(cursor)
        cursor += timedelta(days=1)
    return dates


def _parse_days(raw_days: Any) -> int:
    try:
        days = int(raw_days)
    except (TypeError, ValueError):
        days = DEFAULT_ANALYTICS_DAYS
    return max(7, min(days, MAX_ANALYTICS_DAYS))


def _parse_day(raw_date: Any) -> date | None:
    if not isinstance(raw_date, str) or not raw_date.strip():
        return None
    try:
        return date.fromisoformat(raw_date.strip())
    except ValueError:
        return None


def _today_date() -> date:
    return datetime.now(timezone.utc).date()


def _day_bucket(timestamp: str) -> str:
    return timestamp.split("T")[0]


def _ddb_item(item: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    serializer = boto3.dynamodb.types.TypeSerializer()
    return {key: serializer.serialize(value) for key, value in item.items()}


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
    return value if isinstance(value, str) else str(value)


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
