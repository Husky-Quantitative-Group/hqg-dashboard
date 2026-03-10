import json
import boto3
import os
from decimal import Decimal
import base64
from datetime import datetime, timezone

s3 = boto3.client("s3")
dynamo = boto3.resource("dynamodb")

BUCKET = os.environ["ARTIFACT_BUCKET"]
ARTIFACTS_TABLE = dynamo.Table(os.environ["STRATEGY_ARTIFACTS_TABLE"])
STRATEGIES_TABLE = dynamo.Table(os.environ["STRATEGIES_TABLE"])
VERSIONS_TABLE = dynamo.Table(os.environ["STRATEGY_ARTIFACT_VERSIONS_TABLE"])
WRITE_PERMISSIONS_TABLE = dynamo.Table(os.environ["STRATEGIES_WRITE_PERMISSIONS_TABLE"])
def handler(event, context):
    route = event["requestContext"]["routeKey"]

    if route == "GET /strategies/{id}/artifacts":
        strategy_id = event["pathParameters"]["id"]
        return list_artifacts(strategy_id)

    if route == "POST /strategies/{id}/artifacts":
        strategy_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body") or "{}")
        return upload_artifacts(strategy_id, body, event)

    if route == "GET /strategies/{id}/permissions/write":
        strategy_id = event["pathParameters"]["id"]
        return get_write_permission(strategy_id, event)

    if route == "GET /strategies/{id}/artifacts/{artifactId}":
        strategy_id = event["pathParameters"]["id"]
        artifact_id = event["pathParameters"]["artifactId"]
        return download_artifact(strategy_id, artifact_id)

    return {"statusCode": 404, "body": "Not found"}


# ----------------------------
# Artifact operations
# ----------------------------

def list_artifacts(strategy_id):
    resp = ARTIFACTS_TABLE.query(
        KeyConditionExpression="strategy_id = :s",
        ExpressionAttributeValues={":s": strategy_id}
    )
    items = resp.get("Items", [])
    artifact_ids = [item.get("artifact_id") for item in items if "artifact_id" in item]
    return _json(200, {"artifacts": artifact_ids})

def download_artifact(strategy_id, artifact_id, max_bytes=1_000_000):
    artifact = ARTIFACTS_TABLE.get_item(Key={"strategy_id": strategy_id, "artifact_id": artifact_id}).get("Item")
    if not artifact:
        return _json(404, {"message": "Artifact not found"})

    latest_version = artifact.get("latest_version")
    if latest_version is None:
        return _json(404, {"message": "No versions available for artifact"})

    pk = f"{strategy_id}#{artifact_id}"
    version_resp = VERSIONS_TABLE.get_item(Key={"strategy_artifact_id": pk, "strategy_version": latest_version})
    version_item = version_resp.get("Item")
    if not version_item:
        return _json(404, {"message": "Artifact version not found"})

    key = version_item["s3_key"]
    try:
        obj = s3.get_object(Bucket=BUCKET, Key=key)
    except Exception:
        return _json(404, {"message": "Object not found"})

    size = obj.get("ContentLength", 0)
    if size and size > max_bytes:
        return _json(413, {"message": "Artifact too large"})

    body = obj["Body"].read()

    content_type = obj.get("ContentType") or "application/octet-stream"

    return {
        "statusCode": 200,
        "isBase64Encoded": True,
        "headers": {
            "Content-Type": content_type,
            "Content-Disposition": f'attachment; filename="{artifact_id}"',
        },
        "body": base64.b64encode(body).decode("utf-8"),
    }

def upload_artifacts(strategy_id, body, event):
    """
    New upload flow: accept all files + contents in a single request.
    Expected body:
    {
      "files": [
        { "artifactId": "main.py", "content": "<raw text or base64>" },
        ...
      ]
    }
    """
    files = body.get("files") or []

    if not isinstance(files, list) or not files:
        return _json(400, {"message": "files must be a non-empty list"})

    netid = _get_netid_from_event(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    roles = _get_roles_from_event(event)
    if not _has_write_permission(strategy_id, netid, roles):
        return _json(403, {"message": "forbidden"})

    strategy = STRATEGIES_TABLE.get_item(Key={"id": strategy_id}).get("Item")
    if not strategy:
        return _json(404, {"message": "Strategy not found"})
    
    current_version = int(strategy.get("current_version") or 0)
    new_version = current_version + 1
    now = datetime.now(timezone.utc).isoformat()

    # Input validation
    max_file_bytes = 1_000_000  # 1 MB per file
    prepared_files = []
    for f in files:
        artifact_id = f.get("artifactId")
        content = f.get("content")
        # Input validation
        if not artifact_id or content is None:
            return _json(400, {"message": "Each file must include artifactId and content"})
        if not isinstance(content, str):
            return _json(400, {"message": f"Invalid content for {artifact_id}"})

        content_bytes = content.encode("utf-8")
        size_bytes = len(content_bytes)
        if size_bytes > max_file_bytes:
            return _json(413, {"message": f"{artifact_id} exceeds max size of 1MB"})

        prepared_files.append({"artifact_id": artifact_id, "content_bytes": content_bytes})
    
    uploaded = []
    try:
        for item in prepared_files:
            artifact_id = item["artifact_id"]
            content_bytes = item["content_bytes"]

            key = f"{strategy_id}/v{new_version}/{artifact_id}"
            s3.put_object(Bucket=BUCKET, Key=key, Body=content_bytes)
            uploaded.append(key)

            VERSIONS_TABLE.put_item(
                Item={
                    "strategy_artifact_id": f"{strategy_id}#{artifact_id}",
                    "strategy_version": new_version,
                    "s3_key": key,
                    "created_at": now,
                }
            )

            ARTIFACTS_TABLE.put_item(
                Item={
                    "strategy_id": strategy_id,
                    "artifact_id": artifact_id,
                    "latest_version": new_version,
                }
            )

        STRATEGIES_TABLE.update_item(
            Key={"id": strategy_id},
            UpdateExpression="SET current_version = :v, updated_at = :u",
            ExpressionAttributeValues={
                ":v": new_version,
                ":u": now,
            },
        )
    except Exception as exc:
        return _json(500, {"message": f"Failed to upload artifacts: {exc}"})

    return _json(200, {"ok": True, "version": new_version, "artifacts": [f.get("artifactId") for f in files]})

def get_write_permission(strategy_id, event):
    netid = _get_netid_from_event(event)
    if not netid:
        return _json(401, {"message": "unauthorized"})

    roles = _get_roles_from_event(event)
    can_write = _has_write_permission(strategy_id, netid, roles)
    return _json(200, {"canWrite": can_write})

def _clean_decimals(data):
    if isinstance(data, list):
        return [_clean_decimals(item) for item in data]
    if isinstance(data, dict):
        return {k: _clean_decimals(v) for k, v in data.items()}
    if isinstance(data, Decimal):
        return int(data) if data % 1 == 0 else float(data)
    return data


def _json(code, body):
    return {
        "statusCode": code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body),
    }


def _get_netid_from_event(event):
    request_context = event.get("requestContext") or {}
    authorizer = request_context.get("authorizer") or {}

    netid = authorizer.get("netid")
    if not netid and isinstance(authorizer.get("lambda"), dict):
        netid = authorizer.get("lambda", {}).get("netid")

    if not isinstance(netid, str):
        return None

    netid = netid.strip()
    return netid or None


def _has_write_permission(strategy_id, netid, roles):
    if "ADMIN" in roles:
        return True
    principal = f"USER#{netid}"
    resp = WRITE_PERMISSIONS_TABLE.get_item(
        Key={"strategy_id": strategy_id, "principal": principal}
    )
    if "Item" in resp:
        return True
    public_resp = WRITE_PERMISSIONS_TABLE.get_item(
        Key={"strategy_id": strategy_id, "principal": "ROLE#PUBLIC"}
    )
    if "Item" in public_resp:
        return True
    if "FUND" in roles:
        fund_resp = WRITE_PERMISSIONS_TABLE.get_item(
            Key={"strategy_id": strategy_id, "principal": "ROLE#FUND"}
        )
        return "Item" in fund_resp
    return False


def _get_roles_from_event(event):
    request_context = event.get("requestContext") or {}
    authorizer = request_context.get("authorizer") or {}

    roles_raw = authorizer.get("roles")
    if not roles_raw and isinstance(authorizer.get("lambda"), dict):
        roles_raw = authorizer.get("lambda", {}).get("roles")

    if isinstance(roles_raw, str):
        try:
            roles = json.loads(roles_raw)
        except json.JSONDecodeError:
            roles = []
    elif isinstance(roles_raw, list):
        roles = roles_raw
    else:
        roles = []

    return [str(role) for role in roles if isinstance(role, (str, int))]
