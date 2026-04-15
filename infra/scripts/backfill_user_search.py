#!/usr/bin/env python3
import argparse
from typing import Iterable

import boto3


def parse_args(argv: Iterable[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Backfill search_pk/full_name_lower for users.")
    parser.add_argument("--users-table", required=True, help="DynamoDB Users table name.")
    parser.add_argument("--region", default=None, help="AWS region (overrides default resolver).")
    return parser.parse_args(argv)


def backfill_user_search_keys(users_table: str, region: str | None) -> None:
    session_kwargs = {}
    if region:
        session_kwargs["region_name"] = region
    session = boto3.Session(**session_kwargs)
    dynamo = session.resource("dynamodb")
    users = dynamo.Table(users_table)

    scan_kwargs: dict = {
        "ProjectionExpression": "netid, full_name, search_pk, full_name_lower",
    }
    updated = 0
    scanned = 0
    while True:
        resp = users.scan(**scan_kwargs)
        items = resp.get("Items", [])
        scanned += len(items)
        for item in items:
            netid = item.get("netid")
            if not isinstance(netid, str) or not netid.strip():
                continue

            updates = []
            expr_names = {}
            expr_values = {}

            if not item.get("search_pk"):
                expr_names["#search_pk"] = "search_pk"
                expr_values[":search_pk"] = "USER"
                updates.append("#search_pk = :search_pk")

            full_name = item.get("full_name")
            if isinstance(full_name, str) and full_name.strip() and not item.get("full_name_lower"):
                expr_names["#full_name_lower"] = "full_name_lower"
                expr_values[":full_name_lower"] = full_name.strip().lower()
                updates.append("#full_name_lower = :full_name_lower")

            if updates:
                users.update_item(
                    Key={"netid": netid},
                    UpdateExpression="SET " + ", ".join(updates),
                    ExpressionAttributeNames=expr_names,
                    ExpressionAttributeValues=expr_values,
                )
                updated += 1

        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    print(f"Backfilled search keys for {updated} users (scanned {scanned}).")


def main(argv: Iterable[str]) -> int:
    args = parse_args(argv)
    backfill_user_search_keys(args.users_table, args.region)
    return 0


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv[1:]))
