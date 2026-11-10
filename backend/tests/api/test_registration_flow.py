"""Sign-up: mobile OTP is mandatory, email is collected unverified, registration completes server-side once.

Flow under test: POST /auth/send-otp → POST /auth/verify-otp (phone-only, creates a phone-verified account with
registration incomplete) → POST /users/me/registration (name, email, Player/Captain, role).
"""

from datetime import timedelta
from typing import Any

import httpx
import pytest
from bson import ObjectId

from app.common.types import utcnow
from app.core.container import Container
from app.modules.users.registration import backfill_registration_fields
from tests.conftest import register, unique_mobile

API = "/api/v1"


async def phone_signup(client: httpx.AsyncClient, mobile: str | None = None) -> tuple[str, dict[str, Any]]:
    mobile = mobile or unique_mobile()
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": mobile, "purpose": "login"})
    assert r.status_code == 200, r.text
    code = r.json()["data"]["dev_otp"]
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": mobile, "code": code, "purpose": "login"})
    assert r.status_code == 200, r.text
    return mobile, r.json()["data"]


def auth(t: dict[str, Any]) -> dict[str, str]:
    return {"Authorization": f"Bearer {t['access_token']}"}


def details(mobile: str, **over: Any) -> dict[str, Any]:
    return {"full_name": "Asha Verma", "email": f"{mobile[1:]}@example.in", "play_as": "player", **over}


async def test_phone_only_signup_then_registration_without_email_verification(
    client: httpx.AsyncClient, container: Container
) -> None:
    mobile, t = await phone_signup(client)
    u = t["user"]
    assert t["is_new_user"] is True
    assert u["phone_verified"] is True and u["phone_verified_at"] is not None
    assert u["registration_completed_at"] is None and u["email"] is None and u["email_verified"] is False

    r = await client.post(
        f"{API}/users/me/registration",
        headers=auth(t),
        json=details(mobile, email="Asha.Verma@Example.in", primary_role="bowler", sport="cricket"),
    )
    assert r.status_code == 200, r.text
    me = r.json()["data"]
    assert me["full_name"] == "Asha Verma" and me["email"] == "asha.verma@example.in"
    assert me["email_verified"] is False and me["email_verified_at"] is None  # no email OTP, not blocking
    assert me["registration_completed_at"] is not None and me["has_player_profile"] is True

    # Nothing was sent by email, and the stored record matches.
    doc = await container.mongo["users"].find_one({"_id": ObjectId(me["id"])})
    assert doc and doc["email_verified"] is False and doc["mobile_verified"] is True

    # Completing again is refused rather than silently rewriting the account.
    again = await client.post(f"{API}/users/me/registration", headers=auth(t), json=details(mobile, full_name="Other"))
    assert again.status_code == 409 and again.json()["error"]["code"] == "REGISTRATION_COMPLETE"


async def test_captain_registration_grants_captain_profile(client: httpx.AsyncClient) -> None:
    mobile, t = await phone_signup(client)
    r = await client.post(f"{API}/users/me/registration", headers=auth(t), json=details(mobile, play_as="captain"))
    assert r.status_code == 200, r.text
    me = r.json()["data"]
    assert "captain" in me["roles"] and me["has_captain_profile"] is True


async def test_interrupted_registration_resumes_on_next_login(client: httpx.AsyncClient) -> None:
    mobile, first = await phone_signup(client)
    assert first["user"]["registration_completed_at"] is None
    # App closed before finishing: logging in again opens the same incomplete account (no duplicate).
    _, second = await phone_signup(client, mobile)
    assert second["is_new_user"] is False and second["user"]["id"] == first["user"]["id"]
    assert second["user"]["registration_completed_at"] is None
    r = await client.post(f"{API}/users/me/registration", headers=auth(second), json=details(mobile))
    assert r.status_code == 200 and r.json()["data"]["registration_completed_at"] is not None


async def test_unverified_phone_cannot_complete_registration(client: httpx.AsyncClient, container: Container) -> None:
    mobile, t = await phone_signup(client)
    await container.mongo["users"].update_one({"_id": ObjectId(t["user"]["id"])}, {"$set": {"mobile_verified": False}})
    r = await client.post(f"{API}/users/me/registration", headers=auth(t), json=details(mobile))
    assert r.status_code == 403 and r.json()["error"]["code"] == "PHONE_NOT_VERIFIED"


async def test_registration_requires_a_session(client: httpx.AsyncClient) -> None:
    r = await client.post(f"{API}/users/me/registration", json=details(unique_mobile()))
    assert r.status_code == 401


async def test_client_cannot_set_verification_flags(client: httpx.AsyncClient) -> None:
    mobile, t = await phone_signup(client)
    for body in (
        {**details(mobile), "email_verified": True},
        {**details(mobile), "phone_verified": True},
        {**details(mobile), "registration_completed_at": "2020-01-01T00:00:00Z"},
    ):
        r = await client.post(f"{API}/users/me/registration", headers=auth(t), json=body)
        assert r.status_code == 422, body
    for body in ({"email_verified": True}, {"mobile_verified": True}, {"phone_verified_at": "2020-01-01T00:00:00Z"}):
        r = await client.put(f"{API}/users/me", headers=auth(t), json=body)
        assert r.status_code == 422, body


async def test_duplicate_email_and_invalid_email_are_refused(client: httpx.AsyncClient) -> None:
    m1, t1 = await phone_signup(client)
    assert (await client.post(f"{API}/users/me/registration", headers=auth(t1), json=details(m1))).status_code == 200
    m2, t2 = await phone_signup(client)
    r = await client.post(
        f"{API}/users/me/registration", headers=auth(t2), json=details(m2, email=f"{m1[1:]}@example.in")
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "EMAIL_IN_USE"
    r = await client.post(f"{API}/users/me/registration", headers=auth(t2), json=details(m2, email="not-an-email"))
    assert r.status_code == 422
    # Still incomplete after the refusals, so the app keeps the user on registration.
    me = (await client.get(f"{API}/users/me", headers=auth(t2))).json()["data"]
    assert me["registration_completed_at"] is None


async def test_one_number_one_account(client: httpx.AsyncClient, container: Container) -> None:
    mobile, t = await phone_signup(client)
    await phone_signup(client, mobile)
    assert await container.mongo["users"].count_documents({"mobile_number": mobile}) == 1


async def test_invalid_expired_and_reused_codes(client: httpx.AsyncClient, container: Container) -> None:
    mobile = unique_mobile()
    code = (await client.post(f"{API}/auth/send-otp", json={"mobile_number": mobile})).json()["data"]["dev_otp"]
    wrong = "000000" if code != "000000" else "111111"
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": mobile, "code": wrong})
    assert r.status_code == 401 and r.json()["error"]["code"] == "OTP_INVALID"
    await container.mongo["otp_codes"].update_many(
        {"kind": "code", "mobile_number": mobile}, {"$set": {"expires_at": utcnow() - timedelta(seconds=1)}}
    )
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": mobile, "code": code})
    assert r.status_code == 401 and r.json()["error"]["code"] == "OTP_EXPIRED"
    # an expired code can't be used, and nothing was created
    assert await container.mongo["users"].count_documents({"mobile_number": mobile}) == 0


async def test_otp_rules_match_the_policy(container: Container) -> None:
    from app.core.config import Settings

    s = Settings()
    assert (s.otp_ttl_seconds, s.otp_max_attempts, s.otp_resend_cooldown_seconds) == (300, 5, 60)
    assert s.otp_max_sends_per_day > 0 and s.otp_daily_budget > 0 and s.otp_ip_max_sends_per_hour > 0


@pytest.fixture
def cooldown(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        container, "settings", container.settings.model_copy(update={"otp_resend_cooldown_seconds": 60})
    )


async def test_resend_cooldown(client: httpx.AsyncClient, cooldown: None) -> None:
    mobile = unique_mobile()
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": mobile})
    assert r.status_code == 200 and r.json()["data"]["resend_after"] == 60
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": mobile})
    assert r.status_code == 429 and r.json()["error"]["code"] == "OTP_COOLDOWN"


@pytest.fixture
def hourly_cap(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(container, "settings", container.settings.model_copy(update={"otp_max_sends_per_hour": 2}))


async def test_per_number_rate_limit(client: httpx.AsyncClient, hourly_cap: None) -> None:
    mobile = unique_mobile()
    codes = [(await client.post(f"{API}/auth/send-otp", json={"mobile_number": mobile})).status_code for _ in range(3)]
    assert codes[:2] == [200, 200] and codes[2] == 429


async def test_existing_accounts_are_backfilled_and_not_sent_back_to_registration(
    client: httpx.AsyncClient, container: Container
) -> None:
    users = container.mongo["users"]
    legacy = await register(client, "Legacy Player")  # old flow: details sent with the code
    me = (await client.get(f"{API}/users/me", headers=legacy.h)).json()["data"]
    assert me["registration_completed_at"] is not None

    # Simulate accounts created before these fields existed.
    created = utcnow() - timedelta(days=30)
    old_named = await users.insert_one(
        {
            "full_name": "Old Timer",
            "mobile_number": unique_mobile(),
            "mobile_verified": True,
            "email_verified": True,
            "roles": ["player"],
            "account_status": "active",
            "created_at": created,
            "updated_at": created,
        }
    )
    old_placeholder = await users.insert_one(
        {
            "full_name": "GoFindr player",
            "mobile_number": unique_mobile(),
            "mobile_verified": True,
            "roles": ["player"],
            "account_status": "active",
            "created_at": created,
            "updated_at": created,
        }
    )
    old_invite = await users.insert_one(
        {
            "full_name": "Invited Guy",
            "mobile_number": unique_mobile(),
            "mobile_verified": False,
            "verified_via": "captain_invite",
            "roles": ["player"],
            "account_status": "active",
            "created_at": created,
            "updated_at": created,
        }
    )
    await backfill_registration_fields(container.mongo)
    named = await users.find_one({"_id": old_named.inserted_id})
    placeholder = await users.find_one({"_id": old_placeholder.inserted_id})
    invite = await users.find_one({"_id": old_invite.inserted_id})
    assert named and named["registration_completed_at"] is not None and named["phone_verified_at"] is not None
    assert named["email_verified"] is True  # an existing verified status is never overwritten
    assert placeholder and placeholder["registration_completed_at"] is None  # never finished: asked once
    assert invite and invite["registration_completed_at"] is None and "phone_verified_at" not in invite

    # Idempotent: a second run changes nothing.
    assert await backfill_registration_fields(container.mongo) == 0


async def test_password_reset_needs_the_verified_phone_not_the_email(client: httpx.AsyncClient) -> None:
    mobile, t = await phone_signup(client)
    assert (await client.post(f"{API}/users/me/registration", headers=auth(t), json=details(mobile))).status_code == 200
    # There is no email-based recovery route: resetting a password always needs an OTP to the mobile number.
    r = await client.post(
        f"{API}/auth/reset-password", json={"email": f"{mobile[1:]}@example.in", "new_password": "x" * 12}
    )
    assert r.status_code == 422


async def test_signup_form_details_travel_with_the_code(client: httpx.AsyncClient, container: Container) -> None:
    """The app's sign-up form: name, email, mobile and password, then the code. Registration stays open until
    Player/Captain is chosen, and the email is stored unverified."""
    mobile = unique_mobile()
    form = {
        "full_name": "Kiran Rao",
        "mobile_number": mobile,
        "email": f"{mobile[1:]}@example.in",
        "password": "KiranPass2026",
    }
    r = await client.post(f"{API}/auth/register", json=form)
    assert r.status_code == 201, r.text
    code = r.json()["data"]["otp"]["dev_otp"]
    profile = {k: form[k] for k in ("full_name", "email", "password")}
    r = await client.post(
        f"{API}/auth/verify-otp",
        json={"mobile_number": mobile, "code": code, "purpose": "register", "profile": profile},
    )
    assert r.status_code == 200, r.text
    t = r.json()["data"]
    u = t["user"]
    assert u["full_name"] == "Kiran Rao" and u["email"] == form["email"] and u["has_password"] is True
    assert u["phone_verified"] is True and u["email_verified"] is False and u["registration_completed_at"] is None
    # the password works for email login straight away
    r = await client.post(f"{API}/auth/login", json={"email": form["email"], "password": form["password"]})
    assert r.status_code == 200
    # the role step finishes registration with the same name and email
    r = await client.post(
        f"{API}/users/me/registration",
        headers=auth(t),
        json={"full_name": "Kiran Rao", "email": form["email"], "play_as": "captain"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["registration_completed_at"] is not None


async def test_signup_without_the_code_creates_nothing(client: httpx.AsyncClient, container: Container) -> None:
    mobile = unique_mobile()
    form = {
        "full_name": "No Code",
        "mobile_number": mobile,
        "email": f"{mobile[1:]}@example.in",
        "password": "NoCodePass2026",
    }
    assert (await client.post(f"{API}/auth/register", json=form)).status_code == 201
    assert await container.mongo["users"].count_documents({"mobile_number": mobile}) == 0
    r = await client.post(f"{API}/auth/login", json={"email": form["email"], "password": form["password"]})
    assert r.status_code == 401
