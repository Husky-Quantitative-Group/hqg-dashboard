#!/usr/bin/env python3
import argparse
from collections import defaultdict
from typing import Any, Iterable

import boto3


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill per-user analytics rollups.")
    parser.add_argument("--strategies-table", required=True, help="DynamoDB Strategies table name.")
    parser.add_argument("--backtests-table", required=True, help="DynamoDB StrategyBacktests table name.")
    parser.add_argument(
        "--artifact-versions-table",
        required=True,
        help="DynamoDB StrategyArtifactVersions table name.",
    )
    parser.add_argument("--analytics-table", required=True, help="DynamoDB UserAnalytics table name.")
    parser.add_argument("--region", default=None, help="AWS region (overrides default resolver).")
    return parser.parse_args(argv)


def backfill_user_analytics(
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

    strategies = dynamo.Table(strategies_table)
    backtests = dynamo.Table(backtests_table)
    artifact_versions = dynamo.Table(artifact_versions_table)
    analytics = dynamo.Table(analytics_table)

    rollups: dict[str, dict[str, Any]] = defaultdict(
        lambda: {
            "total_strategies_created": 0,
            "total_backtests_run": 0,
            "total_revisions": 0,
            "last_active_at": None,
        }
    )

    for item in _scan_all_items(
        strategies,
        projection_expression="owner, created_at, updated_at",
    ):
        owner = item.get("owner")
        if not isinstance(owner, str) or not owner.strip():
            continue
        owner = owner.strip()
        rollups[owner]["total_strategies_created"] += 1
        _track_last_active(rollups[owner], item.get("updated_at"))
        _track_last_active(rollups[owner], item.get("created_at"))

    for item in _scan_all_items(
        backtests,
        projection_expression="#user, time_created",
        expression_attribute_names={"#user": "user"},
    ):
        netid = item.get("user")
        if not isinstance(netid, str) or not netid.strip():
            continue
        netid = netid.strip()
        rollups[netid]["total_backtests_run"] += 1
        _track_last_active(rollups[netid], item.get("time_created"))

    for item in _scan_all_items(
        artifact_versions,
        projection_expression="created_by, created_at",
    ):
        netid = item.get("created_by")
        if not isinstance(netid, str) or not netid.strip():
            continue
        netid = netid.strip()
        rollups[netid]["total_revisions"] += 1
        _track_last_active(rollups[netid], item.get("created_at"))

    updated = 0
    for netid, metrics in rollups.items():
        item = {
            "netid": netid,
            "total_strategies_created": metrics["total_strategies_created"],
            "total_backtests_run": metrics["total_backtests_run"],
            "total_revisions": metrics["total_revisions"],
        }
        if metrics["last_active_at"]:
            item["last_active_at"] = metrics["last_active_at"]
            item["updated_at"] = metrics["last_active_at"]
        analytics.put_item(Item=item)
        updated += 1

    print(f"Backfilled analytics for {updated} users.")


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


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    backfill_user_analytics(
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
