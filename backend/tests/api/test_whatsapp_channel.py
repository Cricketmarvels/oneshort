"""WhatsApp OTP login and opt-in WhatsApp notifications (provider faked; no network)."""

import httpx
from bson import ObjectId

from app.common.enums import NotificationType
from app.core.container import Container
from tests.conftest import register

API = "/api/v1"


class FakeWhatsApp:
    configured = True

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, list[str], str]] = []

    async def send(self, to_e164: str, body: str, params: list[str], kind: str = "invite") -> str:
        self.sent.append((to_e164, body, params, kind))
        return "sent"


async def test_whatsapp_otp_unavailable_until_configured(client: httpx.AsyncClient) -> None:
    u = await register(client, "Wa Unconfigured")
    opts = (await client.get(f"{API}/auth/options")).json()["data"]
    assert opts["whatsapp_otp"] is False
    r = await client.post(
        f"{API}/auth/send-otp", json={"mobile_number": u.mobile, "purpose": "login", "channel": "whatsapp"}
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "WHATSAPP_UNAVAILABLE"


async def test_whatsapp_otp_login_end_to_end(client: httpx.AsyncClient, container: Container) -> None:
    u = await register(client, "Wa Login")
    fake, original = FakeWhatsApp(), container.whatsapp
    container.whatsapp = fake  # type: ignore[assignment]
    try:
        assert (await client.get(f"{API}/auth/options")).json()["data"]["whatsapp_otp"] is True
        r = await client.post(
            f"{API}/auth/send-otp", json={"mobile_number": u.mobile, "purpose": "login", "channel": "whatsapp"}
        )
        assert r.status_code == 200, r.text
        assert r.json()["data"]["dev_otp"] is None  # never echoed when a real channel delivered it
        to, body, params, kind = fake.sent[-1]
        assert to == u.mobile and kind == "otp" and params[0] in body and len(params[0]) == 6
        v = await client.post(
            f"{API}/auth/verify-otp", json={"mobile_number": u.mobile, "code": params[0], "purpose": "login"}
        )
        assert v.status_code == 200 and v.json()["data"]["access_token"]
    finally:
        container.whatsapp = original


async def test_notifications_forward_to_whatsapp_unless_switched_off(
    client: httpx.AsyncClient, container: Container
) -> None:
    yes = await register(client, "Wa Yes")
    no = await register(client, "Wa No")
    default = await register(client, "Wa Default")  # never chose: updates are on by default
    await client.put(f"{API}/users/me", headers=no.h, json={"notification_prefs": {"whatsapp": False}})
    fake, original = FakeWhatsApp(), container.whatsapp
    container.whatsapp = fake  # type: ignore[assignment]
    try:
        svc = container.notifications
        await svc.notify(
            [ObjectId(yes.id), ObjectId(no.id), ObjectId(default.id)],
            NotificationType.MATCH_CANCELLED,
            "Match cancelled",
            "Sunday T20 is off",
        )
        assert (
            sorted(s[0] for s in fake.sent) == sorted([yes.mobile, default.mobile])
            and fake.sent[0][3] == "notify"
            and "Sunday T20 is off" in fake.sent[0][1]
        )
        await svc.notify(
            [ObjectId(yes.id)], NotificationType.RATING_UPDATED, "Rating +5", "Nice"
        )  # not a WhatsApp type
        assert len(fake.sent) == 2
        t = (await client.post(f"{API}/users/me/whatsapp-test", headers=yes.h)).json()["data"]
        assert t["status"] == "sent" and len(fake.sent) == 3
        assert (await client.post(f"{API}/users/me/whatsapp-test", headers=no.h)).json()["data"][
            "status"
        ] == "opted_out"
    finally:
        container.whatsapp = original
    assert (await client.post(f"{API}/users/me/whatsapp-test", headers=yes.h)).json()["data"][
        "status"
    ] == "not_configured"


class FailingWhatsApp:
    configured = True
    last_error: int | None = None

    async def send(self, to_e164: str, body: str, params: list[str], kind: str = "invite") -> str:
        self.last_error = 21654  # Twilio: ContentSid required (no open WhatsApp session)
        return "failed"


async def test_whatsapp_otp_failure_explains_the_join_step(client: httpx.AsyncClient, container: Container) -> None:
    u = await register(client, "Wa Nosession")
    original = container.whatsapp
    container.whatsapp = FailingWhatsApp()  # type: ignore[assignment]
    try:
        r = await client.post(
            f"{API}/auth/send-otp", json={"mobile_number": u.mobile, "purpose": "login", "channel": "whatsapp"}
        )
    finally:
        container.whatsapp = original
    assert r.status_code == 422 and r.json()["error"]["code"] == "OTP_DELIVERY_FAILED"
    assert "message OneShort" in r.json()["error"]["message"]
