import json
import boto3
import os
from datetime import datetime

dynamo = boto3.resource("dynamodb")
TABLE = dynamo.Table(os.environ["STRATEGIES_TABLE"])
API_TOKEN = os.environ["API_TOKEN"]


def handler(event, context):
    # Simple shared-secret check
    headers = event.get("headers") or {}
    if headers.get("x-api-token") != API_TOKEN:
        return {"statusCode": 401, "body": "Unauthorized"}

    route = event["requestContext"]["routeKey"]

    if route == "GET /strategies":
        return get_strategies()

    if route == "POST /strategies":
        body = json.loads(event.get("body") or "{}")
        return create_strategy(body)

    if route == "GET /strategies/{id}":
        strategy_id = event["pathParameters"]["id"]
        return get_strategy(strategy_id)

    if route == "PATCH /strategies/{id}":
        strategy_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body") or "{}")
        return update_strategy(strategy_id, body)

    return {"statusCode": 404, "body": "Not found"}


def get_strategies():
    resp = TABLE.scan()
    return _json(200, resp.get("Items", []))


def create_strategy(body):
    import uuid

    strategy_id = str(uuid.uuid4())
    item = {
        "id": strategy_id,
        "name": body.get("name", "Untitled Strategy"),
        "entrypoint": body.get("entrypoint", "main.py"),
        "current_version": 1,  # initial version
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }

    TABLE.put_item(Item=item)
    return _json(201, item)


def get_strategy(strategy_id):
    resp = TABLE.get_item(Key={"id": strategy_id})
    item = resp.get("Item")
    if not item:
        return _json(404, {"message": "Not found"})
    return _json(200, item)


def update_strategy(strategy_id, body):
    # This is a simple "full replace"
    item = {"id": strategy_id, **body}
    item["updated_at"] = datetime.utcnow().isoformat()
    TABLE.put_item(Item=item)
    return _json(200, item)


def _json(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }