#!/usr/bin/env python3
"""
Seed the storage layer with an initial root strategy.

Creates:
- S3 objects for versioned files (sourced from infra/seed/files).
- DynamoDB items in Strategies, StrategyArtifacts, StrategyArtifactVersions.

Example:
  python seed/main.py \
    --bucket my-dev-strategy-artifacts \
    --strategies-table dev-strategies \
    --artifacts-table dev-strategy-artifacts \
    --artifact-versions-table dev-strategy-artifact-versions \
    --region us-east-1
"""

import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys
from typing import Iterable

import boto3
from botocore.exceptions import BotoCoreError, ClientError


ROOT = Path(__file__).parent
FILES_DIR = ROOT / "files"

STRATEGY_ID = "1"
STRATEGY_NAME = "Buy & Hold SPY"
ENTRYPOINT = "main.py"
VERSION = 1


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_seed_files() -> dict[str, str]:
    files = {}
    for name in ("main.py", "README.md", "requirements.txt"):
        path = FILES_DIR / name
        files[name] = path.read_text(encoding="utf-8")
    return files


def put_objects(
    s3_client,
    bucket: str,
    prefix: str,
    strategy_id: str,
    version: int,
    files: dict[str, str],
) -> dict[str, str]:
    """Upload versioned files; return map of filename -> s3 key."""
    keys: dict[str, str] = {}
    for filename, content in files.items():
        key = f"{prefix}/{strategy_id}/v{version}/{filename}"
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=content.encode("utf-8"),
        )
        keys[filename] = key
        print(f"Uploaded {filename} -> s3://{bucket}/{key}")
    return keys


def seed_tables(
    dynamo,
    strategies_table: str,
    artifacts_table: str,
    versions_table: str,
    s3_keys: dict[str, str],
) -> None:
    now = utcnow_iso()
    strategies = dynamo.Table(strategies_table)
    artifacts = dynamo.Table(artifacts_table)
    versions = dynamo.Table(versions_table)

    strategy_item = {
        "id": STRATEGY_ID,
        "name": STRATEGY_NAME,
        "entrypoint": ENTRYPOINT,
        "current_version": VERSION,
        "created_at": now,
        "updated_at": now,
    }
    strategies.put_item(Item=strategy_item)
    print(f"Upserted strategy {STRATEGY_ID} in {strategies_table}")

    for filename, key in s3_keys.items():
        artifacts.put_item(
            Item={
                "strategy_id": STRATEGY_ID,
                "artifact_id": filename,
                "latest_version": VERSION,
            }
        )
        versions.put_item(
            Item={
                "strategy_artifact_id": f"{STRATEGY_ID}#{filename}",
                "strategy_version": VERSION,
                "s3_key": key,
                "created_at": now,
            }
        )
        print(f"Upserted artifact {filename} and version row for v{VERSION}")


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed initial strategy data.")
    parser.add_argument("--bucket", required=True, help="Artifacts S3 bucket name.")
    parser.add_argument("--prefix", default="strategies", help="S3 key prefix (default: strategies).")
    parser.add_argument("--strategies-table", required=True, help="DynamoDB Strategies table name.")
    parser.add_argument("--artifacts-table", required=True, help="DynamoDB StrategyArtifacts table name.")
    parser.add_argument(
        "--artifact-versions-table",
        required=True,
        help="DynamoDB StrategyArtifactVersions table name.",
    )
    parser.add_argument("--region", default=None, help="AWS region (overrides default resolver).")
    return parser.parse_args(argv)


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    session_kwargs = {}
    if args.region:
        session_kwargs["region_name"] = args.region

    session = boto3.Session(**session_kwargs)
    s3 = session.client("s3")
    dynamo = session.resource("dynamodb")

    try:
        files = load_seed_files()
        keys = put_objects(
            s3_client=s3,
            bucket=args.bucket,
            prefix=args.prefix.rstrip("/"),
            strategy_id=STRATEGY_ID,
            version=VERSION,
            files=files,
        )
        seed_tables(
            dynamo=dynamo,
            strategies_table=args.strategies_table,
            artifacts_table=args.artifacts_table,
            versions_table=args.artifact_versions_table,
            s3_keys=keys,
        )
    except (ClientError, BotoCoreError) as exc:
        print(f"Failed to seed data: {exc}", file=sys.stderr)
        return 1

    print("Seeding complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
