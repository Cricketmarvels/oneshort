"""Account-takeover regressions (auth review C1/C2): credentials attached to a number nobody has
proven must never survive against the number's real owner."""

import httpx
import pytest

from app.core.container import Container
from tests.api.test_competition import SECTOR_18, player, team
from tests.conftest import future, make_match

API = "/api/v1"


@pytest.fixture(autouse=True)
def _legacy_invite_signup(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    """These tests cover existing invite-link accounts, so the (now off by default) sign-up is switched on."""
    monkeypatch.setattr(container, "settings", container.settings.model_copy(update={"invite_register_enabled": True}))


async def _login_otp(client: httpx.AsyncClient, container: Container, mobile: str) -> httpx.Response:
    # clear the send-log so the resend cooldown from registration doesn't slow the suite
    await container.mongo["otp_codes"].delete_many({"kind": "send_log", "mobile_number": mobile})
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": mobile, "purpose": "login"})
    assert r.status_code == 200, r.text
    code = r.json()["data"]["dev_otp"]
    return await client.post(f"{API}/auth/verify-otp", json={"mobile_number": mobile, "code": code, "purpose": "login"})


async def test_register_cannot_take_over_an_invite_account(client: httpx.AsyncClient) -> None:
    """C1: /auth/register with an invite-link account's number must not replace its credentials."""
    cap = await player(client, "Takeover Captain", "all_rounder", SECTOR_18)
    tid = await team(client, cap, "Takeover XI", SECTOR_18, [])
    mid = (await make_match(client, cap, tid, start=future(5, 7), at=SECTOR_18, capacity=11))["id"]
    code = (await client.post(f"{API}/matches/{mid}/invite-link", headers=cap.h)).json()["data"]["code"]
    victim = {
        "code": code,
        "full_name": "Invite Victim",
        "mobile_number": "+447700900931",
        "email": "invite.victim@example.in",
        "password": "VictimPass2026",
    }
    assert (await client.post(f"{API}/auth/invite-register", json=victim)).status_code == 201

    r = await client.post(
        f"{API}/auth/register",
        json={
            "full_name": "Attacker",
            "mobile_number": victim["mobile_number"],
            "email": "attacker.c1@example.in",
            "password": "AttackerPass2026",
        },
    )
    assert r.status_code == 201  # identical reply (H2); nothing changes until the code is verified
    # attacker's credentials never attached; the victim still signs in
    bad = await client.post(
        f"{API}/auth/login", json={"email": "attacker.c1@example.in", "password": "AttackerPass2026"}
    )
    assert bad.status_code == 401
    good = await client.post(f"{API}/auth/login", json={"email": victim["email"], "password": victim["password"]})
    assert good.status_code == 200


async def test_login_otp_removes_preverification_credentials(client: httpx.AsyncClient, container: Container) -> None:
    """C2: an attacker 'registers' a number with their own password. Nothing is stored until the code is
    verified, so the real owner's first OTP sign-in creates a clean account the attacker can't enter."""
    num = "+447700900932"
    r = await client.post(
        f"{API}/auth/register",
        json={
            "full_name": "Attacker",
            "mobile_number": num,
            "email": "attacker.c2@example.in",
            "password": "AttackerPass2026",
        },
    )
    assert r.status_code == 201 and r.json()["data"]["user_id"] is None
    assert await container.mongo["users"].count_documents({"mobile_number": num}) == 0

    owner = await _login_otp(client, container, num)
    assert owner.status_code == 200 and owner.json()["data"]["is_new_user"] is True
    assert owner.json()["data"]["user"]["email"] is None

    after = await client.post(
        f"{API}/auth/login", json={"email": "attacker.c2@example.in", "password": "AttackerPass2026"}
    )
    assert after.status_code == 401
    doc = await container.mongo["users"].find_one({"mobile_number": num})
    assert doc is not None and doc["password_hash"] is None and doc["mobile_verified"] is True


async def test_signup_details_come_from_the_verifier(client: httpx.AsyncClient, container: Container) -> None:
    """Race: the owner starts sign-up, then an attacker re-registers the number with their own details.
    The account gets whatever the person entering the code sends, never the attacker's form."""
    num = "+447700900935"
    owner_form = {"full_name": "Owner", "email": "owner.race@example.in", "password": "OwnerPass2026"}
    await client.post(f"{API}/auth/register", json={**owner_form, "mobile_number": num})
    await container.mongo["otp_codes"].delete_many({"kind": "send_log", "mobile_number": num})
    atk = await client.post(
        f"{API}/auth/register",
        json={
            "full_name": "Attacker",
            "mobile_number": num,
            "email": "atk.race@example.in",
            "password": "AttackerPass2026",
        },
    )
    code = atk.json()["data"]["otp"]["dev_otp"]  # the owner's phone receives the newest code
    v = await client.post(
        f"{API}/auth/verify-otp",
        json={"mobile_number": num, "code": code, "purpose": "register", "profile": owner_form},
    )
    assert v.status_code == 200 and v.json()["data"]["user"]["email"] == "owner.race@example.in"
    bad = await client.post(f"{API}/auth/login", json={"email": "atk.race@example.in", "password": "AttackerPass2026"})
    assert bad.status_code == 401
    good = await client.post(
        f"{API}/auth/login", json={"email": owner_form["email"], "password": owner_form["password"]}
    )
    assert good.status_code == 200


async def test_invite_account_otp_login_revokes_password_and_sessions(
    client: httpx.AsyncClient, container: Container
) -> None:
    """An invite-link account created by whoever held the link: once the number's owner proves it by OTP,
    the link-holder's password and any sessions it opened are dead."""
    cap = await player(client, "Takeover Captain B", "all_rounder", SECTOR_18)
    tid = await team(client, cap, "Takeover XI B", SECTOR_18, [])
    mid = (await make_match(client, cap, tid, start=future(5, 8), at=SECTOR_18, capacity=11))["id"]
    code = (await client.post(f"{API}/matches/{mid}/invite-link", headers=cap.h)).json()["data"]["code"]
    reg = await client.post(
        f"{API}/auth/invite-register",
        json={
            "code": code,
            "full_name": "Invite Holder",
            "mobile_number": "+447700900933",
            "email": "holder.c2b@example.in",
            "password": "HolderPass2026",
        },
    )
    assert reg.status_code == 201
    stale_refresh = reg.json()["data"]["refresh_token"]

    owner = await _login_otp(client, container, "+447700900933")
    assert owner.status_code == 200
    # password sign-in and the pre-verification session are both gone
    assert (
        await client.post(f"{API}/auth/login", json={"email": "holder.c2b@example.in", "password": "HolderPass2026"})
    ).status_code == 401
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": stale_refresh})
    assert r.status_code == 401


async def test_normal_registration_keeps_its_own_password(client: httpx.AsyncClient) -> None:
    """Regression: verifying your own registration (purpose=register) keeps the password you chose."""
    r = await client.post(
        f"{API}/auth/register",
        json={
            "full_name": "Honest Signup",
            "mobile_number": "+447700900934",
            "email": "honest.signup@example.in",
            "password": "HonestPass2026",
        },
    )
    code = r.json()["data"]["otp"]["dev_otp"]
    v = await client.post(
        f"{API}/auth/verify-otp",
        json={
            "mobile_number": "+447700900934",
            "code": code,
            "purpose": "register",
            "profile": {
                "full_name": "Honest Signup",
                "email": "honest.signup@example.in",
                "password": "HonestPass2026",
            },
        },
    )
    assert v.status_code == 200
    assert (
        await client.post(f"{API}/auth/login", json={"email": "honest.signup@example.in", "password": "HonestPass2026"})
    ).status_code == 200
