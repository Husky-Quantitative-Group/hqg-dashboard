"""A one-time copy of the AWS deployment's data into PostgreSQL.

    terraform -chdir=infra output -json > aws-outputs.json
    python -m hqg_dashboard import-aws --terraform-outputs aws-outputs.json \\
        --jwt-key-parameter hqg-prod-jwt-private-key

Every DynamoDB table is scanned and every S3 object they reference is copied,
in one transaction: the import completes or changes nothing. AWS credentials
come from the usual places (environment, ~/.aws, an instance role) and need
read access to the tables, both buckets and the SSM parameter. Requires boto3:
pip install -r requirements-aws-import.txt

With --jwt-key-parameter the session signing key moves as well, so cookies
issued by AWS stay valid and nobody has to sign in again.
"""

from __future__ import annotations

import json
from collections import Counter
from collections.abc import Iterator
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import boto3
from botocore.exceptions import BotoCoreError, ClientError
from cryptography.hazmat.primitives import serialization
from psycopg import Connection
from psycopg.types.json import Jsonb

from .accounts.validation import validate_package
from .auth.keys import store_key
from .backtests import finite_number
from .db import Database, continue_strategy_ids
from .serialization import utcnow
from .storage import payload_key

# Everything the import writes, emptied first by --replace. Signing keys are kept.
DATA_TABLES = (
    "users",
    "user_access_applications",
    "strategies",
    "strategy_artifacts",
    "strategy_artifact_versions",
    "strategy_permissions",
    "backtest_runs",
    "backtest_payloads",
    "engine_account_records",
)
RUN_NUMBERS = ("net_pnl", "sharpe", "win_rate", "max_drawdown", "trades_count")
MISSING_OBJECT_ERRORS = {"NoSuchKey", "NoSuchVersion"}


class ImportFailed(Exception):
    pass


@dataclass(frozen=True)
class AwsDeployment:
    """The deployment's table and bucket names."""

    users_table: str
    applications_table: str
    strategies_table: str
    counters_table: str
    artifacts_table: str
    artifact_versions_table: str
    read_permissions_table: str
    write_permissions_table: str
    backtests_table: str
    engine_accounts_table: str
    artifacts_bucket: str
    backtests_bucket: str

    @classmethod
    def from_terraform_outputs(cls, outputs: dict[str, Any]) -> AwsDeployment:
        """Read the names from the JSON that `terraform output -json` prints."""

        def value(name: str) -> str:
            output = outputs.get(name)
            if not isinstance(output, dict) or not isinstance(output.get("value"), str):
                raise ImportFailed(f"The Terraform outputs have no {name}")
            return output["value"]

        return cls(
            users_table=value("users_table_name"),
            applications_table=value("user_access_applications_table_name"),
            strategies_table=value("strategies_table_name"),
            counters_table=value("counters_table_name"),
            artifacts_table=value("strategy_artifacts_table_name"),
            artifact_versions_table=value("strategy_artifact_versions_table_name"),
            read_permissions_table=value("strategies_read_permissions_table_name"),
            write_permissions_table=value("strategies_write_permissions_table_name"),
            backtests_table=value("strategy_backtests_table_name"),
            engine_accounts_table=value("engine_accounts_table"),
            artifacts_bucket=value("artifacts_bucket_name"),
            backtests_bucket=value("backtests_bucket_name"),
        )


@dataclass
class ImportSummary:
    counts: Counter[str] = field(default_factory=Counter)
    warnings: list[str] = field(default_factory=list)


def import_from_aws(
    db: Database,
    deployment: AwsDeployment,
    *,
    region: str,
    jwt_key_parameter: str | None = None,
    replace: bool = False,
) -> ImportSummary:
    session = boto3.Session(region_name=region)
    try:
        with db.transaction() as conn:
            _prepare(conn, replace)
            importer = _Importer(conn, session, deployment)
            importer.run(jwt_key_parameter)
    except (BotoCoreError, ClientError) as exc:
        raise ImportFailed(f"AWS request failed: {exc}") from exc
    return importer.summary


def _prepare(conn: Connection, replace: bool) -> None:
    if replace:
        conn.execute(f"TRUNCATE {', '.join(DATA_TABLES)}")
        return
    has_data = conn.execute(
        """
        SELECT EXISTS (SELECT 1 FROM users)
            OR EXISTS (SELECT 1 FROM user_access_applications)
            OR EXISTS (SELECT 1 FROM strategies)
            OR EXISTS (SELECT 1 FROM engine_account_records) AS has_data
        """
    ).fetchone()["has_data"]
    if has_data:
        raise ImportFailed(
            "The database already holds dashboard data. "
            "Pass --replace to delete it and import again."
        )


class _Importer:
    def __init__(self, conn: Connection, session: boto3.Session, deployment: AwsDeployment):
        self.conn = conn
        self.dynamodb = session.resource("dynamodb")
        self.s3 = session.client("s3")
        self.ssm = session.client("ssm")
        self.aws = deployment
        self.summary = ImportSummary()
        self.strategy_ids: set[str] = set()
        self.artifacts: set[tuple[str, str]] = set()

    def run(self, jwt_key_parameter: str | None) -> None:
        self.users()
        self.applications()
        self.strategies()
        self.artifact_files()
        self.permissions()
        self.backtests()
        self.engine_accounts()
        if jwt_key_parameter:
            self.signing_key(jwt_key_parameter)

    def users(self) -> None:
        for item in self.scan(self.aws.users_table):
            self.conn.execute(
                """
                INSERT INTO users (
                    netid, full_name, uconn_email, discord_username, linkedin_url, github_url,
                    roles, is_banned, notes, joined_at, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    item["netid"],
                    _text(item.get("full_name")),
                    _text(item.get("uconn_email")),
                    _text(item.get("discord_username")),
                    _text(item.get("linkedin_url")),
                    _text(item.get("github_url")),
                    _strings(item.get("roles")) or [],
                    bool(item.get("is_banned")),
                    _text(item.get("notes")),
                    _timestamp(item.get("joined_at")),
                    _timestamp(item.get("created_at")),
                    _timestamp(item.get("updated_at")),
                ],
            )
            self.summary.counts["users"] += 1

    def applications(self) -> None:
        items = sorted(self.scan(self.aws.applications_table), key=lambda item: item["created_at"])
        for item in items:
            created_at = _timestamp(item["created_at"])
            if created_at is None:
                self.warn(f"Skipped an access request by {item['netid']}: its date is unreadable")
                continue
            self.conn.execute(
                """
                INSERT INTO user_access_applications (
                    netid, created_at, full_name, uconn_email, discord_username, linkedin_url,
                    github_url, status, decided_at, decided_by, decision_notes
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    item["netid"],
                    created_at,
                    _text(item.get("full_name")) or "",
                    _text(item.get("uconn_email")) or "",
                    _text(item.get("discord_username")),
                    _text(item.get("linkedin_url")),
                    _text(item.get("github_url")),
                    _text(item.get("status")) or "PENDING",
                    _timestamp(item.get("decided_at")),
                    _text(item.get("decided_by")),
                    _text(item.get("decision_notes")),
                ],
            )
            self.summary.counts["access requests"] += 1

    def strategies(self) -> None:
        for item in self.scan(self.aws.strategies_table):
            strategy_id = str(item["id"])
            self.conn.execute(
                """
                INSERT INTO strategies (
                    id, name, description, owner, owner_display, entrypoint, current_version,
                    tags, metrics, created_at, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    strategy_id,
                    _text(item.get("name")) or f"Strategy {strategy_id}",
                    _text(item.get("description")),
                    _text(item.get("owner")),
                    _text(item.get("owner_display")),
                    _text(item.get("entrypoint")) or "main.py",
                    int(item.get("current_version") or 0),
                    _strings(item.get("tags")),
                    _jsonb(item.get("metrics")),
                    _timestamp(item.get("created_at")),
                    _timestamp(item.get("updated_at")),
                ],
            )
            self.strategy_ids.add(strategy_id)
            self.summary.counts["strategies"] += 1

        counters = self.dynamodb.Table(self.aws.counters_table)
        counter = counters.get_item(Key={"counter_name": "strategies"}, ConsistentRead=True)
        continue_strategy_ids(self.conn, after=int(counter.get("Item", {}).get("value", 0)))

    def artifact_files(self) -> None:
        for item in self.scan(self.aws.artifacts_table):
            strategy_id, artifact_id = str(item["strategy_id"]), item["artifact_id"]
            if strategy_id not in self.strategy_ids:
                self.warn(f"Skipped {artifact_id} of strategy {strategy_id}: no such strategy")
                continue
            self.conn.execute(
                """
                INSERT INTO strategy_artifacts (strategy_id, artifact_id, latest_version)
                VALUES (%s, %s, %s)
                """,
                [strategy_id, artifact_id, int(item["latest_version"])],
            )
            self.artifacts.add((strategy_id, artifact_id))

        for item in self.scan(self.aws.artifact_versions_table):
            strategy_id, _, artifact_id = item["strategy_artifact_id"].partition("#")
            version = int(item["strategy_version"])
            name = f"{artifact_id} v{version} of strategy {strategy_id}"
            if (strategy_id, artifact_id) not in self.artifacts:
                self.warn(f"Skipped {name}: the file is not listed")
                continue
            stored = self.s3_object(
                self.aws.artifacts_bucket, item["s3_key"], item.get("s3_version_id")
            )
            if stored is None:
                self.warn(f"Skipped {name}: its S3 object is missing")
                continue
            content, last_modified = stored
            self.conn.execute(
                """
                INSERT INTO strategy_artifact_versions
                    (strategy_id, artifact_id, version, content, created_at)
                VALUES (%s, %s, %s, %s, %s)
                """,
                [
                    strategy_id,
                    artifact_id,
                    version,
                    content,
                    _timestamp(item.get("created_at")) or last_modified,
                ],
            )
            self.summary.counts["file versions"] += 1

    def permissions(self) -> None:
        for access, table in (
            ("read", self.aws.read_permissions_table),
            ("write", self.aws.write_permissions_table),
        ):
            for item in self.scan(table):
                strategy_id, principal = str(item["strategy_id"]), item["principal"]
                if strategy_id not in self.strategy_ids:
                    self.warn(f"Skipped {access} access for {principal}: no strategy {strategy_id}")
                    continue
                self.conn.execute(
                    """
                    INSERT INTO strategy_permissions (strategy_id, access, principal)
                    VALUES (%s, %s, %s)
                    """,
                    [strategy_id, access, principal],
                )
                self.summary.counts["permissions"] += 1

    def backtests(self) -> None:
        for item in self.scan(self.aws.backtests_table):
            strategy_id, run_id = str(item["strategy_id"]), item["run_id"]
            if strategy_id not in self.strategy_ids:
                self.warn(f"Skipped backtest {run_id}: no strategy {strategy_id}")
                continue
            self.conn.execute(
                """
                INSERT INTO backtest_runs (
                    strategy_id, run_id, name, time_created, created_by, strategy_version,
                    backtest_params, metrics, net_pnl, sharpe, win_rate, max_drawdown, trades_count
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    strategy_id,
                    run_id,
                    _text(item.get("name")),
                    _timestamp(item.get("time_created")) or utcnow(),
                    _text(item.get("user")),
                    _jsonb(item.get("strategy_version")),
                    Jsonb(item.get("backtest_params") or {}),
                    _jsonb(item.get("metrics")),
                    *(finite_number(item.get(column)) for column in RUN_NUMBERS),
                ],
            )
            self.summary.counts["backtests"] += 1

            key = payload_key(strategy_id, run_id)
            stored = self.s3_object(
                item.get("s3_bucket") or self.aws.backtests_bucket, item.get("s3_key") or key
            )
            if stored is None:
                self.warn(f"Backtest {run_id} of strategy {strategy_id} has no saved results")
                continue
            self.conn.execute(
                "INSERT INTO backtest_payloads (key, content, uploaded_at) VALUES (%s, %s, %s)",
                [key, *stored],
            )

    def engine_accounts(self) -> None:
        for item in self.scan(self.aws.engine_accounts_table):
            account_id, record, body = item["account_id"], item["record"], item["body"]
            if record.startswith("package#"):
                body = self.package_snapshot(account_id, record.removeprefix("package#"), body)
                if body is None:
                    continue
            self.conn.execute(
                """
                INSERT INTO engine_account_records (account_id, record, body, generation)
                VALUES (%s, %s, %s, %s)
                """,
                [account_id, record, body, item.get("generation") if record == "state" else None],
            )
            self.summary.counts["account records"] += 1

    def package_snapshot(self, account_id: str, digest: str, body: str) -> str | None:
        """A registered package as the record itself. AWS kept it in the artifacts bucket."""
        name = f"package {digest} of account {account_id}"
        reference = json.loads(body)
        stored = self.s3_object(
            self.aws.artifacts_bucket, reference["key"], reference["version_id"]
        )
        if stored is None:
            self.warn(f"Skipped {name}: its S3 object is missing")
            return None
        try:
            package = json.loads(stored[0])
            identity, _ = validate_package(package)
        except (ValueError, SyntaxError, TypeError):
            self.warn(f"Skipped {name}: its S3 object is not a valid package")
            return None
        if identity["source_digest"] != digest:
            self.warn(f"The contents of {name} do not match its digest")
        return json.dumps({"package": package}, allow_nan=False)

    def signing_key(self, parameter: str) -> None:
        pem = self.ssm.get_parameter(Name=parameter, WithDecryption=True)["Parameter"]["Value"]
        try:
            private_key = serialization.load_pem_private_key(pem.encode(), password=None)
        except ValueError as exc:
            raise ImportFailed(f"The {parameter} parameter does not hold a private key") from exc
        store_key(self.conn, private_key, utcnow())
        self.summary.counts["signing keys"] += 1

    def scan(self, table_name: str) -> Iterator[dict[str, Any]]:
        table = self.dynamodb.Table(table_name)
        request: dict[str, Any] = {"ConsistentRead": True}
        while True:
            page = table.scan(**request)
            for item in page.get("Items", []):
                yield _plain(item)
            if "LastEvaluatedKey" not in page:
                return
            request["ExclusiveStartKey"] = page["LastEvaluatedKey"]

    def s3_object(
        self, bucket: str, key: str, version_id: str | None = None
    ) -> tuple[bytes, datetime] | None:
        """An object's content and modification time, or None if it does not exist."""
        request = {"Bucket": bucket, "Key": key}
        if version_id and version_id != "null":
            request["VersionId"] = version_id
        try:
            response = self.s3.get_object(**request)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") in MISSING_OBJECT_ERRORS:
                return None
            raise
        with response["Body"] as body:
            return body.read(), response["LastModified"]

    def warn(self, message: str) -> None:
        self.summary.warnings.append(message)


def _plain(value: Any) -> Any:
    """A DynamoDB value as plain JSON data: numbers as int or float, sets as sorted lists."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, dict):
        return {key: _plain(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_plain(item) for item in value]
    if isinstance(value, (set, frozenset)):
        return sorted(_plain(item) for item in value)
    return value


def _text(value: Any) -> str | None:
    return None if value is None else str(value)


def _strings(value: Any) -> list[str] | None:
    """A list of strings from a DynamoDB list, set or lone value."""
    if value is None:
        return None
    return [str(item) for item in (value if isinstance(value, list) else [value])]


def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.strip())
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _jsonb(value: Any) -> Jsonb | None:
    return None if value is None else Jsonb(value)
