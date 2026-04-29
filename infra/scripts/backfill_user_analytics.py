#!/usr/bin/env python3
import argparse
from collections import defaultdict
from typing import Any, Iterable

import boto3


USERS_JOINED_METRIC = "users_joined"
STRATEGIES_CREATED_METRIC = "strategies_created"
BACKTESTS_CREATED_METRIC = "backtests_created"


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill analytics rollups.")
    parser.add_argument("--users-table", required=True, help="DynamoDB Users table name.")
    parser.add_argument("--strategies-table", required=True, help="DynamoDB Strategies table name.")
    parser.add_argument("--backtests-table", required=True, help="DynamoDB StrategyBacktests table name.")
    parser.add_argument(
        "--artifact-versions-table",
        required=True,
        help="DynamoDB StrategyArtifactVersions table name.",
    )
    parser.add_argument("--analytics-table", required=True, help="DynamoDB Analytics table name.")
    parser.add_argument("--region", default=None, help="AWS region (overrides default resolver).")
    return parser.parse_args(argv)


def backfill_analytics(
    users_table: str,
    strategies_table: str,
    backtests_table: str,
    artifact_versions_table: str,
    analytics_table: str,
    region: str | None,
) -> None:
    session_kwargs = {}
    if region:
        session_kwargs["region_name"] = region
    session = boto3.Session(**session_kwargs)
    dynamo = session.resource("dynamodb")

    users = dynamo.Table(users_table)
    strategies = dynamo.Table(strategies_table)
    backtests = dynamo.Table(backtests_table)
    artifact_versions = dynamo.Table(artifact_versions_table)
    analytics = dynamo.Table(analytics_table)

    user_rollups: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "total_strategies_created": 0,
            "total_backtests_run": 0,
            "total_revisions": 0,
            "last_active_at": None,
        }
    )
    daily_metrics: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))

    for item in _scan_all_items(users, projection_expression="netid, joined_at"):
        joined_at = item.get("joined_at")
        if isinstance(joined_at, str) and joined_at:
            daily_metrics[USERS_JOINED_METRIC][_day_bucket(joined_at)] += 1

    for item in _scan_all_items(
        strategies,
        projection_expression="#owner, created_at, updated_at",
        expression_attribute_names={"#owner": "owner"},
    ):
        owner = _as_non_empty_string(item.get("owner"))
        if not owner:
            continue
        created_at = _as_non_empty_string(item.get("created_at"))
        updated_at = _as_non_empty_string(item.get("updated_at"))
        user_rollups[owner]["total_strategies_created"] += 1
        _track_last_active(user_rollups[owner], created_at)
        _track_last_active(user_rollups[owner], updated_at)
        if created_at:
            daily_metrics[STRATEGIES_CREATED_METRIC][_day_bucket(created_at)] += 1

    for item in _scan_all_items(
        backtests,
        projection_expression="#user, time_created",
        expression_attribute_names={"#user": "user"},
    ):
        netid = _as_non_empty_string(item.get("user"))
        if not netid:
            continue
        time_created = _as_non_empty_string(item.get("time_created"))
        user_rollups[netid]["total_backtests_run"] += 1
        _track_last_active(user_rollups[netid], time_created)
        if time_created:
            daily_metrics[BACKTESTS_CREATED_METRIC][_day_bucket(time_created)] += 1

    for item in _scan_all_items(
        artifact_versions,
        projection_expression="created_by, created_at",
    ):
        netid = _as_non_empty_string(item.get("created_by"))
        if not netid:
            continue
        created_at = _as_non_empty_string(item.get("created_at"))
        user_rollups[netid]["total_revisions"] += 1
        _track_last_active(user_rollups[netid], created_at)

    updated_users = 0
    updated_metrics = 0

    for netid, metrics in user_rollups.items():
        item = {
            "pk": f"USER#{netid}",
            "sk": "SUMMARY",
            "total_strategies_created": metrics["total_strategies_created"],
            "total_backtests_run": metrics["total_backtests_run"],
            "total_revisions": metrics["total_revisions"],
        }
        if metrics["last_active_at"]:
            item["last_active_at"] = metrics["last_active_at"]
            item["updated_at"] = metrics["last_active_at"]
        analytics.put_item(Item=item)
        updated_users += 1

    for metric_name, buckets in daily_metrics.items():
        for bucket_date, count in buckets.items():
            analytics.put_item(
                Item={
                    "pk": f"METRIC#{metric_name}",
                    "sk": f"DAY#{bucket_date}",
                    "count": count,
                    "updated_at": f"{bucket_date}T00:00:00+00:00",
                }
            )
            updated_metrics += 1

    print(f"Backfilled {updated_users} user summaries and {updated_metrics} metric buckets.")


def _scan_all_items(table, projection_expression=None, expression_attribute_names=None):
    scan_kwargs: dict[str, Any] = {}
    if projection_expression:
        scan_kwargs["ProjectionExpression"] = projection_expression
    if expression_attribute_names:
        scan_kwargs["ExpressionAttributeNames"] = expression_attribute_names

    while True:
        resp = table.scan(**scan_kwargs)
        for item in resp.get("Items", []):
            yield item

        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key


def _track_last_active(metrics: dict[str, Any], value: Any) -> None:
    if not isinstance(value, str) or not value:
        return
    current = metrics.get("last_active_at")
    if not isinstance(current, str) or value > current:
        metrics["last_active_at"] = value


def _day_bucket(timestamp: str) -> str:
    return timestamp.split("T")[0]


def _as_non_empty_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    backfill_analytics(
        users_table=args.users_table,
        strategies_table=args.strategies_table,
        backtests_table=args.backtests_table,
        artifact_versions_table=args.artifact_versions_table,
        analytics_table=args.analytics_table,
        region=args.region,
    )
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv[1:]))
