"""Operator commands. Run `python -m hqg_dashboard --help`; all need DATABASE_URL."""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from .accounts.admin import authorize_replacement, provision
from .accounts.control import Conflict
from .accounts.store import PostgresStore
from .auth.keys import SigningKeys
from .db import Database, migrate


def main(argv: Sequence[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    database_url = os.environ.get("DATABASE_URL", "").strip()
    if not database_url:
        parser.error("the DATABASE_URL environment variable is required")
    db = Database(database_url, max_size=2)
    db.open()
    try:
        applied = migrate(db)
        if args.command == "migrate":
            print(
                f"Applied {len(applied)} migration(s)." if applied else "The schema is up to date."
            )
        elif args.command == "rotate-keys":
            lifetime = int(os.environ.get("AUTH_COOKIE_MAX_AGE_SECONDS", "86400"))
            print(f"Now signing with key {SigningKeys(db, lifetime).rotate()}.")
        elif args.command == "seed":
            return _seed(db, args)
        elif args.command == "import-aws":
            return _import_aws(db, args)
        else:
            _account_command(parser, PostgresStore(db), args)
    finally:
        db.close()
    return 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m hqg_dashboard", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True, metavar="COMMAND")

    commands.add_parser("migrate", help="apply pending database migrations")
    commands.add_parser("rotate-keys", help="start signing sessions with a new JWT key now")

    seed = commands.add_parser("seed", help="load the sample strategies, backtests and an admin")
    seed.add_argument(
        "--backtester-url", help="hqg-backtester base URL, e.g. http://localhost:8005"
    )
    seed.add_argument("--skip-backtests", action="store_true", help="seed strategies only")
    seed.add_argument("--admin-netid", help="NetID to make an ADMIN")

    provision_account = commands.add_parser(
        "provision-account", help="create an engine account record"
    )
    provision_account.add_argument("--account-id", required=True)
    provision_account.add_argument("--engine-id", required=True)
    provision_account.add_argument("--netid", required=True)
    provision_account.add_argument("--allow-live", action="store_true")
    provision_account.add_argument(
        "--secret-env",
        default="DASHBOARD_SYNC_SECRET",
        help="environment variable holding the engine's service secret",
    )

    replacement = commands.add_parser(
        "authorize-replacement", help="let a new engine provider boot replace a stopped one"
    )
    replacement.add_argument("--account-id", required=True)
    replacement.add_argument("--actor", required=True, help="NetID recorded in the audit log")

    aws = commands.add_parser(
        "import-aws", help="copy all data from the AWS deployment (needs boto3)"
    )
    aws.add_argument(
        "--terraform-outputs",
        required=True,
        type=Path,
        help="file holding the output of `terraform output -json` for the deployment",
    )
    aws.add_argument("--region", default="us-east-1")
    aws.add_argument(
        "--jwt-key-parameter",
        help="SSM parameter holding the session signing key, e.g. hqg-prod-jwt-private-key",
    )
    aws.add_argument("--replace", action="store_true", help="delete existing dashboard data first")
    return parser


def _seed(db: Database, args: argparse.Namespace) -> int:
    from .seed import BacktesterClient, load_samples, seed

    try:
        backtester, skip_reason = None, ""
        if args.skip_backtests:
            skip_reason = "--skip-backtests was set"
        elif args.backtester_url:
            candidate = BacktesterClient(args.backtester_url)
            healthy, skip_reason = candidate.preflight()
            backtester = candidate if healthy else None
            print("Backtester preflight " + ("succeeded." if healthy else f"failed: {skip_reason}"))
        else:
            skip_reason = "--backtester-url was not provided"

        summary = seed(
            db,
            load_samples(),
            backtester=backtester,
            skip_reason=skip_reason,
            admin_netid=(args.admin_netid or "").strip() or None,
        )
    except (ValueError, OSError) as exc:
        print(f"Failed to seed data: {exc}", file=sys.stderr)
        return 1

    if summary.requested:
        print(f"Backtests: seeded {summary.seeded}/{summary.requested}, skipped {summary.skipped}.")
        if summary.skipped and summary.skip_reason:
            print(f"Backtests were skipped because {summary.skip_reason}.")
    print("Seeding complete.")
    return 0


def _import_aws(db: Database, args: argparse.Namespace) -> int:
    try:
        from .aws_import import AwsDeployment, ImportFailed, import_from_aws
    except ModuleNotFoundError as exc:
        print(
            f"The import needs {exc.name}: pip install -r requirements-aws-import.txt",
            file=sys.stderr,
        )
        return 1

    try:
        outputs = json.loads(args.terraform_outputs.read_text(encoding="utf-8"))
        summary = import_from_aws(
            db,
            AwsDeployment.from_terraform_outputs(outputs),
            region=args.region,
            jwt_key_parameter=args.jwt_key_parameter,
            replace=args.replace,
        )
    except (OSError, ValueError, ImportFailed) as exc:
        print(f"Import failed: {exc}", file=sys.stderr)
        return 1

    for warning in summary.warnings:
        print(f"Warning: {warning}")
    for name, count in summary.counts.items():
        print(f"Imported {count} {name}.")
    print("Import complete.")
    return 0


def _account_command(
    parser: argparse.ArgumentParser, store: PostgresStore, args: argparse.Namespace
) -> None:
    try:
        if args.command == "provision-account":
            provision(
                store,
                args.account_id,
                args.engine_id,
                args.netid,
                os.environ[args.secret_env],
                args.allow_live,
            )
        else:
            authorize_replacement(store, args.account_id, args.actor)
    except (Conflict, ValueError, KeyError) as exc:
        parser.error(str(exc))
    print("Account operation completed. Both modes are paused and require Resume.")
