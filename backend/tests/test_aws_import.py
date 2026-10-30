"""The one-time import from the AWS deployment, against moto's fake AWS.

The items are shaped as the AWS Lambdas wrote them; the imported data is
checked through the API.
"""

from __future__ import annotations

import gzip
import json
import time
from decimal import Decimal
from typing import Any

import boto3
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from moto import mock_aws

from hqg_dashboard.accounts.control import new_account
from hqg_dashboard.accounts.validation import validate_package
from hqg_dashboard.auth.keys import SigningKeys, public_jwk
from hqg_dashboard.auth.session import COOKIE_NAME
from hqg_dashboard.aws_import import AwsDeployment, ImportFailed, import_from_aws
from hqg_dashboard.cli import main
from support import ACCOUNT, ENGINE, PACKAGE, SERVICE_SECRET, add_user, execute

REGION = "us-east-1"
JWT_KEY_PARAMETER = "hqg-prod-jwt-private-key"
ARTIFACTS_BUCKET = "hqg-prod-strategy-artifacts"
BACKTESTS_BUCKET = "hqg-prod-backtest-metrics"
RUN_ID = "01JQ7Z5V3W8XKD2M4N6P8R0T2V"
PAYLOAD = {"metrics": {"sharpe_ratio": 1.5}, "orders": [{"symbol": "AAPL"}]}
DIGEST = validate_package(PACKAGE)[0]["source_digest"]

# Key schemas of the DynamoDB tables, from the deployment's Terraform.
TABLES = {
    "users_table_name": ("hqg-prod-users", [("netid", "S")]),
    "user_access_applications_table_name": (
        "hqg-prod-user-access-applications",
        [("netid", "S"), ("created_at", "S")],
    ),
    "strategies_table_name": ("hqg-prod-strategies", [("id", "S")]),
    "counters_table_name": ("hqg-prod-counters", [("counter_name", "S")]),
    "strategy_artifacts_table_name": (
        "hqg-prod-strategy-artifacts",
        [("strategy_id", "S"), ("artifact_id", "S")],
    ),
    "strategy_artifact_versions_table_name": (
        "hqg-prod-strategy-artifact-versions",
        [("strategy_artifact_id", "S"), ("strategy_version", "N")],
    ),
    "strategies_read_permissions_table_name": (
        "hqg-prod-strategies-read-permissions",
        [("strategy_id", "S"), ("principal", "S")],
    ),
    "strategies_write_permissions_table_name": (
        "hqg-prod-strategies-write-permissions",
        [("strategy_id", "S"), ("principal", "S")],
    ),
    "strategy_backtests_table_name": (
        "hqg-prod-backtest-metrics",
        [("strategy_id", "S"), ("run_id", "S")],
    ),
    "engine_accounts_table": ("hqg-prod-engine-accounts", [("account_id", "S"), ("record", "S")]),
}
# As `terraform output -json` prints them.
TERRAFORM_OUTPUTS = {
    **{
        output: {"sensitive": False, "type": "string", "value": name}
        for output, (name, _) in TABLES.items()
    },
    "artifacts_bucket_name": {"sensitive": False, "type": "string", "value": ARTIFACTS_BUCKET},
    "backtests_bucket_name": {"sensitive": False, "type": "string", "value": BACKTESTS_BUCKET},
}
DEPLOYMENT = AwsDeployment.from_terraform_outputs(TERRAFORM_OUTPUTS)


class FakeDeployment:
    """The AWS deployment's tables, buckets and signing key parameter, in moto."""

    def __init__(self) -> None:
        self.dynamodb = boto3.resource("dynamodb", region_name=REGION)
        self.s3 = boto3.client("s3", region_name=REGION)
        self.ssm = boto3.client("ssm", region_name=REGION)
        for name, keys in TABLES.values():
            self.dynamodb.create_table(
                TableName=name,
                BillingMode="PAY_PER_REQUEST",
                KeySchema=[
                    {"AttributeName": key, "KeyType": "HASH" if index == 0 else "RANGE"}
                    for index, (key, _) in enumerate(keys)
                ],
                AttributeDefinitions=[
                    {"AttributeName": key, "AttributeType": kind} for key, kind in keys
                ],
            )
        for bucket in (ARTIFACTS_BUCKET, BACKTESTS_BUCKET):
            self.s3.create_bucket(Bucket=bucket)
        self.s3.put_bucket_versioning(
            Bucket=ARTIFACTS_BUCKET, VersioningConfiguration={"Status": "Enabled"}
        )

    def put(self, output: str, *items: dict[str, Any]) -> None:
        table = self.dynamodb.Table(TABLES[output][0])
        for item in items:
            table.put_item(Item=item)

    def put_object(self, bucket: str, key: str, body: bytes) -> str | None:
        return self.s3.put_object(Bucket=bucket, Key=key, Body=body).get("VersionId")


@pytest.fixture
def aws(monkeypatch: pytest.MonkeyPatch):
    for name, value in {
        "AWS_ACCESS_KEY_ID": "testing",
        "AWS_SECRET_ACCESS_KEY": "testing",
        "AWS_SESSION_TOKEN": "testing",
        "AWS_EC2_METADATA_DISABLED": "true",
        "AWS_SHARED_CREDENTIALS_FILE": "/dev/null",
        "AWS_CONFIG_FILE": "/dev/null",
    }.items():
        monkeypatch.setenv(name, value)
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    with mock_aws():
        yield FakeDeployment()


@pytest.fixture
def signing_key(aws: FakeDeployment) -> rsa.RSAPrivateKey:
    """The deployment's current session signing key, as the key rotator stored it."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    aws.ssm.put_parameter(
        Name=JWT_KEY_PARAMETER,
        Type="SecureString",
        Value=private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode(),
    )
    return private_key


@pytest.fixture
def deployment(aws: FakeDeployment) -> FakeDeployment:
    """A deployment holding one of everything."""
    aws.put(
        "users_table_name",
        {
            "netid": "ada",
            "full_name": "Ada Lovelace",
            "full_name_lower": "ada lovelace",
            "search_pk": "USER",
            "uconn_email": "ada@uconn.edu",
            "discord_username": None,
            "github_url": "https://github.com/ada",
            "joined_at": "2026-02-01T10:00:00.123456+00:00",
            "roles": ["PUBLIC", "ADMIN"],
            "is_banned": False,
        },
        {"netid": "bob", "roles": "PUBLIC", "is_banned": True, "notes": "Left the club"},
    )
    aws.put(
        "user_access_applications_table_name",
        {
            "netid": "cy",
            "created_at": "2026-01-05T09:00:00Z",
            "full_name": "Cy Young",
            "uconn_email": "cy@uconn.edu",
            "status": "DENIED",
            "decided_at": "2026-01-06T09:00:00.000001+00:00",
            "decided_by": "ada",
            "decision_notes": "Apply next semester",
        },
        {
            "netid": "cy",
            "created_at": "2026-03-01T12:30:00Z",
            "full_name": "Cy Young",
            "uconn_email": "cy@uconn.edu",
            "discord_username": None,
            "linkedin_url": "https://www.linkedin.com/in/cy",
            "github_url": None,
            "status": "PENDING",
        },
    )
    aws.put(
        "strategies_table_name",
        {
            "id": "1",
            "name": "Momentum",
            "description": "Buys what went up",
            "owner": "ada",
            "owner_display": "Ada Lovelace",
            "entrypoint": "main.py",
            "current_version": Decimal(2),
            "tags": ["trend"],
            "metrics": {"sharpe_ratio": Decimal("1.5"), "total_orders": Decimal(12)},
            "created_at": "2026-02-02T10:00:00+00:00",
            "updated_at": "2026-02-03T10:00:00+00:00",
        },
    )
    aws.put("counters_table_name", {"counter_name": "strategies", "value": Decimal(9)})

    # main.py was saved twice under one key: each version names its S3 object version.
    readme_key, main_key = "1/v1/README.md", "1/v1/8c41/main.py"
    aws.put_object(ARTIFACTS_BUCKET, readme_key, b"# Momentum\n")
    first = aws.put_object(ARTIFACTS_BUCKET, main_key, b"print('v1')\n")
    second = aws.put_object(ARTIFACTS_BUCKET, main_key, b"print('v2')\n")
    aws.put(
        "strategy_artifacts_table_name",
        {"strategy_id": "1", "artifact_id": "README.md", "latest_version": Decimal(1)},
        {"strategy_id": "1", "artifact_id": "main.py", "latest_version": Decimal(2)},
    )
    aws.put(
        "strategy_artifact_versions_table_name",
        {
            "strategy_artifact_id": "1#README.md",
            "strategy_version": Decimal(1),
            "s3_key": readme_key,
            "created_at": "2026-02-02T10:00:00+00:00",
        },
        *(
            {
                "strategy_artifact_id": "1#main.py",
                "strategy_version": Decimal(version),
                "s3_key": main_key,
                "s3_version_id": version_id,
                "created_at": "2026-02-02T10:00:00+00:00",
            }
            for version, version_id in ((1, first), (2, second))
        ),
    )
    aws.put(
        "strategies_read_permissions_table_name", {"strategy_id": "1", "principal": "ROLE#PUBLIC"}
    )
    aws.put(
        "strategies_write_permissions_table_name", {"strategy_id": "1", "principal": "USER#ada"}
    )

    run_key = f"strategies/1/runs/{RUN_ID}/run.json.gz"
    aws.put_object(BACKTESTS_BUCKET, run_key, gzip.compress(json.dumps(PAYLOAD).encode()))
    aws.put(
        "strategy_backtests_table_name",
        {
            "strategy_id": "1",
            "run_id": RUN_ID,
            "name": "Agile Badger",
            "time_created": "2026-02-04T10:00:00.250000+00:00",
            "user": "ada",
            "strategy_version": Decimal(2),
            "backtest_params": {
                "start_date": "2024-01-01",
                "end_date": "2024-06-30",
                "initial_capital": Decimal(100000),
            },
            "metrics": {"sharpe_ratio": Decimal("1.5"), "total_orders": Decimal(12)},
            "net_pnl": Decimal("1234.5"),
            "sharpe": Decimal("1.5"),
            "trades_count": Decimal(12),
            "s3_bucket": BACKTESTS_BUCKET,
            "s3_key": run_key,
        },
    )

    # An engine account with a registered package, kept in the artifacts bucket.
    package_key = f"engine-packages/{ACCOUNT}/{DIGEST[7:]}/5f0e.json"
    package_version = aws.put_object(
        ARTIFACTS_BUCKET,
        package_key,
        json.dumps(PACKAGE, sort_keys=True, separators=(",", ":")).encode(),
    )
    state = new_account(
        ACCOUNT, ENGINE, {"ada": ["control"]}, [validate_package(PACKAGE)[0]], None, SERVICE_SECRET
    )
    state.update(generation=3, control_version=1)
    aws.put(
        "engine_accounts_table",
        {"account_id": ACCOUNT, "record": "state", "body": json.dumps(state), "generation": 3},
        {
            "account_id": ACCOUNT,
            "record": "package#" + DIGEST,
            "body": json.dumps({"key": package_key, "version_id": package_version}),
        },
        {
            "account_id": ACCOUNT,
            "record": "audit#4b9f",
            "body": json.dumps({"actor": "ada", "kind": "provision", "timestamp": 1.5}),
        },
    )
    return aws


def run_import(db, **options: Any):
    return import_from_aws(db, DEPLOYMENT, region=REGION, **options)


def session(netid: str, roles: list[str], private_key: rsa.RSAPrivateKey) -> dict[str, str]:
    """A session cookie as the AWS deployment issued them."""
    now = int(time.time())
    token = jwt.encode(
        {"sub": netid, "iat": now, "exp": now + 3600, "roles": roles},
        private_key,
        algorithm="RS256",
        headers={"kid": public_jwk(private_key.public_key())["kid"]},
    )
    return {"Cookie": f"{COOKIE_NAME}={token}"}


def test_import_copies_everything(deployment, signing_key, client, db):
    summary = run_import(db, jwt_key_parameter=JWT_KEY_PARAMETER)
    assert summary.warnings == []
    assert dict(summary.counts) == {
        "users": 2,
        "access requests": 2,
        "strategies": 1,
        "file versions": 3,
        "permissions": 2,
        "backtests": 1,
        "account records": 3,
        "signing keys": 1,
    }

    # Sessions signed in AWS keep working, and the imported key signs new ones.
    ada = session("ada", ["PUBLIC"], signing_key)
    me = client.get("/auth/me", headers=ada).json()
    assert me == {"netid": "ada", "roles": ["PUBLIC", "ADMIN"], "display_name": "Ada Lovelace"}
    kid = public_jwk(signing_key.public_key())["kid"]
    jwks = client.get("/.well-known/jwks.json").json()
    assert jwks["keys"][-1]["kid"] == kid
    assert jwt.get_unverified_header(client.app.state.keys.sign({"sub": "ada"}))["kid"] == kid

    assert client.get("/admin/users/ada", headers=ada).json() == {
        "netid": "ada",
        "full_name": "Ada Lovelace",
        "uconn_email": "ada@uconn.edu",
        "github_url": "https://github.com/ada",
        "roles": ["PUBLIC", "ADMIN"],
        "is_banned": False,
        "joined_at": "2026-02-01T10:00:00.123456+00:00",
    }
    assert client.get("/admin/users/bob", headers=ada).json() == {
        "netid": "bob",
        "roles": ["PUBLIC"],
        "is_banned": True,
        "notes": "Left the club",
    }
    assert client.get("/admin/access-requests", headers=ada).json() == [
        {
            "netid": "cy",
            "created_at": "2026-03-01T12:30:00Z",
            "full_name": "Cy Young",
            "uconn_email": "cy@uconn.edu",
            "linkedin_url": "https://www.linkedin.com/in/cy",
            "status": "PENDING",
        },
        {
            "netid": "cy",
            "created_at": "2026-01-05T09:00:00Z",
            "full_name": "Cy Young",
            "uconn_email": "cy@uconn.edu",
            "status": "DENIED",
            "decided_at": "2026-01-06T09:00:00.000001+00:00",
            "decided_by": "ada",
            "decision_notes": "Apply next semester",
        },
    ]

    assert client.get("/strategies/1", headers=ada).json() == {
        "id": "1",
        "name": "Momentum",
        "entrypoint": "main.py",
        "current_version": 2,
        "created_at": "2026-02-02T10:00:00+00:00",
        "updated_at": "2026-02-03T10:00:00+00:00",
        "description": "Buys what went up",
        "owner": "ada",
        "owner_display": "Ada Lovelace",
        "tags": ["trend"],
        "metrics": {"sharpe_ratio": 1.5, "total_orders": 12},
    }
    artifacts = client.get("/strategies/1/artifacts", headers=ada).json()
    assert artifacts == {"artifacts": ["README.md", "main.py"]}
    assert client.get("/strategies/1/artifacts/main.py", headers=ada).content == b"print('v2')\n"
    rows = execute(db, "SELECT version, content FROM strategy_artifact_versions ORDER BY 1")
    assert [(row["version"], row["content"]) for row in rows] == [
        (1, b"# Momentum\n"),
        (1, b"print('v1')\n"),
        (2, b"print('v2')\n"),
    ]
    assert client.get("/strategies/1/permissions", headers=ada).json() == {
        "read": {"public": True, "fund": False, "users": []},
        "write": {
            "public": False,
            "fund": False,
            "users": [
                {"netid": "ada", "full_name": "Ada Lovelace", "uconn_email": "ada@uconn.edu"}
            ],
        },
        "canRead": True,
        "canWrite": True,
    }

    # New strategies continue from the AWS counter.
    branch = {"source_strategy_id": "1", "name": "Next", "readme_content": "# Next"}
    created = client.post("/strategies", json=branch, headers=ada)
    assert (created.status_code, created.json()["id"]) == (201, "10")

    run = client.get(f"/strategies/1/backtests/{RUN_ID}", headers=ada).json()
    assert run["item"] == {
        "strategy_id": "1",
        "run_id": RUN_ID,
        "name": "Agile Badger",
        "time_created": "2026-02-04T10:00:00.250000+00:00",
        "user": "ada",
        "strategy_version": 2,
        "backtest_params": {
            "start_date": "2024-01-01",
            "end_date": "2024-06-30",
            "initial_capital": 100000,
        },
        "metrics": {"sharpe_ratio": 1.5, "total_orders": 12},
        "net_pnl": 1234.5,
        "sharpe": 1.5,
        "trades_count": 12,
        "s3_bucket": "backtests",
        "s3_key": f"strategies/1/runs/{RUN_ID}/run.json.gz",
    }
    payload = client.get(run["s3"]["download_url"])
    assert json.loads(gzip.decompress(payload.content)) == PAYLOAD

    # The engine downloads its registered package from the dashboard instead of S3.
    url = f"/internal/v1/accounts/{ACCOUNT}/strategy-packages/{DIGEST}"
    response = client.get(url, headers={"Authorization": f"Bearer {SERVICE_SECRET}"})
    assert (response.status_code, response.json()) == (200, PACKAGE)
    status = client.get(f"/accounts/{ACCOUNT}/status", headers=ada).json()
    assert status["control_version"] == 1


def test_missing_and_orphaned_data_is_skipped_with_warnings(aws, db):
    aws.put("strategies_table_name", {"id": "1", "current_version": Decimal(1)})
    aws.put(
        "strategy_artifacts_table_name",
        {"strategy_id": "1", "artifact_id": "main.py", "latest_version": Decimal(1)},
        {"strategy_id": "2", "artifact_id": "main.py", "latest_version": Decimal(1)},
    )
    aws.put(
        "strategy_artifact_versions_table_name",
        {"strategy_artifact_id": "1#main.py", "strategy_version": Decimal(1), "s3_key": "gone"},
        {"strategy_artifact_id": "1#old.py", "strategy_version": Decimal(1), "s3_key": "gone"},
    )
    aws.put("strategies_read_permissions_table_name", {"strategy_id": "2", "principal": "USER#x"})
    aws.put(
        "strategy_backtests_table_name",
        {"strategy_id": "1", "run_id": "01A", "backtest_params": {}},
        {"strategy_id": "2", "run_id": "01B", "backtest_params": {}},
    )
    aws.put(
        "engine_accounts_table",
        {
            "account_id": ACCOUNT,
            "record": "package#" + DIGEST,
            "body": json.dumps({"key": "gone", "version_id": "missing"}),
        },
    )

    summary = run_import(db)
    assert sorted(summary.warnings) == sorted(
        [
            "Skipped main.py of strategy 2: no such strategy",
            "Skipped main.py v1 of strategy 1: its S3 object is missing",
            "Skipped old.py v1 of strategy 1: the file is not listed",
            "Skipped read access for USER#x: no strategy 2",
            "Backtest 01A of strategy 1 has no saved results",
            "Skipped backtest 01B: no strategy 2",
            f"Skipped package {DIGEST} of account {ACCOUNT}: its S3 object is missing",
        ]
    )
    (strategy,) = execute(db, "SELECT name, entrypoint FROM strategies")
    assert strategy == {"name": "Strategy 1", "entrypoint": "main.py"}
    assert execute(db, "SELECT run_id FROM backtest_runs") == [{"run_id": "01A"}]


def test_import_refuses_to_mix_with_existing_data(deployment, db):
    add_user(db, "local")
    kid = SigningKeys(db, token_lifetime_seconds=86400).rotate()
    with pytest.raises(ImportFailed, match="--replace"):
        run_import(db)
    assert execute(db, "SELECT netid FROM users") == [{"netid": "local"}]

    # Replacing deletes the data but keeps the signing keys, so sessions stay valid.
    run_import(db, replace=True)
    users = execute(db, "SELECT netid FROM users ORDER BY netid")
    assert users == [{"netid": "ada"}, {"netid": "bob"}]
    assert execute(db, "SELECT kid FROM jwt_signing_keys") == [{"kid": kid}]


def test_failed_imports_change_nothing(deployment, db):
    for item in deployment.s3.list_objects_v2(Bucket=BACKTESTS_BUCKET)["Contents"]:
        deployment.s3.delete_object(Bucket=BACKTESTS_BUCKET, Key=item["Key"])
    deployment.s3.delete_bucket(Bucket=BACKTESTS_BUCKET)
    with pytest.raises(ImportFailed, match="NoSuchBucket"):
        run_import(db)
    assert execute(db, "SELECT count(*) FROM users") == [{"count": 0}]


def test_the_signing_key_parameter_must_hold_a_key(aws, db):
    aws.ssm.put_parameter(Name=JWT_KEY_PARAMETER, Type="SecureString", Value="not a key")
    with pytest.raises(ImportFailed, match="does not hold a private key"):
        run_import(db, jwt_key_parameter=JWT_KEY_PARAMETER)
    assert execute(db, "SELECT count(*) FROM jwt_signing_keys") == [{"count": 0}]


def test_outputs_must_name_every_table_and_bucket():
    outputs = dict(TERRAFORM_OUTPUTS)
    del outputs["engine_accounts_table"]
    with pytest.raises(ImportFailed, match="engine_accounts_table"):
        AwsDeployment.from_terraform_outputs(outputs)


def test_cli(deployment, db, database_url, tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("DATABASE_URL", database_url)
    outputs = tmp_path / "outputs.json"
    outputs.write_text(json.dumps(TERRAFORM_OUTPUTS))
    assert main(["import-aws", "--terraform-outputs", str(outputs)]) == 0
    assert capsys.readouterr().out == (
        "Imported 2 users.\n"
        "Imported 2 access requests.\n"
        "Imported 1 strategies.\n"
        "Imported 3 file versions.\n"
        "Imported 2 permissions.\n"
        "Imported 1 backtests.\n"
        "Imported 3 account records.\n"
        "Import complete.\n"
    )

    assert main(["import-aws", "--terraform-outputs", str(outputs)]) == 1
    assert "Import failed: The database already holds dashboard data" in capsys.readouterr().err
    assert main(["import-aws", "--terraform-outputs", str(tmp_path / "missing.json")]) == 1
    assert "Import failed: " in capsys.readouterr().err
