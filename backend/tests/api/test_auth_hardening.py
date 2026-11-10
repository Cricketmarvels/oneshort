"""Authentication audit regressions (2026-11-10): single-use codes under concurrency, atomic resend cooldown,
immediate cut-off of signed-out devices, environment-bound tokens, mobile-first sign-up and invite safety."""

import asyncio
from datetime import timedelta

import httpx
import jwt
import pytest

from app.common.types import utcnow
from app.core.config import Settings
from app.core.container import Container
from app.core.security import create_access_token
from tests.conftest import register, unique_mobile

API = "/api/v1"


async def _code(client: httpx.AsyncClient, mobile: str, purpose: str = "register") -> str:
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": mobile, "purpose": purpose})
    assert r.status_code == 200, r.text
    return str(r.json()["data"]["dev_otp"])


@pytest.fixture
def cooldown(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        container, "settings", container.settings.model_copy(update={"otp_resend_cooldown_seconds": 60})
    )


# ------------------------------------------------------------------ codes
async def test_a_code_opens_one_session_even_when_submitted_twice_at_once(client: httpx.AsyncClient) -> None:
    m = unique_mobile()
    code = await _code(client, m)
    body = {"mobile_number": m, "code": code, "purpose": "register"}
    results = await asyncio.gather(*(client.post(f"{API}/auth/verify-otp", json=body) for _ in range(4)))
    assert sorted(r.status_code for r in results) == [200, 401, 401, 401]


async def test_simultaneous_send_requests_send_one_code(client: httpx.AsyncClient, cooldown: None) -> None:
    m = unique_mobile()
    body = {"mobile_number": m, "purpose": "login"}
    results = await asyncio.gather(*(client.post(f"{API}/auth/send-otp", json=body) for _ in range(5)))
    codes = sorted(r.status_code for r in results)
    assert codes == [200, 429, 429, 429, 429]
    assert all(r.json()["error"]["code"] == "OTP_COOLDOWN" for r in results if r.status_code == 429)


async def test_failed_delivery_does_not_block_an_immediate_retry(
    client: httpx.AsyncClient, container: Container, cooldown: None, monkeypatch: pytest.MonkeyPatch
) -> None:
    class Timeout:
        exposes_code = True

        async def send(self, mobile: str, code: str) -> None:
            raise TimeoutError("provider timed out")

    real = container.otp_sender
    monkeypatch.setattr(container, "otp_sender", Timeout())
    m = unique_mobile()
    with pytest.raises(TimeoutError):  # surfaces as a 5xx in the app; the test client re-raises it
        await client.post(f"{API}/auth/send-otp", json={"mobile_number": m, "purpose": "login"})
    monkeypatch.setattr(container, "otp_sender", real)
    await container.mongo["otp_codes"].delete_many({"kind": "send_log", "mobile_number": m})
    assert (await client.post(f"{API}/auth/send-otp", json={"mobile_number": m, "purpose": "login"})).status_code == 200


async def test_expired_code_is_refused(client: httpx.AsyncClient, container: Container) -> None:
    m = unique_mobile()
    code = await _code(client, m)
    await container.mongo["otp_codes"].update_many(
        {"kind": "code", "mobile_number": m}, {"$set": {"expires_at": utcnow() - timedelta(seconds=1)}}
    )
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": m, "code": code, "purpose": "register"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "OTP_EXPIRED"


async def test_resend_cancels_the_previous_code(client: httpx.AsyncClient) -> None:
    m = unique_mobile()
    first = await _code(client, m)
    second = await _code(client, m)
    if first == second:  # one in a million: nothing to prove
        return
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": m, "code": first, "purpose": "register"})
    assert r.status_code == 401
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": m, "code": second, "purpose": "register"})
    assert r.status_code == 200


# ------------------------------------------------------------------ sign-up
async def test_mobile_first_signup_then_details_with_unverified_email(
    client: httpx.AsyncClient, container: Container
) -> None:
    m = unique_mobile()
    code = await _code(client, m)
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": m, "code": code, "purpose": "register"})
    d = r.json()["data"]
    assert r.status_code == 200 and d["is_new_user"] is True
    user = d["user"]
    assert user["phone_verified"] is True and user["registration_completed_at"] is None and user["email"] is None
    h = {"Authorization": f"Bearer {d['access_token']}"}
    email = f"k{m[1:]}@example.in"
    r = await client.post(
        f"{API}/users/me/registration",
        headers=h,
        json={"full_name": "Kavya Shah", "email": email, "play_as": "captain"},
    )
    assert r.status_code == 200, r.text
    doc = await container.mongo["users"].find_one({"mobile_number": m})
    assert doc and doc["email"] == email and doc["email_verified"] is False and doc["password_hash"] is None
    assert doc["registration_completed_at"] is not None


# ------------------------------------------------------------------ sessions
async def test_signing_out_one_device_stops_its_access_token_at_once(client: httpx.AsyncClient) -> None:
    u = await register(client, "Device Cutoff")
    rows = (await client.get(f"{API}/auth/sessions", headers=u.h)).json()["data"]
    mine = next(r["id"] for r in rows if r["current"])
    assert (await client.delete(f"{API}/auth/sessions/{mine}", headers=u.h)).status_code == 204
    r = await client.get(f"{API}/users/me", headers=u.h)
    assert r.status_code == 401 and r.json()["error"]["code"] == "TOKEN_REVOKED"


async def test_logout_stops_the_access_token_at_once(client: httpx.AsyncClient) -> None:
    u = await register(client, "Logout Cutoff")
    assert (await client.post(f"{API}/auth/logout", json={"refresh_token": u.refresh})).status_code == 204
    assert (await client.get(f"{API}/users/me", headers=u.h)).status_code == 401


async def test_refreshing_keeps_the_device_signed_in(client: httpx.AsyncClient) -> None:
    u = await register(client, "Refresh Keeper")
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": u.refresh})
    assert r.status_code == 200
    h = {"Authorization": f"Bearer {r.json()['data']['access_token']}"}
    assert (await client.get(f"{API}/users/me", headers=h)).status_code == 200
    assert (await client.get(f"{API}/users/me", headers=u.h)).status_code == 200  # rotation is not a sign-out


async def test_password_reset_stops_existing_access_tokens(client: httpx.AsyncClient) -> None:
    u = await register(client, "Reset Cutoff", password="ResetPass2026")
    await asyncio.sleep(1.1)  # iat has second resolution
    code = await _code(client, u.mobile, "reset_password")
    r = await client.post(
        f"{API}/auth/reset-password", json={"mobile_number": u.mobile, "code": code, "new_password": "NewReset2026"}
    )
    assert r.status_code == 204, r.text
    r = await client.get(f"{API}/users/me", headers=u.h)
    assert r.status_code == 401 and r.json()["error"]["code"] == "TOKEN_REVOKED"


# ------------------------------------------------------------------ environments
async def test_a_token_from_another_environment_is_refused(client: httpx.AsyncClient, container: Container) -> None:
    u = await register(client, "Env Bound")
    other_env = container.settings.model_copy(update={"app_env": "staging"})
    token, _ = create_access_token(other_env, u.id, ["player"])
    r = await client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 401 and r.json()["error"]["code"] == "TOKEN_INVALID"


async def test_tokens_from_before_the_audience_claim_still_work(
    client: httpx.AsyncClient, container: Container
) -> None:
    """The release must not sign anybody out: a token without an audience is accepted for its remaining life."""
    u = await register(client, "Legacy Token")
    s = container.settings
    now = utcnow()
    legacy = jwt.encode(
        {
            "sub": u.id,
            "roles": ["player"],
            "type": "access",
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=5)).timestamp()),
            "iss": s.jwt_issuer,
        },
        s.jwt_secret,
        algorithm="HS256",
    )
    assert (await client.get(f"{API}/users/me", headers={"Authorization": f"Bearer {legacy}"})).status_code == 200


def test_staging_refuses_weak_secrets_and_debug() -> None:
    with pytest.raises(ValueError, match="JWT_SECRET"):
        Settings(_env_file=None, app_env="staging", jwt_secret="short")  # type: ignore[call-arg]
    with pytest.raises(ValueError, match="DEBUG"):
        Settings(_env_file=None, app_env="staging", jwt_secret="s" * 40, debug=True)  # type: ignore[call-arg]


def test_production_refuses_every_test_only_auth_setting() -> None:
    base = {
        "_env_file": None,
        "app_env": "production",
        "jwt_secret": "p" * 40,
        "otp_provider": "msg91",
        "whatsapp_provider": "meta",
        "debug": False,
    }
    for bad in (
        {"otp_provider": "console"},
        {"whatsapp_provider": "simulator"},
        {"tester_signup_prefix": "+447700900"},
        {"jwt_secret": "change-me"},
    ):
        with pytest.raises(ValueError):
            Settings(**{**base, **bad})  # type: ignore[arg-type]


# ------------------------------------------------------------------ invitations
async def test_invite_link_signup_without_a_code_is_off(client: httpx.AsyncClient) -> None:
    r = await client.post(
        f"{API}/auth/invite-register",
        json={
            "code": "anything",
            "full_name": "Someone Else",
            "mobile_number": unique_mobile(),
            "email": "someone.else@example.in",
            "password": "Str0ngPassw0rd!",
        },
    )
    assert r.status_code == 410 and r.json()["error"]["code"] == "INVITE_REGISTER_DISABLED"


async def test_expired_invite_link_is_refused(client: httpx.AsyncClient, container: Container) -> None:
    from tests.api.test_competition import SECTOR_18, player, team
    from tests.conftest import future, make_match

    cap = await player(client, "Captain Exp", "all_rounder", SECTOR_18)
    tid = await team(client, cap, "Expired XI", SECTOR_18, [])
    match_id = (await make_match(client, cap, tid, start=future(3, 7), at=SECTOR_18, capacity=11))["id"]
    code = (await client.post(f"{API}/matches/{match_id}/invite-link", headers=cap.h)).json()["data"]["code"]
    await container.mongo["match_invite_links"].update_many(
        {"code": code}, {"$set": {"expires_at": utcnow() - timedelta(hours=1)}}
    )
    joiner = await register(client, "Late Joiner")
    await client.put(f"{API}/players/me", headers=joiner.h, json={"primary_role": "bowler"})
    r = await client.post(f"{API}/join/{code}", headers=joiner.h, json={})
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVITE_EXPIRED"


async def test_unproven_invite_signup_numbers_get_no_whatsapp() -> None:
    from app.modules.notifications.service import _whatsapp_number_ok

    assert not _whatsapp_number_ok({"mobile_number": "+919800000001", "verified_via": "captain_invite"})
    assert not _whatsapp_number_ok({"mobile_number": "+919800000001", "verified_via": "email"})
    assert _whatsapp_number_ok({"mobile_number": "+919800000001"})  # captain-added player: invites still go
    assert _whatsapp_number_ok({"mobile_number": "+919800000001", "verified_via": "email", "mobile_verified": True})
