"""JWT signing keys: monthly rotation, retention of retired keys and the JWKS."""

from __future__ import annotations

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import jwt

from hqg_dashboard.auth.keys import KeyRotationThread, SigningKeys, thumbprint

APRIL = datetime(2026, 4, 1, tzinfo=UTC)


def kids(keys: SigningKeys) -> list[str]:
    return [key["kid"] for key in keys.jwks()["keys"]]


def session_token(keys: SigningKeys) -> str:
    now = int(time.time())
    return keys.sign({"sub": "alice", "iat": now, "exp": now + 3600})


def test_rfc_7638_thumbprint():
    # The example key from RFC 7638, section 3.1.
    n = (
        "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1"
        "L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4"
        "QyQ5v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbO"
        "pbISD08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csF"
        "Cur-kEgU8awapJzKnqDKgw"
    )
    jwk = {"kty": "RSA", "e": "AQAB", "n": n}
    assert thumbprint(jwk) == "NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs"


def test_keys_rotate_monthly_and_retire_after_their_tokens_expire(db):
    keys = SigningKeys(db, token_lifetime_seconds=86400)
    march_key = keys.rotate_if_due(APRIL - timedelta(days=17))
    assert march_key
    assert keys.rotate_if_due(APRIL - timedelta(seconds=1)) is None
    march_token = session_token(keys)

    april_key = keys.rotate_if_due(APRIL)
    assert april_key and april_key != march_key
    assert kids(keys) == [march_key, april_key]
    assert jwt.get_unverified_header(session_token(keys))["kid"] == april_key
    assert keys.verify(march_token, require=["exp", "sub"])["sub"] == "alice"

    # Retired keys stay published for the token lifetime plus an hour.
    keys.rotate_if_due(APRIL + timedelta(hours=25))
    assert kids(keys) == [march_key, april_key]
    keys.rotate_if_due(APRIL + timedelta(hours=25, seconds=1))
    assert kids(keys) == [april_key]
    assert keys.verify(march_token, require=["exp", "sub"]) is None


def test_published_keys_describe_rs256_signing_keys(db):
    keys = SigningKeys(db, token_lifetime_seconds=86400)
    kid = keys.rotate(APRIL)
    (jwk,) = keys.jwks()["keys"]
    assert jwk == {
        "kty": "RSA",
        "use": "sig",
        "alg": "RS256",
        "n": jwk["n"],
        "e": "AQAB",
        "kid": kid,
        "created_at": "2026-04-01T00:00:00Z",
    }
    assert thumbprint(jwk) == kid


def test_concurrent_rotation_checks_create_one_key(db):
    keys = SigningKeys(db, token_lifetime_seconds=86400)
    with ThreadPoolExecutor(max_workers=3) as pool:
        created = list(pool.map(lambda _: keys.rotate_if_due(APRIL), range(3)))
    assert len([kid for kid in created if kid]) == 1
    assert len(kids(keys)) == 1


def test_tokens_need_a_published_key(db):
    keys = SigningKeys(db, token_lifetime_seconds=86400)
    keys.rotate()
    token = session_token(keys)
    header, payload, signature = token.split(".")
    assert keys.verify(f"{header}.{payload}.{signature[::-1]}", require=["exp"]) is None
    db_keys = SigningKeys(db, token_lifetime_seconds=86400)
    assert db_keys.verify(token, require=["exp", "sub"])["sub"] == "alice"
    unsigned = jwt.encode(
        {"sub": "alice", "exp": int(time.time()) + 60}, key=None, algorithm="none"
    )
    assert keys.verify(unsigned, require=["exp"]) is None


def test_rotation_thread_keeps_checking_after_errors():
    checks = []
    checked_again = threading.Event()

    class FlakyKeys:
        def rotate_if_due(self):
            checks.append(time.monotonic())
            if len(checks) == 1:
                raise RuntimeError("database unavailable")
            checked_again.set()

    thread = KeyRotationThread(FlakyKeys(), interval_seconds=0.01)
    thread.start()
    assert checked_again.wait(timeout=5)
    thread.stop()
