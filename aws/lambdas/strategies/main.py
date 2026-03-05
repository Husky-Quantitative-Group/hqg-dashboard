import json
import os
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

import boto3
from boto3.dynamodb.types import TypeSerializer
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

dynamo = boto3.resource("dynamodb")
dynamo_client = boto3.client("dynamodb")
s3 = boto3.client("s3")
serializer = TypeSerializer()

STRATEGIES_TABLE = dynamo.Table(os.environ["STRATEGIES_TABLE"])
ARTIFACTS_TABLE = dynamo.Table(os.environ["STRATEGY_ARTIFACTS_TABLE"])
VERSIONS_TABLE = dynamo.Table(os.environ["STRATEGY_ARTIFACT_VERSIONS_TABLE"])
ARTIFACT_BUCKET = os.environ["ARTIFACT_BUCKET"]
READ_PERMISSIONS_TABLE = os.environ["STRATEGIES_READ_PERMISSIONS_TABLE"]
WRITE_PERMISSIONS_TABLE = os.environ["STRATEGIES_WRITE_PERMISSIONS_TABLE"]
READ_PERMISSIONS_DDB = dynamo.Table(READ_PERMISSIONS_TABLE)
STRATEGY_NAME_MAX_CHARS = 60
DESCRIPTION_MAX_CHARS = 75
README_MAX_CHARS = 10_000
TAGS_MAX_COUNT = 5
TAG_MAX_CHARS = 15


def handler(event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    """
    Strategies service Lambda.
    - GET /strategies
    - POST /strategies
    - GET /strategies/{id}
    - PATCH /strategies/{id}
    """
    route_key = (event.get("requestContext") or {}).get("routeKey")

    if route_key == "GET /strategies":
        return get_strategies(event)

    if route_key == "POST /strategies":
        body = json.loads(event.get("body") or "{}")
        return create_strategy(body, event)

    if route_key == "GET /strategies/{id}":
        strategy_id = (event.get("pathParameters") or {}).get("id")
        return get_strategy(strategy_id, event)

    if route_key == "PATCH /strategies/{id}":
        strategy_id = (event.get("pathParameters") or {}).get("id")
        body = json.loads(event.get("body") or "{}")
        return update_strategy(strategy_id, body)

    return {"statusCode": 404, "body": "Not found"}


def get_strategies(event: Dict[str, Any]) -> Dict[str, Any]:
    netid = _get_netid_from_event(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    strategy_ids = _list_readable_strategy_ids(netid)
    if not strategy_ids:
        return _json(200, [])

    keys = [{"id": sid} for sid in strategy_ids]
    items = _batch_get_strategies(keys)

    return _json(200, _clean_decimals(items))


def create_strategy(body: Dict[str, Any], event: Dict[str, Any]) -> Dict[str, Any]:
    """
    Branch from an existing strategy and create a new one.
    Body expects:
      - source_strategy_id (str)
      - name (str, max 60 chars)
      - description (str, optional, max 75 chars)
      - readme_content (str, required; can be empty, max 10k chars)
      - tags (list[str], optional; max 5 tags, max 15 chars each, no duplicates)
    """
    source_id = body.get("source_strategy_id") or body.get("sourceStrategyId")
    if not source_id:
        return _json(400, {"message": "source_strategy_id is required"})

    name_raw = body.get("name", "")
    if not isinstance(name_raw, str):
        return _json(400, {"message": "name must be a string"})
    name = name_raw.strip()
    if not name:
        return _json(400, {"message": "name is required"})
    if len(name) > STRATEGY_NAME_MAX_CHARS:
        return _json(400, {"message": f"name must be {STRATEGY_NAME_MAX_CHARS} characters or fewer"})

    description_raw = body.get("description", "")
    if not isinstance(description_raw, str):
        return _json(400, {"message": "description must be a string"})
    description = description_raw.strip()
    if len(description) > DESCRIPTION_MAX_CHARS:
        return _json(400, {"message": f"description must be {DESCRIPTION_MAX_CHARS} characters or fewer"})

    if "readme_content" not in body:
        return _json(400, {"message": "readme_content is required"})
    readme_content = body.get("readme_content")
    if not isinstance(readme_content, str):
        return _json(400, {"message": "readme_content must be a string"})
    if len(readme_content) > README_MAX_CHARS:
        return _json(400, {"message": f"readme_content must be {README_MAX_CHARS} characters or fewer"})

    tags_raw = body.get("tags", [])
    if tags_raw is None:
        tags_raw = []
    if not isinstance(tags_raw, list):
        return _json(400, {"message": "tags must be a list of strings"})
    if len(tags_raw) > TAGS_MAX_COUNT:
        return _json(400, {"message": f"tags must contain at most {TAGS_MAX_COUNT} items"})

    tags: List[str] = []
    seen_tags = set()
    for tag in tags_raw:
        if not isinstance(tag, str):
            return _json(400, {"message": "each tag must be a string"})
        normalized_tag = tag.strip()
        if not normalized_tag:
            return _json(400, {"message": "tags cannot be empty"})
        if len(normalized_tag) > TAG_MAX_CHARS:
            return _json(400, {"message": f"each tag must be {TAG_MAX_CHARS} characters or fewer"})

        normalized_tag_key = normalized_tag.lower()
        if normalized_tag_key in seen_tags:
            return _json(400, {"message": "duplicate tags are not allowed"})

        seen_tags.add(normalized_tag_key)
        tags.append(normalized_tag)
    netid = _get_netid_from_event(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})
    owner = netid
    owner_display = _get_display_name_from_event(event) or netid

    source = _get_strategy_by_id(source_id)
    if not source:
        return _json(404, {"message": f"Source strategy {source_id} not found"})

    new_strategy_id = str(_count_strategies() + 1)
    new_version = 1
    now = _now()
    entrypoint = source.get("entrypoint", "main.py")

    try:
        _copy_artifacts_from_source(
            source_strategy_id=source_id,
            target_strategy_id=new_strategy_id,
            target_version=new_version,
            readme_content=readme_content,
        )
    except Exception as exc:  # pragma: no cover
        return _json(500, {"message": f"Failed to copy artifacts: {exc}"})

    item = {
        "id": new_strategy_id,
        "name": name,
        "entrypoint": entrypoint,
        "current_version": new_version,
        "created_at": now,
        "updated_at": now,
        "description": description,
        "owner": owner,
        "owner_display": owner_display,
        "tags": tags,
    }

    owner_principal = _principal_for_user(owner)
    try:
        dynamo_client.transact_write_items(
            TransactItems=[
                {
                    "Put": {
                        "TableName": STRATEGIES_TABLE.name,
                        "Item": _ddb_item(item),
                    }
                },
                {
                    "Put": {
                        "TableName": READ_PERMISSIONS_TABLE,
                        "Item": _ddb_item(
                            {"strategy_id": new_strategy_id, "principal": owner_principal}
                        ),
                    }
                },
                {
                    "Put": {
                        "TableName": READ_PERMISSIONS_TABLE,
                        "Item": _ddb_item(
                            {"strategy_id": new_strategy_id, "principal": "ROLE#PUBLIC"}
                        ),
                    }
                },
                {
                    "Put": {
                        "TableName": WRITE_PERMISSIONS_TABLE,
                        "Item": _ddb_item(
                            {"strategy_id": new_strategy_id, "principal": owner_principal}
                        ),
                    }
                },
            ]
        )
    except ClientError as exc:
        return _json(500, {"message": f"Failed to create strategy permissions: {exc}"})

    return _json(201, item)


def get_strategy(strategy_id: Optional[str], event: Dict[str, Any]) -> Dict[str, Any]:
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    netid = _get_netid_from_event(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    if not _has_read_permission(strategy_id, netid):
        return _json(403, {"message": "forbidden"})

    item = _get_strategy_by_id(strategy_id)
    if not item:
        return _json(404, {"message": "Not found"})
    return _json(200, _clean_decimals(item))


def update_strategy(strategy_id: Optional[str], body: Dict[str, Any]) -> Dict[str, Any]:
    if not strategy_id:
        return _json(400, {"message": "strategy id is required"})

    now = _now()
    item = {"id": strategy_id, **body, "updated_at": now}
    STRATEGIES_TABLE.put_item(Item=item)
    return _json(200, item)


# ----------------------------
# Helpers
# ----------------------------

def _copy_artifacts_from_source(
    source_strategy_id: str,
    target_strategy_id: str,
    target_version: int,
    readme_content: str,
) -> None:
    # Get all artifacts for the source strategy.
    resp = ARTIFACTS_TABLE.query(
        KeyConditionExpression=Key("strategy_id").eq(source_strategy_id)
    )
    artifacts = resp.get("Items", [])

    readme_uploaded = False

    for artifact in artifacts:
        artifact_id = artifact["artifact_id"]
        latest_version = artifact.get("latest_version")
        if latest_version is None:
            continue

        pk = f"{source_strategy_id}#{artifact_id}"
        version_resp = VERSIONS_TABLE.query(
            KeyConditionExpression=Key("strategy_artifact_id").eq(pk)
            & Key("strategy_version").eq(latest_version)
        )
        version_item = version_resp.get("Items", [])
        if not version_item:
            raise RuntimeError(f"Missing version record for {artifact_id} v{latest_version}")

        source_s3_key = version_item[0]["s3_key"]
        target_key = f"{target_strategy_id}/v{target_version}/{artifact_id}"

        if artifact_id.lower() == "readme.md":
            readme_uploaded = True
            _put_readme(target_key, readme_content)
        else:
            s3.copy_object(
                Bucket=ARTIFACT_BUCKET,
                CopySource={"Bucket": ARTIFACT_BUCKET, "Key": source_s3_key},
                Key=target_key,
            )

        _write_artifact_metadata(
            strategy_id=target_strategy_id,
            artifact_id=artifact_id,
            version=target_version,
            s3_key=target_key,
        )

    # If no README existed in source, create one.
    if not readme_uploaded:
        target_key = f"{target_strategy_id}/v{target_version}/README.md"
        _put_readme(target_key, readme_content)
        _write_artifact_metadata(
            strategy_id=target_strategy_id,
            artifact_id="README.md",
            version=target_version,
            s3_key=target_key,
        )


def _put_readme(key: str, readme_content: str) -> None:
    s3.put_object(
        Bucket=ARTIFACT_BUCKET,
        Key=key,
        Body=readme_content.encode("utf-8"),
    )


def _write_artifact_metadata(strategy_id: str, artifact_id: str, version: int, s3_key: str) -> None:
    ARTIFACTS_TABLE.put_item(
        Item={
            "strategy_id": strategy_id,
            "artifact_id": artifact_id,
            "latest_version": version,
        }
    )
    VERSIONS_TABLE.put_item(
        Item={
            "strategy_artifact_id": f"{strategy_id}#{artifact_id}",
            "strategy_version": version,
            "s3_key": s3_key,
            "created_at": _now(),
        }
    )


def _count_strategies() -> int:
    count = 0
    scan_kwargs: Dict[str, Any] = {"ProjectionExpression": "id"}
    while True:
        resp = STRATEGIES_TABLE.scan(**scan_kwargs)
        count += resp.get("Count", 0)
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key
    return count


def _get_strategy_by_id(strategy_id: str) -> Optional[Dict[str, Any]]:
    resp = STRATEGIES_TABLE.get_item(Key={"id": strategy_id})
    return resp.get("Item")


def _clean_decimals(data: Any) -> Any:
    if isinstance(data, list):
        return [_clean_decimals(item) for item in data]
    if isinstance(data, dict):
        return {k: _clean_decimals(v) for k, v in data.items()}
    if isinstance(data, Decimal):
        return int(data) if data % 1 == 0 else float(data)
    return data


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


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


def _has_read_permission(strategy_id: str, netid: str) -> bool:
    principal = _principal_for_user(netid)
    resp = READ_PERMISSIONS_DDB.get_item(
        Key={"strategy_id": strategy_id, "principal": principal}
    )
    if "Item" in resp:
        return True
    public_resp = READ_PERMISSIONS_DDB.get_item(
        Key={"strategy_id": strategy_id, "principal": "ROLE#PUBLIC"}
    )
    return "Item" in public_resp


def _list_readable_strategy_ids(netid: str) -> List[str]:
    principals = [_principal_for_user(netid), "ROLE#PUBLIC"]
    strategy_ids: List[str] = []
    seen = set()

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

            resp = READ_PERMISSIONS_DDB.query(**query_kwargs)
            for item in resp.get("Items", []):
                sid = item.get("strategy_id")
                if isinstance(sid, str) and sid not in seen:
                    seen.add(sid)
                    strategy_ids.append(sid)

            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                break

    return strategy_ids


def _chunk(items: List[Dict[str, Any]], size: int) -> List[List[Dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _batch_get_strategies(keys: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if not keys:
        return items

    for batch in _chunk(keys, 100):
        request_items = {STRATEGIES_TABLE.name: {"Keys": batch}}
        while request_items:
            resp = dynamo.batch_get_item(RequestItems=request_items)
            items.extend(resp.get("Responses", {}).get(STRATEGIES_TABLE.name, []))
            request_items = resp.get("UnprocessedKeys") or {}

    return items
  
  
def _get_display_name_from_event(event: Dict[str, Any]) -> Optional[str]:
    request_context = event.get("requestContext") or {}
    authorizer = request_context.get("authorizer") or {}

    display_name = authorizer.get("display_name")
    if not display_name and isinstance(authorizer.get("lambda"), dict):
        display_name = authorizer.get("lambda", {}).get("display_name")

    if not isinstance(display_name, str):
        return None

    display_name = display_name.strip()
    return display_name or None


def _principal_for_user(netid: str) -> str:
    return f"USER#{netid}"


def _ddb_item(item: Dict[str, Any]) -> Dict[str, Any]:
    return {k: serializer.serialize(v) for k, v in item.items()}
