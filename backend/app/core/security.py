"""Cryptographic primitives: JWT access tokens, opaque refresh tokens, hashing."""

import hashlib
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.config import Settings
from app.core.exceptions import Unauthorized

_hasher = PasswordHasher()
_ALGORITHM = "HS256"


def hash_secret(value: str) -> str:
    """Argon2id hash for passwords and OTP codes."""
    return _hasher.hash(value)


def verify_secret(value: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, value)
    except (VerificationError, InvalidHashError):
        return False


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def generate_otp(length: int = 6) -> str:
    return "".join(secrets.choice("0123456789") for _ in range(length))


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(48)


def create_access_token(
    settings: Settings, user_id: str, roles: list[str], extra: dict[str, Any] | None = None
) -> tuple[str, int]:
    now = datetime.now(UTC)
    ttl = timedelta(minutes=settings.access_token_ttl_minutes)
    payload: dict[str, Any] = {
        "sub": user_id,
        "roles": roles,
        "type": "access",
        "jti": uuid.uuid4().hex,
        "iat": int(now.timestamp()),
        "exp": int((now + ttl).timestamp()),
        "iss": settings.jwt_issuer,
        "aud": _audience(settings),
        **(extra or {}),
    }
    token = jwt.encode(payload, settings.jwt_secret, algorithm=_ALGORITHM)
    return token, int(ttl.total_seconds())


def _audience(settings: Settings) -> str:
    """Tokens are bound to one environment: a staging token never authenticates against production, even if
    the two were ever misconfigured to share a JWT secret."""
    return f"{settings.jwt_issuer}:{settings.app_env}"


def decode_access_token(settings: Settings, token: str) -> dict[str, Any]:
    try:
        payload: dict[str, Any] = jwt.decode(
            token,
            settings.jwt_secret,
            algorithms=[_ALGORITHM],
            issuer=settings.jwt_issuer,
            options={"require": ["exp", "sub", "iss", "type"], "verify_aud": False},
        )
        # Tokens minted before the audience claim existed (at most one access-token lifetime) are still accepted,
        # so the release signs nobody out. Any token that names an environment must name this one.
        if "aud" in payload and payload["aud"] != _audience(settings):
            raise jwt.InvalidAudienceError("token is for another environment")
    except jwt.ExpiredSignatureError as exc:
        raise Unauthorized("Access token expired", code="TOKEN_EXPIRED") from exc
    except jwt.PyJWTError as exc:
        raise Unauthorized("Invalid access token", code="TOKEN_INVALID") from exc
    if payload.get("type") != "access":
        raise Unauthorized("Invalid token type", code="TOKEN_INVALID")
    return payload
