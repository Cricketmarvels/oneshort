"""Tester sign-up mode: new accounts on fictional test numbers see their code; nothing else does."""

import httpx
import pytest

from app.core.config import Settings
from app.core.container import Container

API = "/api/v1"


@pytest.fixture
def tester_mode(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    s = container.settings.model_copy(update={"dev_otp_in_response": False, "tester_signup_prefix": "+447700900"})
    monkeypatch.setattr(container, "settings", s)


async def test_tester_signup_shows_code_only_for_new_test_numbers(
    client: httpx.AsyncClient, container: Container, tester_mode: None
) -> None:
    opts = (await client.get(f"{API}/auth/options")).json()["data"]
    assert opts["tester_signup_prefix"] == "+447700900"

    # password is required so the tester can come back by email
    r = await client.post(
        f"{API}/auth/register",
        json={"full_name": "Friend One", "mobile_number": "+447700900561", "email": "friend.one@example.in"},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "PASSWORD_REQUIRED"

    body = {
        "full_name": "Friend One",
        "mobile_number": "+447700900561",
        "email": "friend.one@example.in",
        "password": "FriendPass2026",
    }
    r = await client.post(f"{API}/auth/register", json=body)
    code = r.json()["data"]["otp"]["dev_otp"]
    assert code and len(code) == 6
    profile = {k: body[k] for k in ("full_name", "email", "password")}
    v = await client.post(
        f"{API}/auth/verify-otp",
        json={"mobile_number": body["mobile_number"], "code": code, "purpose": "register", "profile": profile},
    )
    assert v.status_code == 200 and v.json()["data"]["is_new_user"] is True
    assert (
        await client.post(f"{API}/auth/login", json={"email": body["email"], "password": body["password"]})
    ).status_code == 200

    # Signing up AGAIN on a taken test number shows no code either (it would open the existing account)
    await container.mongo["otp_codes"].delete_many({"kind": "send_log", "mobile_number": body["mobile_number"]})
    again = await client.post(f"{API}/auth/register", json={**body, "email": "someone.else@example.in"})
    assert again.status_code == 201 and again.json()["data"]["otp"]["dev_otp"] is None

    # LOGIN codes are never shown, so another tester can't enter this account by its number
    await container.mongo["otp_codes"].delete_many({"kind": "send_log", "mobile_number": body["mobile_number"]})
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": body["mobile_number"], "purpose": "login"})
    assert r.status_code == 200 and r.json()["data"]["dev_otp"] is None

    # real (non-test) numbers never see a code
    r = await client.post(
        f"{API}/auth/register",
        json={
            "full_name": "Real Person",
            "mobile_number": "+919812300777",
            "email": "real.person@example.in",
            "password": "RealPass2026",
        },
    )
    assert r.status_code == 201 and r.json()["data"]["otp"]["dev_otp"] is None


def test_tester_mode_refused_in_production() -> None:
    with pytest.raises(ValueError, match="TESTER_SIGNUP_PREFIX"):
        Settings(
            app_env="production",
            jwt_secret="x" * 40,
            otp_provider="msg91",
            whatsapp_provider="meta",
            debug=False,
            tester_signup_prefix="+447700900",
            legal_entity_name="a",
            legal_entity_address="b",
            grievance_officer_name="c",
            grievance_email="d@e.in",
        )


def test_blank_tester_prefix_means_off() -> None:
    assert Settings(tester_signup_prefix="").tester_signup_prefix is None
    assert Settings(tester_signup_prefix="   ").tester_signup_prefix is None
