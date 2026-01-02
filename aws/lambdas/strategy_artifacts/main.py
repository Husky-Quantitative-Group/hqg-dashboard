import json
import boto3
import os
from decimal import Decimal

s3 = boto3.client("s3")
dynamo = boto3.resource("dynamodb")

BUCKET = os.environ["ARTIFACT_BUCKET"]
ARTIFACTS_TABLE = dynamo.Table(os.environ["STRATEGY_ARTIFACTS_TABLE"])
STRATEGIES_TABLE = dynamo.Table(os.environ["STRATEGIES_TABLE"])
VERSIONS_TABLE = dynamo.Table(os.environ["STRATEGY_ARTIFACT_VERSIONS_TABLE"])
API_TOKEN = os.environ["API_TOKEN"]


def handler(event, context):
    # Simple shared-secret auth
    if not _authorized(event):
        return {"statusCode": 401, "body": "Unauthorized"}

    route = event["requestContext"]["routeKey"]

    if route == "GET /strategies/{id}/artifacts":
        strategy_id = event["pathParameters"]["id"]
        return list_artifacts(strategy_id)

    if route == "POST /strategies/{id}/artifacts/uploads":
        strategy_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body") or "{}")
        return create_upload_urls(strategy_id, body.get("files", []))

    if route == "POST /strategies/{id}/artifacts/complete":
        strategy_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body") or "{}")
        return complete_upload(strategy_id, body.get("artifactIds", []))

    if route == "GET /strategies/{id}/artifacts/{artifactId}":
        strategy_id = event["pathParameters"]["id"]
        artifact_id = event["pathParameters"]["artifactId"]
        return get_download_url(strategy_id, artifact_id)

    if route == "PUT /strategies/{id}/artifacts/{artifactId}":
        strategy_id = event["pathParameters"]["id"]
        artifact_id = event["pathParameters"]["artifactId"]
        return update_single_artifact(strategy_id, artifact_id)

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


def create_upload_urls(strategy_id, files):
    """
    files = [
      { "artifactId": "main.py" },
      { "artifactId": "config.yaml" }
    ]
    """
    uploads = []

    # Fetch current strategy_version once
    strategy = STRATEGIES_TABLE.get_item(Key={"id": strategy_id}).get("Item", {})
    version = strategy.get("current_version", 1)

    for f in files:
        filename = f["artifactId"]
        key = f"{strategy_id}/v{version}/{filename}"

        url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": BUCKET, "Key": key},
            ExpiresIn=300,
        )

        uploads.append({"artifactId": filename, "uploadUrl": url})

    return _json(200, {"version": version, "uploads": uploads})


def complete_upload(strategy_id, artifact_ids):
    # REAL VERSIONING LOGIC WILL GO HERE
    # For now: no-op
    return _json(200, {"ok": True})


def get_download_url(strategy_id, artifact_id):
    # In the "non-versioned" stage, always serve latest
    key = f"{strategy_id}/latest/{artifact_id}"

    url = s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=300,
    )

    return _json(200, {"downloadUrl": url})


def update_single_artifact(strategy_id, artifact_id):
    # Same logic as upload URLs but only one file
    strategy = STRATEGIES_TABLE.get_item(Key={"id": strategy_id}).get("Item", {})
    version = strategy.get("current_version", 1)

    key = f"{strategy_id}/v{version}/{artifact_id}"
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": BUCKET, "Key": key},
        ExpiresIn=300
    )

    return _json(200, {"artifactId": artifact_id, "uploadUrl": url})


def _authorized(event):
    headers = event.get("headers") or {}
    token = headers.get("x-api-token") or headers.get("x-api-key")
    return token == API_TOKEN


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
