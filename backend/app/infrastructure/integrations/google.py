"""Google Sign-In: verifying the ID token the app gets from the native Google SDK.

The backend never trusts anything the client says about the Google account. It verifies the token's signature
against Google's published keys, the issuer, the audience (one of OUR OAuth client ids), the expiry and takes the
stable subject (``sub``) as the identity. ``email_verified`` is Google's claim, used only to decide whether the
address can be treated as proven on our side.

Configure with GOOGLE_CLIENT_IDS (comma-separated: the Web client id the app is configured with, plus the iOS and
Android client ids). Unset = Google sign-in is off and /auth/options says so.
"""

from dataclasses import dataclass
from typing import Any, Protocol

from google.auth.exceptions import GoogleAuthError
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from app.core.config import Settings
from app.core.exceptions import Unauthorized

ISSUERS = ("https://accounts.google.com", "accounts.google.com")


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str | None
    email_verified: bool
    name: str | None
    picture: str | None


class GoogleVerifier(Protocol):
    configured: bool

    def verify(self, token: str) -> GoogleIdentity: ...


class DisabledGoogle:
    configured = False

    def verify(self, token: str) -> GoogleIdentity:
        raise Unauthorized("Google sign-in isn't available", code="GOOGLE_UNAVAILABLE")


class GoogleAuthVerifier:
    """Real verification through google-auth (fetches and caches Google's signing keys)."""

    configured = True

    def __init__(self, audiences: list[str]) -> None:
        self._aud = audiences
        self._req = google_requests.Request()

    def verify(self, token: str) -> GoogleIdentity:
        try:
            claims: dict[str, Any] = google_id_token.verify_oauth2_token(  # type: ignore[no-untyped-call]
                token, self._req, audience=self._aud
            )
        except (ValueError, GoogleAuthError) as exc:  # bad signature, wrong audience, expired, malformed
            raise Unauthorized("Google sign-in couldn't be verified. Try again.", code="GOOGLE_TOKEN_INVALID") from exc
        return identity_from_claims(claims)


def identity_from_claims(claims: dict[str, Any]) -> GoogleIdentity:
    if claims.get("iss") not in ISSUERS or not claims.get("sub"):
        raise Unauthorized("Google sign-in couldn't be verified. Try again.", code="GOOGLE_TOKEN_INVALID")
    email = claims.get("email")
    return GoogleIdentity(
        sub=str(claims["sub"]),
        email=str(email).lower() if email else None,
        email_verified=bool(claims.get("email_verified")) and bool(email),
        name=(claims.get("name") or None),
        picture=(claims.get("picture") or None),
    )


def build_google(settings: Settings) -> GoogleVerifier:
    ids = settings.google_audiences
    return GoogleAuthVerifier(ids) if ids else DisabledGoogle()
