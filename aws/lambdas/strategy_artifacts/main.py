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

# Files that cannot be deleted or renamed
LOCKED_FILES = {"README.md", "main.py", "requirements.txt"}

# Allowed file extensions
ALLOWED_EXTENSIONS = {".py", ".md", ".txt"}

# Invalid filename characters
INVALID_FILENAME_CHARS = {"<", ">", ":", '"', "/", "\\", "|", "?", "*"}

def _validate_filename(filename):
    for char in INVALID_FILENAME_CHARS:
        if char in filename:
            return f'Filename cannot contain: < > : " / \\ | ? *'
    return None

def handler(event, context):
    route = event["requestContext"]["routeKey"]

    if route == "GET /config/file-restrictions":
        return get_file_restrictions()

    if route == "GET /strategies/{id}/artifacts":
        strategy_id = event["pathParameters"]["id"]
        return list_artifacts(strategy_id)

    if route == "POST /strategies/{id}/artifacts":
        strategy_id = event["pathParameters"]["id"]
        body = json.loads(event.get("body") or "{}")
        if "changes" in body:
            return commit_changes(strategy_id, body)
        else:
            return upload_artifacts(strategy_id, body)

    if route == "GET /strategies/{id}/artifacts/{artifactId}":
        strategy_id = event["pathParameters"]["id"]
        artifact_id = event["pathParameters"]["artifactId"]
        return download_artifact(strategy_id, artifact_id)

    if route == "DELETE /strategies/{id}/artifacts/{artifactId}":
        strategy_id = event["pathParameters"]["id"]
        artifact_id = event["pathParameters"]["artifactId"]
        return delete_artifact(strategy_id, artifact_id)

    return {"statusCode": 404, "body": "Not found"}


# ----------------------------
# Configuration endpoints
# ----------------------------

def get_file_restrictions():
    """
    Return the file restrictions configuration (locked files and allowed extensions).
    """
    return _json(200, {
        "lockedFiles": sorted(list(LOCKED_FILES)),
        "allowedExtensions": sorted(list(ALLOWED_EXTENSIONS))
    })


# ----------------------------
# Artifact operations
# ----------------------------

def list_artifacts(strategy_id):
    resp = ARTIFACTS_TABLE.query(
        KeyConditionExpression="strategy_id = :s",
        ExpressionAttributeValues={":s": strategy_id}
    )
    items = resp.get("Items", [])
    artifact_ids = [item.get("artifact_id") for item in items if "artifact_id" in item and not item.get("deleted_at")]
    return _json(200, {"artifacts": artifact_ids})

def download_artifact(strategy_id, artifact_id, max_bytes=1_000_000):
    artifact = ARTIFACTS_TABLE.get_item(Key={"strategy_id": strategy_id, "artifact_id": artifact_id}).get("Item")
    if not artifact:
        return _json(404, {"message": "Artifact not found"})
    
    if artifact.get("deleted_at"):
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

def delete_artifact(strategy_id, artifact_id):
    """
    Soft delete an artifact by marking it with a deleted_at timestamp.
    Preserve version history and S3 objects.
    """
    if artifact_id in LOCKED_FILES:
        return _json(403, {"message": f"Cannot delete locked file: {artifact_id}"})

    artifact = ARTIFACTS_TABLE.get_item(Key={"strategy_id": strategy_id, "artifact_id": artifact_id}).get("Item")
    if not artifact:
        return _json(404, {"message": "Artifact not found"})

    try:
        now = datetime.now(timezone.utc).isoformat()
        ARTIFACTS_TABLE.update_item(
            Key={"strategy_id": strategy_id, "artifact_id": artifact_id},
            UpdateExpression="SET deleted_at = :now",
            ExpressionAttributeValues={":now": now}
        )

        return _json(200, {"ok": True, "message": f"Artifact {artifact_id} deleted"})
    except Exception as exc:
        return _json(500, {"message": f"Failed to delete artifact: {exc}"})

def commit_changes(strategy_id, body):
    """
    Commit multiple file changes in a single version.
    Expected body:
    {
      "changes": [
        { "op": "put", "artifactId": "main.py", "content": "..." },
        { "op": "delete", "artifactId": "old.py" }
      ]
    }
    
    For rename operations, send:
    { "op": "put", "artifactId": "new.py", "content": "..." }  <- new file
    { "op": "delete", "artifactId": "old.py" }  <- old file
    """
    changes = body.get("changes") or []
    
    if not isinstance(changes, list) or not changes:
        return _json(400, {"message": "changes must be a non-empty list"})

    strategy = STRATEGIES_TABLE.get_item(Key={"id": strategy_id}).get("Item")
    if not strategy:
        return _json(404, {"message": "Strategy not found"})
    
    puts = []  
    deletes = [] 
    
    for change in changes:
        op = change.get("op")
        artifact_id = change.get("artifactId")
        
        if not op or not artifact_id:
            return _json(400, {"message": "Each change must include op and artifactId"})
        
        if op not in ["put", "delete"]:
            return _json(400, {"message": f"Invalid operation: {op}. Must be 'put' or 'delete'"})
        
        filename_error = _validate_filename(artifact_id)
        if filename_error:
            return _json(400, {"message": filename_error})
        
        if artifact_id in LOCKED_FILES:
            return _json(403, {"message": f"Cannot modify locked file: {artifact_id}"})
        
        if op == "put":
            content = change.get("content")
            if content is None:
                return _json(400, {"message": f"Content required for put operation on {artifact_id}"})
            if not isinstance(content, str):
                return _json(400, {"message": f"Invalid content for {artifact_id}"})
            
            file_ext = artifact_id[artifact_id.rfind("."):] if "." in artifact_id else ""
            if file_ext.lower() not in ALLOWED_EXTENSIONS:
                return _json(400, {"message": f"File type {file_ext} not allowed. Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}"})
            
            max_file_bytes = 1_000_000
            content_bytes = content.encode("utf-8")
            if len(content_bytes) > max_file_bytes:
                return _json(413, {"message": f"{artifact_id} exceeds max size of 1MB"})
            
            puts.append({"artifact_id": artifact_id, "content_bytes": content_bytes})
        
        elif op == "delete":
            deletes.append(artifact_id)
    
    put_ids = {p["artifact_id"] for p in puts}
    delete_ids = set(deletes)
    conflicts = put_ids & delete_ids
    if conflicts:
        return _json(400, {"message": f"Conflicting operations on: {', '.join(conflicts)}"})
    
    current_version = int(strategy.get("current_version") or 0)
    new_version = current_version + 1
    now = datetime.now(timezone.utc).isoformat()
    
    try:
        for item in puts:
            artifact_id = item["artifact_id"]
            content_bytes = item["content_bytes"]
            
            key = f"{strategy_id}/v{new_version}/{artifact_id}"
            s3.put_object(Bucket=BUCKET, Key=key, Body=content_bytes)
            
            VERSIONS_TABLE.put_item(
                Item={
                    "strategy_artifact_id": f"{strategy_id}#{artifact_id}",
                    "strategy_version": new_version,
                    "s3_key": key,
                    "created_at": now,
                }
            )
            
            existing_artifact = ARTIFACTS_TABLE.get_item(
                Key={"strategy_id": strategy_id, "artifact_id": artifact_id}
            ).get("Item")
            
            if existing_artifact and existing_artifact.get("deleted_at"):
                # Restore deleted artifact
                ARTIFACTS_TABLE.update_item(
                    Key={"strategy_id": strategy_id, "artifact_id": artifact_id},
                    UpdateExpression="SET latest_version = :v REMOVE deleted_at",
                    ExpressionAttributeValues={":v": new_version}
                )
            else:
                ARTIFACTS_TABLE.put_item(
                    Item={
                        "strategy_id": strategy_id,
                        "artifact_id": artifact_id,
                        "latest_version": new_version,
                    }
                )
        
        for artifact_id in deletes:
            artifact = ARTIFACTS_TABLE.get_item(
                Key={"strategy_id": strategy_id, "artifact_id": artifact_id}
            ).get("Item")
            
            if not artifact:
                return _json(404, {"message": f"Artifact not found: {artifact_id}"})
            
            ARTIFACTS_TABLE.update_item(
                Key={"strategy_id": strategy_id, "artifact_id": artifact_id},
                UpdateExpression="SET deleted_at = :now",
                ExpressionAttributeValues={":now": now}
            )
        
        STRATEGIES_TABLE.update_item(
            Key={"id": strategy_id},
            UpdateExpression="SET current_version = :v, updated_at = :u",
            ExpressionAttributeValues={
                ":v": new_version,
                ":u": now,
            },
        )
        
        # Return the new artifact list
        resp = ARTIFACTS_TABLE.query(
            KeyConditionExpression="strategy_id = :s",
            ExpressionAttributeValues={":s": strategy_id}
        )
        items = resp.get("Items", [])
        artifact_ids = [item.get("artifact_id") for item in items if "artifact_id" in item and not item.get("deleted_at")]
        
        return _json(200, {"ok": True, "version": new_version, "artifacts": artifact_ids})
    
    except Exception as exc:
        return _json(500, {"message": f"Failed to commit changes: {exc}"})

def upload_artifacts(strategy_id, body):
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

        # Validate filename characters
        filename_error = _validate_filename(artifact_id)
        if filename_error:
            return _json(400, {"message": filename_error})

        # Validate file extension
        file_ext = artifact_id[artifact_id.rfind("."):] if "." in artifact_id else ""
        if file_ext.lower() not in ALLOWED_EXTENSIONS:
            return _json(400, {"message": f"File type {file_ext} not allowed. Allowed types: {', '.join(sorted(ALLOWED_EXTENSIONS))}"})

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

            existing_artifact = ARTIFACTS_TABLE.get_item(
                Key={"strategy_id": strategy_id, "artifact_id": artifact_id}
            ).get("Item")
            
            if existing_artifact and existing_artifact.get("deleted_at"):
                ARTIFACTS_TABLE.update_item(
                    Key={"strategy_id": strategy_id, "artifact_id": artifact_id},
                    UpdateExpression="SET latest_version = :v REMOVE deleted_at",
                    ExpressionAttributeValues={":v": new_version}
                )
            else:
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
