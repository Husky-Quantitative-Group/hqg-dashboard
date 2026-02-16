import base64
import hashlib
import json
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

import boto3
from botocore.exceptions import ClientError

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa


JWT_PRIVATE_KEY_PARAMETER = os.environ["JWT_PRIVATE_KEY_PARAMETER"]
JWKS_BUCKET = os.environ["JWKS_BUCKET"]
JWKS_KEY = ".well-known/jwks.json"

ssm = boto3.client("ssm")
s3 = boto3.client("s3")


def handler(_event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    created_at = now.isoformat().replace("+00:00", "Z")

    existing_jwks = _load_existing_jwks()
    existing_keys = existing_jwks.get("keys") or []
    retained_keys = _prune_keys(existing_keys, now)

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    public_key = private_key.public_key()
    jwk = _public_key_to_jwk(public_key)
    jwk["created_at"] = created_at

    retained_keys = [key for key in retained_keys if key.get("kid") != jwk["kid"]]
    retained_keys.append(jwk)
    jwks = {"keys": retained_keys}

    ssm.put_parameter(
        Name=JWT_PRIVATE_KEY_PARAMETER,
        Value=private_pem,
        Type="SecureString",
        Overwrite=True,
    )

    s3.put_object(
        Bucket=JWKS_BUCKET,
        Key=JWKS_KEY,
        Body=json.dumps(jwks, separators=(",", ":")).encode("utf-8"),
        ContentType="application/json",
        CacheControl="public, max-age=600",
    )

    return {
        "statusCode": 200,
        "body": json.dumps(
            {
                "kid": jwk["kid"],
                "jwks_bucket": JWKS_BUCKET,
                "jwks_key": JWKS_KEY,
            }
        ),
    }


def _load_existing_jwks() -> Dict[str, Any]:
    try:
        resp = s3.get_object(Bucket=JWKS_BUCKET, Key=JWKS_KEY)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in {"NoSuchKey", "NoSuchBucket"}:
            return {}
        raise

    try:
        body = resp["Body"].read().decode("utf-8")
        return json.loads(body)
    except Exception:
        return {}


def _parse_created_at(value: str) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed


def _prune_keys(keys: List[Dict[str, Any]], now: datetime) -> List[Dict[str, Any]]:
    cutoff = now - timedelta(days=1)
    retained: List[Dict[str, Any]] = []

    for key in keys:
        created_at = key.get("created_at")
        parsed = _parse_created_at(created_at) if created_at else None

        if parsed is None:
            key = dict(key)
            key["created_at"] = now.isoformat().replace("+00:00", "Z")
            retained.append(key)
            continue

        if parsed >= cutoff:
            retained.append(key)

    return retained


def _public_key_to_jwk(public_key) -> Dict[str, str]:
    numbers = public_key.public_numbers()
    n = _base64url_uint(numbers.n)
    e = _base64url_uint(numbers.e)

    jwk = {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "n": n,
        "e": e,
    }
    jwk["kid"] = _jwk_thumbprint(jwk)
    return jwk


def _base64url_uint(val: int) -> str:
    byte_length = (val.bit_length() + 7) // 8
    raw = val.to_bytes(byte_length, "big")
    return _base64url_bytes(raw)


def _base64url_bytes(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _jwk_thumbprint(jwk: Dict[str, str]) -> str:
    # RFC 7638 thumbprint for deterministic kid
    canonical = json.dumps(
        {"e": jwk["e"], "kty": jwk["kty"], "n": jwk["n"]},
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    digest = hashlib.sha256(canonical).digest()
    return _base64url_bytes(digest)
