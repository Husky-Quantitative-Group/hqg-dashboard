#!/usr/bin/env python3
"""
Seed the storage layer with initial strategies.

Creates:
- S3 objects for versioned files (sourced from infra/seed/strategies/<id>).
- DynamoDB items in Strategies, StrategyArtifacts, StrategyArtifactVersions.
- Gzipped backtest payloads in the backtests bucket.
- DynamoDB items in BacktestMetrics.
Optional:
- DynamoDB item in Users to grant an admin role.

Example:
    python3 seed/main.py \
    --bucket "$(terraform output -raw artifacts_bucket_name)" \
    --backtests-bucket "$(terraform output -raw backtests_bucket_name)" \
    --strategies-table "$(terraform output -raw strategies_table_name)" \
    --artifacts-table "$(terraform output -raw strategy_artifacts_table_name)" \
    --artifact-versions-table "$(terraform output -raw strategy_artifact_versions_table_name)" \
    --backtest-metrics-table "$(terraform output -raw backtest_metrics_table_name)" \
    --users-table "$(terraform output -raw users_table_name)" \
    --admin-netid "YOUR_NETID" \
    --region us-east-1
"""

import argparse
import gzip
import json
import math
import secrets
import time
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
import sys
from typing import Any, Iterable

import boto3
from boto3.dynamodb.conditions import Attr, Key
from botocore.exceptions import BotoCoreError, ClientError


ROOT = Path(__file__).parent
STRATEGIES_DIR = ROOT / "strategies"
STRATEGIES_JSON = ROOT / "strategies.json"
VERSION = 1
SEED_STRATEGY_IDS = tuple(str(i) for i in range(1, 6))
_CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"


def utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def encode_crockford(value: int, length: int) -> str:
    chars = []
    for _ in range(length):
        chars.append(_CROCKFORD_BASE32[value & 31])
        value >>= 5
    return "".join(reversed(chars))


def ulid() -> str:
    ts_ms = int(time.time() * 1000)
    ts_str = encode_crockford(ts_ms, 10)
    rand_str = encode_crockford(secrets.randbits(80), 16)
    return ts_str + rand_str


def to_decimal(value: object) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return Decimal(value)
    if isinstance(value, float):
        if value != value:
            return None
        return Decimal(str(value))
    return None


def clean_numbers(data: object) -> object:
    if isinstance(data, list):
        return [clean_numbers(item) for item in data]
    if isinstance(data, dict):
        return {k: clean_numbers(v) for k, v in data.items()}
    dec = to_decimal(data)
    if dec is not None:
        return dec
    return data


def finite_number_or_none(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if math.isfinite(number):
            return number
    return None


def normalize_date_value(value: object) -> str:
    if not isinstance(value, str):
        return ""
    return value.split("T")[0].strip()


def first_non_empty_string(*values: object) -> str:
    for value in values:
        if isinstance(value, str):
            trimmed = value.strip()
            if trimmed:
                return trimmed
    return ""


def first_finite_number(*values: object) -> float | None:
    for value in values:
        number = finite_number_or_none(value)
        if number is not None:
            return number
    return None


def generate_backtest_name(existing_runs_count: int) -> str:
    if not isinstance(existing_runs_count, int) or existing_runs_count < 0:
        existing_runs_count = 0

    return f"Backtest {existing_runs_count + 1}"


def load_strategies() -> list[dict[str, object]]:
    raw = STRATEGIES_JSON.read_text(encoding="utf-8")
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("strategies.json must be a list of strategy objects")
    return data


def load_strategy_files(strategy_id: str, filenames: Iterable[str]) -> dict[str, str]:
    base_dir = STRATEGIES_DIR / strategy_id
    files: dict[str, str] = {}
    for name in filenames:
        path = base_dir / name
        files[name] = path.read_text(encoding="utf-8")
    return files


def put_objects(
    s3_client,
    bucket: str,
    strategy_id: str,
    version: int,
    files: dict[str, str],
) -> dict[str, str]:
    """Upload versioned files; return map of filename -> s3 key."""
    keys: dict[str, str] = {}
    for filename, content in files.items():
        key = f"{strategy_id}/v{version}/{filename}"
        s3_client.put_object(
            Bucket=bucket,
            Key=key,
            Body=content.encode("utf-8"),
        )
        keys[filename] = key
        print(f"Uploaded {filename} -> s3://{bucket}/{key}")
    return keys


def load_backtest_payload(strategy_id: str, filename: str) -> dict[str, object]:
    path = STRATEGIES_DIR / strategy_id / filename
    raw = path.read_text(encoding="utf-8")
    if not raw.strip():
        return {}

    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError(f"Backtest file {path} must contain a JSON object")
    return parsed


def _delete_s3_prefix(s3_client, bucket: str, prefix: str) -> int:
    paginator = s3_client.get_paginator("list_objects_v2")
    keys: list[str] = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        keys.extend(obj["Key"] for obj in page.get("Contents", []) if "Key" in obj)

    deleted = 0
    for i in range(0, len(keys), 1000):
        batch = keys[i : i + 1000]
        delete_response = s3_client.delete_objects(
            Bucket=bucket,
            Delete={
                "Objects": [{"Key": key} for key in batch],
                "Quiet": True,
            },
        )
        errors = delete_response.get("Errors", [])
        if errors:
            raise ValueError(f"Failed deleting s3://{bucket}/{prefix}: {errors}")
        deleted += len(batch)

    print(f"Deleted {deleted} objects from s3://{bucket}/{prefix}")
    return deleted


def _delete_items_for_strategy(table, strategy_id: str, sort_key_name: str) -> int:
    deleted = 0
    last_evaluated_key = None
    with table.batch_writer() as batch:
        while True:
            query_kwargs = {
                "KeyConditionExpression": Key("strategy_id").eq(strategy_id),
                "ProjectionExpression": f"strategy_id, {sort_key_name}",
            }
            if last_evaluated_key:
                query_kwargs["ExclusiveStartKey"] = last_evaluated_key

            response = table.query(**query_kwargs)
            for item in response.get("Items", []):
                batch.delete_item(Key={"strategy_id": strategy_id, sort_key_name: item[sort_key_name]})
                deleted += 1

            last_evaluated_key = response.get("LastEvaluatedKey")
            if not last_evaluated_key:
                break
    return deleted


def purge_seed_strategies(
    s3_client,
    dynamo,
    bucket: str,
    backtests_bucket: str,
    strategies_table: str,
    artifacts_table: str,
    versions_table: str,
    backtest_metrics_table: str,
) -> None:
    print(f"Purging existing strategy data for IDs: {', '.join(SEED_STRATEGY_IDS)}")

    for strategy_id in SEED_STRATEGY_IDS:
        _delete_s3_prefix(s3_client=s3_client, bucket=bucket, prefix=f"{strategy_id}/")
        _delete_s3_prefix(
            s3_client=s3_client,
            bucket=backtests_bucket,
            prefix=f"strategies/{strategy_id}/",
        )

    artifacts = dynamo.Table(artifacts_table)
    for strategy_id in SEED_STRATEGY_IDS:
        deleted = _delete_items_for_strategy(
            table=artifacts,
            strategy_id=strategy_id,
            sort_key_name="artifact_id",
        )
        print(f"Deleted {deleted} rows for strategy {strategy_id} from {artifacts_table}")

    backtests = dynamo.Table(backtest_metrics_table)
    for strategy_id in SEED_STRATEGY_IDS:
        deleted = _delete_items_for_strategy(
            table=backtests,
            strategy_id=strategy_id,
            sort_key_name="run_id",
        )
        print(f"Deleted {deleted} rows for strategy {strategy_id} from {backtest_metrics_table}")

    versions = dynamo.Table(versions_table)
    version_filter = None
    for strategy_id in SEED_STRATEGY_IDS:
        term = Attr("strategy_artifact_id").begins_with(f"{strategy_id}#")
        version_filter = term if version_filter is None else (version_filter | term)

    deleted_versions = 0
    last_evaluated_key = None
    with versions.batch_writer() as batch:
        while True:
            scan_kwargs = {
                "ProjectionExpression": "strategy_artifact_id, strategy_version",
                "FilterExpression": version_filter,
            }
            if last_evaluated_key:
                scan_kwargs["ExclusiveStartKey"] = last_evaluated_key

            response = versions.scan(**scan_kwargs)
            for item in response.get("Items", []):
                batch.delete_item(
                    Key={
                        "strategy_artifact_id": item["strategy_artifact_id"],
                        "strategy_version": item["strategy_version"],
                    }
                )
                deleted_versions += 1

            last_evaluated_key = response.get("LastEvaluatedKey")
            if not last_evaluated_key:
                break
    print(f"Deleted {deleted_versions} rows from {versions_table}")

    strategies = dynamo.Table(strategies_table)
    for strategy_id in SEED_STRATEGY_IDS:
        strategies.delete_item(Key={"id": strategy_id})
        print(f"Deleted strategy {strategy_id} from {strategies_table}")


def seed_backtests(
    s3_client,
    dynamo,
    backtests_bucket: str,
    backtest_metrics_table: str,
    strategy_id: str,
    owner: str,
    backtests: list[dict[str, object]],
) -> None:
    table = dynamo.Table(backtest_metrics_table)

    for backtest_index, backtest in enumerate(backtests):
        file_value = backtest.get("file")
        file_name = str(file_value).strip() if file_value is not None else ""
        if not file_name:
            raise ValueError(f"Strategy {strategy_id} backtest entry missing file")

        run_id_value = backtest.get("run_id")
        run_id = str(run_id_value).strip() if run_id_value is not None else ""
        if not run_id:
            run_id = ulid()

        s3_key = f"strategies/{strategy_id}/runs/{run_id}/run.json.gz"
        payload = load_backtest_payload(strategy_id=strategy_id, filename=file_name)
        compressed = gzip.compress(json.dumps(payload).encode("utf-8"))

        s3_client.put_object(
            Bucket=backtests_bucket,
            Key=s3_key,
            Body=compressed,
            ContentType="application/gzip",
        )
        print(f"Uploaded {file_name} -> s3://{backtests_bucket}/{s3_key}")

        time_created_value = backtest.get("time_created")
        time_created = str(time_created_value).strip() if time_created_value is not None else ""
        if not time_created:
            time_created = utcnow_iso()

        user_value = backtest.get("user")
        user = str(user_value).strip() if user_value is not None else ""
        if not user:
            user = owner

        name_value = backtest.get("name")
        name = str(name_value).strip() if name_value is not None else ""
        if not name:
            name = generate_backtest_name(backtest_index)

        strategy_version = backtest.get("strategy_version")
        if strategy_version in (None, ""):
            strategy_version = VERSION

        params_value = backtest.get("backtest_params")
        params = params_value if isinstance(params_value, dict) else {}
        payload_params = payload.get("parameters") if isinstance(payload, dict) else {}
        if not isinstance(payload_params, dict):
            payload_params = {}

        payload_metrics = payload.get("metrics") if isinstance(payload, dict) else {}
        if not isinstance(payload_metrics, dict):
            payload_metrics = {}

        payload_equity_stats = payload.get("equity_stats") if isinstance(payload, dict) else {}
        if not isinstance(payload_equity_stats, dict):
            payload_equity_stats = {}

        payload_orders = payload.get("orders") if isinstance(payload, dict) else []
        if not isinstance(payload_orders, list):
            payload_orders = []

        start_date = normalize_date_value(
            first_non_empty_string(params.get("start_date"), payload_params.get("start_date"))
        )
        end_date = normalize_date_value(
            first_non_empty_string(params.get("end_date"), payload_params.get("end_date"))
        )
        initial_capital = first_finite_number(params.get("initial_capital"), payload_params.get("starting_equity"))

        metrics_value = backtest.get("metrics")
        if not isinstance(metrics_value, dict) or not metrics_value:
            metrics_value = payload_metrics

        net_pnl = first_finite_number(
            backtest.get("net_pnl"),
            payload_equity_stats.get("net_profit"),
        )
        if net_pnl is None:
            final_equity = finite_number_or_none(payload_equity_stats.get("equity"))
            if final_equity is not None and initial_capital is not None:
                net_pnl = final_equity - initial_capital

        sharpe = first_finite_number(
            backtest.get("sharpe"),
            metrics_value.get("sharpe_ratio") if isinstance(metrics_value, dict) else None,
        )
        win_rate = first_finite_number(
            backtest.get("win_rate"),
            metrics_value.get("win_rate") if isinstance(metrics_value, dict) else None,
        )
        max_drawdown = first_finite_number(
            backtest.get("max_drawdown"),
            metrics_value.get("max_drawdown") if isinstance(metrics_value, dict) else None,
        )
        trades_count = first_finite_number(
            backtest.get("trades_count"),
            metrics_value.get("total_orders") if isinstance(metrics_value, dict) else None,
            len(payload_orders),
        )

        item: dict[str, object] = {
            "strategy_id": strategy_id,
            "run_id": run_id,
            "name": name,
            "time_created": time_created,
            "user": user,
            "strategy_version": strategy_version,
            "backtest_params": {
                "name": name,
                "start_date": start_date,
                "end_date": end_date,
                "initial_capital": initial_capital,
            },
            "metrics": metrics_value,
            "net_pnl": net_pnl,
            "sharpe": sharpe,
            "win_rate": win_rate,
            "max_drawdown": max_drawdown,
            "trades_count": trades_count,
            "s3_bucket": backtests_bucket,
            "s3_key": s3_key,
        }

        item = clean_numbers(item)  # DynamoDB requires Decimal for numeric values.
        table.put_item(Item=item)
        print(f"Upserted backtest run {run_id} for strategy {strategy_id} in {backtest_metrics_table}")


def seed_tables(
    dynamo,
    strategies_table: str,
    artifacts_table: str,
    versions_table: str,
    strategy_id: str,
    strategy_name: str,
    entrypoint: str,
    owner: str,
    owner_display: str,
    s3_keys: dict[str, str],
) -> None:
    now = utcnow_iso()
    strategies = dynamo.Table(strategies_table)
    artifacts = dynamo.Table(artifacts_table)
    versions = dynamo.Table(versions_table)

    strategy_item = {
        "id": strategy_id,
        "name": strategy_name,
        "owner": owner,
        "owner_display": owner_display,
        "entrypoint": entrypoint,
        "current_version": VERSION,
        "created_at": now,
        "updated_at": now,
    }
    strategies.put_item(Item=strategy_item)
    print(f"Upserted strategy {strategy_id} in {strategies_table}")

    for filename, key in s3_keys.items():
        artifacts.put_item(
            Item={
                "strategy_id": strategy_id,
                "artifact_id": filename,
                "latest_version": VERSION,
            }
        )
        versions.put_item(
            Item={
                "strategy_artifact_id": f"{strategy_id}#{filename}",
                "strategy_version": VERSION,
                "s3_key": key,
                "created_at": now,
            }
        )
        print(f"Upserted artifact {filename} and version row for v{VERSION}")


def seed_strategies(
    s3_client,
    dynamo,
    bucket: str,
    backtests_bucket: str,
    strategies_table: str,
    artifacts_table: str,
    versions_table: str,
    backtest_metrics_table: str,
) -> None:
    strategies = load_strategies()
    for entry in strategies:
        if not isinstance(entry, dict):
            raise ValueError("Each strategy entry must be an object")

        strategy_id = str(entry.get("id", "")).strip()
        if not strategy_id:
            raise ValueError("Strategy entry missing id")

        entrypoint = str(entry.get("entrypoint", "")).strip()
        if not entrypoint:
            raise ValueError(f"Strategy {strategy_id} missing entrypoint")

        title_value = entry.get("title")
        strategy_name = str(title_value).strip() if title_value is not None else ""
        if not strategy_name:
            strategy_name = f"Strategy {strategy_id}"

        owner_value = entry.get("owner")
        owner = str(owner_value).strip() if owner_value else ""
        if not owner:
            raise ValueError(f"Strategy {strategy_id} missing owner")

        owner_display_value = entry.get("owner_display")
        owner_display = str(owner_display_value).strip() if owner_display_value else ""
        if not owner_display:
            raise ValueError(f"Strategy {strategy_id} missing owner_display")

        files_value = entry.get("files")
        if not isinstance(files_value, list) or not files_value:
            raise ValueError(f"Strategy {strategy_id} missing files list")
        filenames = [str(name) for name in files_value]

        backtests_value = entry.get("backtests")
        if backtests_value is None:
            backtests: list[dict[str, object]] = []
        elif isinstance(backtests_value, list):
            backtests = []
            for idx, item in enumerate(backtests_value):
                if not isinstance(item, dict):
                    raise ValueError(f"Strategy {strategy_id} backtests[{idx}] must be an object")
                backtests.append(item)
        else:
            raise ValueError(f"Strategy {strategy_id} backtests must be a list")

        files = load_strategy_files(strategy_id=strategy_id, filenames=filenames)
        keys = put_objects(
            s3_client=s3_client,
            bucket=bucket,
            strategy_id=strategy_id,
            version=VERSION,
            files=files,
        )
        seed_tables(
            dynamo=dynamo,
            strategies_table=strategies_table,
            artifacts_table=artifacts_table,
            versions_table=versions_table,
            strategy_id=strategy_id,
            strategy_name=strategy_name,
            entrypoint=entrypoint,
            owner=owner,
            owner_display=owner_display,
            s3_keys=keys,
        )
        if backtests:
            seed_backtests(
                s3_client=s3_client,
                dynamo=dynamo,
                backtests_bucket=backtests_bucket,
                backtest_metrics_table=backtest_metrics_table,
                strategy_id=strategy_id,
                owner=owner,
                backtests=backtests,
            )


def seed_admin_user(dynamo, users_table: str, netid: str) -> None:
    now = utcnow_iso()
    users = dynamo.Table(users_table)
    users.put_item(
        Item={
            "netid": netid,
            "roles": ["ADMIN"],
            "is_banned": False,
            "created_at": now,
            "updated_at": now,
            "joined_at": now,
        }
    )
    print(f"Upserted admin user {netid} in {users_table}")


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed initial strategy data.")
    parser.add_argument("--bucket", required=True, help="Artifacts S3 bucket name.")
    parser.add_argument("--backtests-bucket", required=True, help="Backtests S3 bucket name.")
    parser.add_argument("--strategies-table", required=True, help="DynamoDB Strategies table name.")
    parser.add_argument("--artifacts-table", required=True, help="DynamoDB StrategyArtifacts table name.")
    parser.add_argument(
        "--artifact-versions-table",
        required=True,
        help="DynamoDB StrategyArtifactVersions table name.",
    )
    parser.add_argument(
        "--backtest-metrics-table",
        required=True,
        help="DynamoDB BacktestMetrics table name.",
    )
    parser.add_argument("--users-table", default=None, help="DynamoDB Users table name.")
    parser.add_argument("--admin-netid", default=None, help="NetID to seed as an admin user.")
    parser.add_argument("--region", default=None, help="AWS region (overrides default resolver).")
    args = parser.parse_args(argv)
    if args.admin_netid and not args.users_table:
        parser.error("--users-table is required when --admin-netid is set.")
    return args


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    session_kwargs = {}
    if args.region:
        session_kwargs["region_name"] = args.region

    session = boto3.Session(**session_kwargs)
    s3 = session.client("s3")
    dynamo = session.resource("dynamodb")

    try:
        purge_seed_strategies(
            s3_client=s3,
            dynamo=dynamo,
            bucket=args.bucket,
            backtests_bucket=args.backtests_bucket,
            strategies_table=args.strategies_table,
            artifacts_table=args.artifacts_table,
            versions_table=args.artifact_versions_table,
            backtest_metrics_table=args.backtest_metrics_table,
        )
        seed_strategies(
            s3_client=s3,
            dynamo=dynamo,
            bucket=args.bucket,
            backtests_bucket=args.backtests_bucket,
            strategies_table=args.strategies_table,
            artifacts_table=args.artifacts_table,
            versions_table=args.artifact_versions_table,
            backtest_metrics_table=args.backtest_metrics_table,
        )
        admin_netid = args.admin_netid.strip() if args.admin_netid else None
        if admin_netid and args.users_table:
            seed_admin_user(dynamo=dynamo, users_table=args.users_table, netid=admin_netid)
    except (ClientError, BotoCoreError, ValueError, OSError) as exc:
        print(f"Failed to seed data: {exc}", file=sys.stderr)
        return 1

    print("Seeding complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
