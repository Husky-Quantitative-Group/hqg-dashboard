import base64
import hashlib
import json
import os
from typing import Any, Dict

import boto3

try:
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
except Exception as exc:  # pragma: no cover - fails fast in runtime if dependency missing
    raise RuntimeError(
        "cryptography is required for RSA key generation in jwt-key-rotator"
    ) from exc


JWT_PRIVATE_KEY_PARAMETER = os.environ["JWT_PRIVATE_KEY_PARAMETER"]
JWKS_BUCKET = os.environ["JWKS_BUCKET"]

ssm = boto3.client("ssm")
s3 = boto3.client("s3")


def handler(_event: Dict[str, Any], _context: Any) -> Dict[str, Any]:
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode("utf-8")

    public_key = private_key.public_key()
    jwk = _public_key_to_jwk(public_key)
    jwks = {"keys": [jwk]}

    ssm.put_parameter(
        Name=JWT_PRIVATE_KEY_PARAMETER,
        Value=private_pem,
        Type="SecureString",
        Overwrite=True,
    )

    s3.put_object(
        Bucket=JWKS_BUCKET,
        Key=".well-known/jwks.json",
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
                "jwks_key": ".well-known/jwks.json",
            }
        ),
    }


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
