"""Saved strategy histories and immutable, version-pinned execution packages."""

import json
from uuid import uuid4

from boto3.dynamodb.conditions import Key
from validation import MAX_PACKAGE_BYTES, validate_package
from hqg_permissions import has_read_permission

from control import Forbidden, Invalid


class StrategySource:
    def __init__(self, dynamo, s3, env):
        self.s3, self.bucket = s3, env["ARTIFACT_BUCKET"]
        self.strategies = dynamo.Table(env["STRATEGIES_TABLE"])
        self.artifacts = dynamo.Table(env["STRATEGY_ARTIFACTS_TABLE"])
        self.versions = dynamo.Table(env["STRATEGY_ARTIFACT_VERSIONS_TABLE"])
        self.read = dynamo.Table(env["STRATEGIES_READ_PERMISSIONS_TABLE"])
        self.write = dynamo.Table(env["STRATEGIES_WRITE_PERMISSIONS_TABLE"])

    def resolve(self, strategy_id, version, actor, roles):
        if not actor or not has_read_permission(
            strategy_id, actor, roles, self.read, self.write
        ):
            raise Forbidden("Strategy read permission required")
        metadata = self.strategies.get_item(
            Key={"id": strategy_id}, ConsistentRead=True
        ).get("Item")
        if (
            not metadata
            or type(version) is not int
            or not 1 <= version <= int(metadata.get("current_version", 0))
        ):
            raise Invalid("Saved strategy version is not published")

        files, size = {}, 0
        query = dict(
            KeyConditionExpression=Key("strategy_id").eq(strategy_id),
            ConsistentRead=True,
        )
        while True:
            page = self.artifacts.query(**query)
            for artifact in page.get("Items", []):
                path = artifact["artifact_id"]
                history = self.versions.query(
                    KeyConditionExpression=(
                        Key("strategy_artifact_id").eq(f"{strategy_id}#{path}")
                        & Key("strategy_version").lte(version)
                    ),
                    ScanIndexForward=False,
                    Limit=1,
                    ConsistentRead=True,
                ).get("Items", [])
                if not history:
                    if int(artifact["latest_version"]) <= version:
                        raise Invalid("Artifact history is missing")
                    continue  # This file was introduced after the requested version.
                record = history[0]
                args = dict(Bucket=self.bucket, Key=record["s3_key"])
                if record.get("s3_version_id"):
                    args["VersionId"] = record["s3_version_id"]
                obj = self.s3.get_object(**args)
                try:
                    content = obj["Body"].read(MAX_PACKAGE_BYTES + 1)
                finally:
                    obj["Body"].close()
                size += len(content)
                if size > MAX_PACKAGE_BYTES or len(files) >= 32:
                    raise Invalid("Strategy package exceeds limits")
                files[path] = content.decode("utf-8")
            cursor = page.get("LastEvaluatedKey")
            if not cursor:
                break
            query["ExclusiveStartKey"] = cursor

        package = dict(
            strategy_id=strategy_id,
            version=version,
            entrypoint=metadata.get("entrypoint", "main.py"),
            files=files,
        )
        validate_package(package)
        return package

    def snapshot(self, account_id, package):
        identity, _ = validate_package(package)
        key = f"engine-packages/{account_id}/{identity['source_digest'][7:]}/{uuid4()}.json"
        result = self.s3.put_object(
            Bucket=self.bucket,
            Key=key,
            IfNoneMatch="*",
            Body=json.dumps(package, sort_keys=True, separators=(",", ":")).encode(),
            ContentType="application/json",
        )
        version_id = result.get("VersionId")
        if not version_id or version_id == "null":
            raise Invalid("Artifact bucket versioning is required")
        return {"key": key, "version_id": version_id}

    def download(self, reference, source_digest):
        obj = self.s3.get_object(
            Bucket=self.bucket, Key=reference["key"], VersionId=reference["version_id"]
        )
        # Allow JSON escaping (up to 6x) plus artifact paths and metadata.
        limit = MAX_PACKAGE_BYTES * 8
        try:
            raw = obj["Body"].read(limit + 1)
        finally:
            obj["Body"].close()
        if len(raw) > limit:
            raise Invalid("Snapshot exceeds package limits")
        package = json.loads(raw)
        if validate_package(package)[0]["source_digest"] != source_digest:
            raise Invalid("Strategy package digest mismatch")
        return package
