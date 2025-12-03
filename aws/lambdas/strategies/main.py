import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List

import boto3

dynamo = boto3.resource("dynamodb")
TABLE = dynamo.Table(os.environ["STRATEGIES_TABLE"])
API_TOKEN = os.environ["API_TOKEN"]


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Entry point for the Strategies service Lambda.
    Currently supports:
      - GET /strategies : list all strategies
      - POST /strategies : create a strategy
      - GET /strategies/{id} : fetch one strategy
      - PATCH /strategies/{id} : update strategy
    """
    if not _authorized(event):
        return {"statusCode": 401, "body": "Unauthorized"}

    route_key = (event.get("requestContext") or {}).get("routeKey")

    if route_key == "GET /strategies":
        return get_strategies()

    if route_key == "POST /strategies":
        body = json.loads(event.get("body") or "{}")
        return create_strategy(body)

    if route_key == "GET /strategies/{id}":
        strategy_id = (event.get("pathParameters") or {}).get("id")
        return get_strategy(strategy_id)

    if route_key == "PATCH /strategies/{id}":
        strategy_id = (event.get("pathParameters") or {}).get("id")
        body = json.loads(event.get("body") or "{}")
        return update_strategy(strategy_id, body)

    return {"statusCode": 404, "body": "Not found"}


def get_strategies() -> Dict[str, Any]:
    resp = TABLE.scan()
    items: List[Dict[str, Any]] = resp.get("Items", [])
    return _json(200, _clean_decimals(items))


def create_strategy(body: Dict[str, Any]) -> Dict[str, Any]:
    import uuid

    strategy_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    item = {
        "id": strategy_id,
        "name": body.get("name", "Untitled Strategy"),
        "entrypoint": body.get("entrypoint", "main.py"),
        "current_version": 1,
        "created_at": now,
        "updated_at": now,
    }

    TABLE.put_item(Item=item)
    return _json(201, item)


def get_strategy(strategy_id: str | None) -> Dict[str, Any]:
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    resp = TABLE.get_item(Key={"id": strategy_id})
    item = resp.get("Item")
    if not item:
        return _json(404, {"message": "Not found"})
    return _json(200, _clean_decimals(item))


def update_strategy(strategy_id: str | None, body: Dict[str, Any]) -> Dict[str, Any]:
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    now = datetime.now(timezone.utc).isoformat()
    item = {"id": strategy_id, **body, "updated_at": now}
    TABLE.put_item(Item=item)
    return _json(200, item)


def _authorized(event: Dict[str, Any]) -> bool:
    headers = event.get("headers") or {}
    token = headers.get("x-api-token") or headers.get("x-api-key")
    return token == API_TOKEN


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
