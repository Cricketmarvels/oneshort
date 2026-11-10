"""Create account with an email code instead of SMS; the mobile number stays unproven and is treated that way."""

import httpx
import pytest
from bson import ObjectId

from app.core.config import Settings
from app.core.container import Container
from tests.conftest import unique_mobile

API = "/api/v1"


def form(mobile: str | None = None, **over: str) -> dict[str, str]:
    m = mobile or unique_mobile()
    return {
        "full_name": "Meera Iyer",
        "email": f"e{m[1:]}@example.in",
        "mobile_number": m,
        "password": "MeeraPass2026",
        **over,
    }


async def email_signup(client: httpx.AsyncClient, f: dict[str, str]) -> dict:
    r = await client.post(f"{API}/auth/email-signup/start", json=f)
    assert r.status_code == 200, r.text
    code = r.json()["data"]["dev_otp"]
    r = await client.post(f"{API}/auth/email-signup/verify", json={**f, "code": code})
    assert r.status_code == 201, r.text
    return r.json()["data"]


async def test_email_signup_creates_account_with_verified_email_and_unverified_mobile(
    client: httpx.AsyncClient, container: Container
) -> None:
    f = form()
    t = await email_signup(client, f)
    u = t["user"]
    assert t["is_new_user"] is True and u["full_name"] == "Meera Iyer"
    assert u["email_verified"] is True and u["email_verified_at"] is not None
    assert u["phone_verified"] is False and u["phone_verified_at"] is None and u["registration_completed_at"] is None
    h = {"Authorization": f"Bearer {t['access_token']}"}
    # password login works, and the role step finishes registration keeping the email verified
    assert (
        await client.post(f"{API}/auth/login", json={"email": f["email"], "password": f["password"]})
    ).status_code == 200
    r = await client.post(
        f"{API}/users/me/registration",
        headers=h,
        json={"full_name": "Meera Iyer", "email": f["email"], "play_as": "player"},
    )
    assert r.status_code == 200, r.text
    me = r.json()["data"]
    assert (
        me["registration_completed_at"] is not None and me["email_verified"] is True and me["phone_verified"] is False
    )


async def test_nothing_is_created_without_the_code_and_wrong_codes_fail(
    client: httpx.AsyncClient, container: Container
) -> None:
    f = form()
    assert (await client.post(f"{API}/auth/email-signup/start", json=f)).status_code == 200
    assert await container.mongo["users"].count_documents({"email": f["email"]}) == 0
    r = await client.post(f"{API}/auth/email-signup/verify", json={**f, "code": "000000"})
    assert r.status_code == 401 and r.json()["error"]["code"] in ("OTP_INVALID",)
    assert await container.mongo["users"].count_documents({"email": f["email"]}) == 0


async def test_existing_email_or_number_is_refused_only_after_the_code(client: httpx.AsyncClient) -> None:
    first = form()
    await email_signup(client, first)
    # same email: the start reply is identical (no enumeration); the verify says log in instead
    again = form(email=first["email"])
    r = await client.post(f"{API}/auth/email-signup/start", json=again)
    assert r.status_code == 200
    r = await client.post(f"{API}/auth/email-signup/verify", json={**again, "code": r.json()["data"]["dev_otp"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "ACCOUNT_EXISTS"
    # same number, new email
    other = form(mobile=first["mobile_number"], email=f"x{first['email']}")
    r = await client.post(f"{API}/auth/email-signup/start", json=other)
    r = await client.post(f"{API}/auth/email-signup/verify", json={**other, "code": r.json()["data"]["dev_otp"]})
    assert r.status_code == 409 and r.json()["error"]["code"] == "MOBILE_IN_USE"


async def test_proving_the_number_by_sms_never_opens_the_email_account(
    client: httpx.AsyncClient, container: Container
) -> None:
    f = form()
    t = await email_signup(client, f)
    # someone with that phone logs in by SMS code: they get their own account, the number moves to them
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": f["mobile_number"]})
    code = r.json()["data"]["dev_otp"]
    r = await client.post(f"{API}/auth/verify-otp", json={"mobile_number": f["mobile_number"], "code": code})
    assert r.status_code == 200
    prover = r.json()["data"]["user"]
    assert prover["id"] != t["user"]["id"] and prover["phone_verified"] is True
    email_acct = await container.mongo["users"].find_one({"_id": ObjectId(t["user"]["id"])})
    assert email_acct and email_acct.get("mobile_number") is None and email_acct["email"] == f["email"]


async def test_unproven_number_gets_no_whatsapp(client: httpx.AsyncClient, container: Container) -> None:
    from app.modules.notifications.service import _whatsapp_number_ok

    assert (
        _whatsapp_number_ok({"mobile_number": "+919800000001", "mobile_verified": False, "verified_via": "email"})
        is False
    )
    assert (
        _whatsapp_number_ok({"mobile_number": "+919800000001", "mobile_verified": True, "verified_via": "email"})
        is True
    )
    assert _whatsapp_number_ok({"mobile_number": "+919800000001", "mobile_verified": True}) is True


async def test_email_password_reset_only_for_verified_emails(client: httpx.AsyncClient, container: Container) -> None:
    f = form()
    await email_signup(client, f)
    r = await client.post(f"{API}/auth/email-reset/start", json={"email": f["email"]})
    code = r.json()["data"]["dev_otp"]
    assert code
    r = await client.post(
        f"{API}/auth/email-reset/verify", json={"email": f["email"], "code": code, "new_password": "NewMeera2026"}
    )
    assert r.status_code == 204
    assert (
        await client.post(f"{API}/auth/login", json={"email": f["email"], "password": "NewMeera2026"})
    ).status_code == 200
    # an unverified email (e.g. typed at SMS sign-up) gets the same reply but no code: never a recovery route
    await container.mongo["users"].update_one({"email": f["email"]}, {"$set": {"email_verified": False}})
    await container.mongo["otp_codes"].delete_many({"email": f["email"]})
    r = await client.post(f"{API}/auth/email-reset/start", json={"email": f["email"]})
    assert r.status_code == 200 and r.json()["data"]["dev_otp"] is None
    r = await client.post(f"{API}/auth/email-reset/start", json={"email": "nobody.here@example.in"})
    assert r.status_code == 200 and r.json()["data"]["dev_otp"] is None


@pytest.fixture
def cooldown(container: Container, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        container, "settings", container.settings.model_copy(update={"otp_resend_cooldown_seconds": 60})
    )


async def test_email_code_resend_cooldown(client: httpx.AsyncClient, cooldown: None) -> None:
    f = form()
    assert (await client.post(f"{API}/auth/email-signup/start", json=f)).status_code == 200
    r = await client.post(f"{API}/auth/email-signup/start", json=f)
    assert r.status_code == 429 and r.json()["error"]["code"] == "OTP_COOLDOWN"


def test_console_email_refused_in_production() -> None:
    with pytest.raises(ValueError, match="EMAIL_PROVIDER=console"):
        Settings(
            app_env="production",
            jwt_secret="x" * 40,
            otp_provider="msg91",
            whatsapp_provider="meta",
            debug=False,
            email_otp_enabled=True,
        )


def test_email_codes_are_off_by_default() -> None:
    """This release verifies the phone only: no email codes or links unless switched on deliberately."""
    from app.infrastructure.integrations.email import DisabledEmailSender, build_email_sender

    s = Settings(
        _env_file=None, app_env="test", email_provider="smtp", smtp_host="smtp.example.in", email_from="a@b.in"
    )
    assert s.email_otp_enabled is False
    assert isinstance(build_email_sender(s), DisabledEmailSender)


async def test_sms_signup_stores_email_unverified(client: httpx.AsyncClient, container: Container) -> None:
    m = unique_mobile()
    r = await client.post(f"{API}/auth/send-otp", json={"mobile_number": m, "purpose": "register"})
    assert r.status_code == 200, r.text
    code = r.json()["data"]["dev_otp"]
    profile = {"full_name": "Kabir Rao", "email": f"k{m[1:]}@example.in", "password": "KabirPass2026"}
    r = await client.post(
        f"{API}/auth/verify-otp", json={"mobile_number": m, "code": code, "purpose": "register", "profile": profile}
    )
    assert r.status_code in (200, 201), r.text
    u = await container.mongo["users"].find_one({"mobile_number": m})
    assert u and u["mobile_verified"] is True and u["email"] == profile["email"]
    assert u["email_verified"] is False and u["email_verified_at"] is None


async def test_email_codes_are_never_logged(client: httpx.AsyncClient, capsys: pytest.CaptureFixture[str]) -> None:
    f = form()
    r = await client.post(f"{API}/auth/email-signup/start", json=f)
    code = r.json()["data"]["dev_otp"]
    out = capsys.readouterr()
    assert code not in out.out + out.err and f["email"] not in out.out + out.err
