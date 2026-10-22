"""Test-only AWS schemas, synthetic credentials and real Lambda handler loading."""

import importlib.util
import os
from pathlib import Path
import sys

for key, value in {
    "AWS_ACCESS_KEY_ID": "testing",
    "AWS_SECRET_ACCESS_KEY": "testing",
    "AWS_SESSION_TOKEN": "testing",
    "AWS_DEFAULT_REGION": "us-east-1",
    "AWS_EC2_METADATA_DISABLED": "true",
    "AWS_SHARED_CREDENTIALS_FILE": "/dev/null",
    "AWS_CONFIG_FILE": "/dev/null",
}.items():
    os.environ[key] = value
os.environ.pop("AWS_PROFILE", None)
os.environ.pop("AWS_DEFAULT_PROFILE", None)
ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "aws/lambdas/accounts"))
sys.path.insert(0, str(ROOT / "aws/lambda_layers/hqg_permissions/python"))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def setup_aws():
    import boto3
    from moto import mock_aws

    context = mock_aws()
    context.start()
    dynamo = boto3.resource("dynamodb")
    schemas = {
        "ACCOUNTS_TABLE": [("account_id", "S"), ("record", "S")],
        "STRATEGIES_TABLE": [("id", "S")],
        "STRATEGY_ARTIFACTS_TABLE": [("strategy_id", "S"), ("artifact_id", "S")],
        "STRATEGY_ARTIFACT_VERSIONS_TABLE": [
            ("strategy_artifact_id", "S"),
            ("strategy_version", "N"),
        ],
        "STRATEGIES_READ_PERMISSIONS_TABLE": [("strategy_id", "S"), ("principal", "S")],
        "STRATEGIES_WRITE_PERMISSIONS_TABLE": [
            ("strategy_id", "S"),
            ("principal", "S"),
        ],
        "COUNTERS_TABLE": [("counter_name", "S")],
        "USERS_TABLE": [("netid", "S")],
    }
    for env, keys in schemas.items():
        os.environ[env] = env.lower()
        dynamo.create_table(
            TableName=env.lower(),
            BillingMode="PAY_PER_REQUEST",
            KeySchema=[
                {"AttributeName": name, "KeyType": "HASH" if i == 0 else "RANGE"}
                for i, (name, _) in enumerate(keys)
            ],
            AttributeDefinitions=[
                {"AttributeName": name, "AttributeType": typ} for name, typ in keys
            ],
        )
    os.environ["ARTIFACT_BUCKET"] = "test-strategy-artifacts"
    s3 = boto3.client("s3")
    s3.create_bucket(Bucket=os.environ["ARTIFACT_BUCKET"])
    s3.put_bucket_versioning(
        Bucket=os.environ["ARTIFACT_BUCKET"],
        VersioningConfiguration={"Status": "Enabled"},
    )
    return context, dynamo, s3


def seed_package(dynamo, s3, package):
    sid, version = package["strategy_id"], package["version"]
    dynamo.Table(os.environ["STRATEGIES_TABLE"]).put_item(
        Item={
            "id": sid,
            "current_version": version,
            "entrypoint": package["entrypoint"],
        }
    )
    dynamo.Table(os.environ["STRATEGIES_WRITE_PERMISSIONS_TABLE"]).put_item(
        Item={
            "strategy_id": sid,
            "principal": "USER#operator",
        }
    )
    for path, content in package["files"].items():
        key = f"{sid}/v{version}/{path}"
        result = s3.put_object(
            Bucket=os.environ["ARTIFACT_BUCKET"], Key=key, Body=content.encode()
        )
        dynamo.Table(os.environ["STRATEGY_ARTIFACTS_TABLE"]).put_item(
            Item={
                "strategy_id": sid,
                "artifact_id": path,
                "latest_version": version,
            }
        )
        dynamo.Table(os.environ["STRATEGY_ARTIFACT_VERSIONS_TABLE"]).put_item(
            Item={
                "strategy_artifact_id": f"{sid}#{path}",
                "strategy_version": version,
                "s3_key": key,
                "s3_version_id": result["VersionId"],
            }
        )
