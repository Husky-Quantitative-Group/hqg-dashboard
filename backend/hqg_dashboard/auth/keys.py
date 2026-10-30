"""RS256 signing keys: monthly rotation, the public JWKS, token signing and checks.

The AWS deployment kept the private key in SSM and the public keys in a JWKS
object on S3, and an EventBridge schedule rotated them at 00:00 UTC on the 1st
of every month. Both now live in PostgreSQL and the API rotates on the same
schedule. One change: a retired key stays published until every token it
signed has expired. The old rotator dropped it at once, which logged everyone
out each month.
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import threading
from datetime import datetime, timedelta
from typing import Any

import jwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from psycopg import Connection
from psycopg.types.json import Jsonb

from ..db import KEY_ROTATION_LOCK, Database
from ..serialization import utcnow

log = logging.getLogger(__name__)

ALGORITHM = "RS256"
# Retired keys outlive their last token by this margin, covering clock skew and leeway.
RETENTION_MARGIN = timedelta(hours=1)


class SigningKeys:
    def __init__(self, db: Database, token_lifetime_seconds: int) -> None:
        self.db = db
        self.retention = timedelta(seconds=token_lifetime_seconds) + RETENTION_MARGIN

    def rotate_if_due(self, now: datetime | None = None) -> str | None:
        """Create a key unless one was created this calendar month (UTC).

        Returns the new key id, or None when no rotation was due.
        """
        now = now or utcnow()
        start_of_month = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        with self.db.transaction() as conn:
            conn.execute("SELECT pg_advisory_xact_lock(%s)", [KEY_ROTATION_LOCK])
            newest = conn.execute("SELECT max(created_at) AS created_at FROM jwt_signing_keys")
            newest_created_at = newest.fetchone()["created_at"]
            kid = None
            if newest_created_at is None or newest_created_at < start_of_month:
                kid = self._add_key(conn, now)
            self._prune(conn, now)
        return kid

    def rotate(self, now: datetime | None = None) -> str:
        """Create a key and start signing with it immediately."""
        now = now or utcnow()
        with self.db.transaction() as conn:
            conn.execute("SELECT pg_advisory_xact_lock(%s)", [KEY_ROTATION_LOCK])
            kid = self._add_key(conn, now)
            self._prune(conn, now)
        return kid

    def jwks(self) -> dict[str, Any]:
        with self.db.transaction() as conn:
            rows = conn.execute("SELECT public_jwk FROM jwt_signing_keys ORDER BY created_at")
            return {"keys": [row["public_jwk"] for row in rows]}

    def sign(self, claims: dict[str, Any]) -> str:
        """Sign claims with the newest key, naming it in the kid header."""
        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT kid, private_key FROM jwt_signing_keys ORDER BY created_at DESC LIMIT 1"
            ).fetchone()
        if row is None:
            raise RuntimeError("No JWT signing key exists yet")
        return jwt.encode(
            claims, row["private_key"], algorithm=ALGORITHM, headers={"kid": row["kid"]}
        )

    def verify(
        self, token: str, *, require: list[str], audience: str | None = None
    ) -> dict[str, Any] | None:
        """Return the claims of a current token signed by a published key, else None."""
        try:
            kid = jwt.get_unverified_header(token).get("kid")
        except jwt.PyJWTError:
            return None
        if not isinstance(kid, str):
            return None

        with self.db.transaction() as conn:
            row = conn.execute(
                "SELECT public_jwk FROM jwt_signing_keys WHERE kid = %s", [kid]
            ).fetchone()
        if row is None:
            return None

        try:
            public_key = jwt.PyJWK(row["public_jwk"], algorithm=ALGORITHM).key
            return jwt.decode(
                token,
                public_key,
                algorithms=[ALGORITHM],
                audience=audience,
                options={"require": require},
            )
        except jwt.PyJWTError:
            return None

    def _add_key(self, conn: Connection, now: datetime) -> str:
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        kid = store_key(conn, private_key, now)
        log.info("Created JWT signing key %s", kid)
        return kid

    def _prune(self, conn: Connection, now: datetime) -> None:
        # A key retires when a newer one is created; its tokens expire within the retention.
        conn.execute(
            """
            DELETE FROM jwt_signing_keys AS retired
            WHERE EXISTS (
                SELECT 1
                FROM jwt_signing_keys AS newer
                WHERE newer.created_at > retired.created_at
                  AND newer.created_at < %s
            )
            """,
            [now - self.retention],
        )


class KeyRotationThread:
    """Checks hourly, in the background, whether the monthly key rotation is due."""

    def __init__(self, keys: SigningKeys, interval_seconds: float = 3600) -> None:
        self.keys = keys
        self.interval_seconds = interval_seconds
        self._stopped = threading.Event()
        self._thread = threading.Thread(target=self._run, name="jwt-key-rotation", daemon=True)

    def start(self) -> None:
        self._thread.start()

    def stop(self) -> None:
        self._stopped.set()
        self._thread.join()

    def _run(self) -> None:
        while not self._stopped.wait(self.interval_seconds):
            try:
                self.keys.rotate_if_due()
            except Exception:
                log.exception("JWT key rotation check failed")


def store_key(conn: Connection, private_key: rsa.RSAPrivateKey, created_at: datetime) -> str:
    """Publish a key; the newest key signs. Returns its key id. Storing a key twice is a no-op."""
    private_pem = private_key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    jwk = public_jwk(private_key.public_key())
    jwk["created_at"] = created_at.isoformat().replace("+00:00", "Z")
    conn.execute(
        """
        INSERT INTO jwt_signing_keys (kid, private_key, public_jwk, created_at)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (kid) DO NOTHING
        """,
        [jwk["kid"], private_pem, Jsonb(jwk), created_at],
    )
    return jwk["kid"]


def public_jwk(public_key: rsa.RSAPublicKey) -> dict[str, str]:
    numbers = public_key.public_numbers()
    jwk = {
        "kty": "RSA",
        "use": "sig",
        "alg": ALGORITHM,
        "n": _base64url_uint(numbers.n),
        "e": _base64url_uint(numbers.e),
    }
    jwk["kid"] = thumbprint(jwk)
    return jwk


def thumbprint(jwk: dict[str, str]) -> str:
    """The RFC 7638 thumbprint of an RSA JWK, used as its key id."""
    canonical = json.dumps(
        {"e": jwk["e"], "kty": jwk["kty"], "n": jwk["n"]},
        separators=(",", ":"),
        sort_keys=True,
    )
    return _base64url(hashlib.sha256(canonical.encode()).digest())


def _base64url_uint(value: int) -> str:
    return _base64url(value.to_bytes((value.bit_length() + 7) // 8, "big"))


def _base64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
