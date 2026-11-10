"""WhatsApp simulator (test mode): messages are stored, not sent; inboxes are private; production refuses it."""

import httpx
import pytest

from app.core.config import Settings
from app.core.container import Container
from app.infrastructure.integrations.whatsapp import SimulatorWhatsApp
from tests.conftest import register

API = "/api/v1"


@pytest.fixture
def simulator(container: Container, monkeypatch: pytest.MonkeyPatch):  # type: ignore[no-untyped-def]
    monkeypatch.setattr(container.settings, "whatsapp_provider", "simulator")
    monkeypatch.setattr(container.settings, "whatsapp_simulator_key", "sim-key-123")
    original = container.whatsapp
    container.whatsapp = SimulatorWhatsApp(container.mongo)
    yield
    container.whatsapp = original


async def test_otp_login_through_simulator(client: httpx.AsyncClient, simulator: None) -> None:
    u = await register(client, "Sim Login")
    assert (await client.get(f"{API}/auth/options")).json()["data"]["whatsapp_simulator"] is True
    r = await client.post(
        f"{API}/auth/send-otp", json={"mobile_number": u.mobile, "purpose": "login", "channel": "whatsapp"}
    )
    assert r.status_code == 200 and r.json()["data"]["dev_otp"] is None
    # before login: inbox needs the key
    assert (await client.get(f"{API}/whatsapp/simulator/inbox", params={"phone": u.mobile})).status_code == 403
    bad = await client.get(
        f"{API}/whatsapp/simulator/inbox", params={"phone": u.mobile}, headers={"x-simulator-key": "nope"}
    )
    assert bad.status_code == 403
    inbox = (
        await client.get(
            f"{API}/whatsapp/simulator/inbox", params={"phone": u.mobile}, headers={"x-simulator-key": "sim-key-123"}
        )
    ).json()["data"]
    otp = inbox[0]
    assert otp["kind"] == "otp" and otp["code"] and otp["code"] in otp["body"] and otp["to_last4"] == u.mobile[-4:]
    v = await client.post(
        f"{API}/auth/verify-otp", json={"mobile_number": u.mobile, "code": otp["code"], "purpose": "login"}
    )
    assert v.status_code == 200


async def test_notifications_land_in_my_simulated_inbox_only(client: httpx.AsyncClient, simulator: None) -> None:
    me = await register(client, "Sim Me")
    other = await register(client, "Sim Other")
    for u in (me, other):
        await client.put(f"{API}/users/me", headers=u.h, json={"notification_prefs": {"whatsapp": True}})
    assert (await client.post(f"{API}/users/me/whatsapp-test", headers=me.h)).json()["data"]["status"] == "sent"
    mine = (await client.get(f"{API}/whatsapp/simulator/me", headers=me.h)).json()["data"]
    assert (
        len(mine) == 1
        and mine[0]["kind"] == "notify"
        and "WhatsApp is connected" in mine[0]["body"]
        and mine[0]["code"] is None
    )
    assert (await client.get(f"{API}/whatsapp/simulator/me", headers=other.h)).json()["data"] == []


async def test_simulator_endpoints_are_off_unless_enabled(client: httpx.AsyncClient) -> None:
    u = await register(client, "Sim Off")
    assert (await client.get(f"{API}/whatsapp/simulator/me", headers=u.h)).status_code == 404
    assert (await client.get(f"{API}/auth/options")).json()["data"]["whatsapp_simulator"] is False


def test_production_refuses_simulator() -> None:
    with pytest.raises(ValueError, match="simulator is not allowed in production"):
        Settings(
            app_env="production", jwt_secret="x" * 40, otp_provider="msg91", whatsapp_provider="simulator", debug=False
        )


async def test_unfinished_registration_can_finish_with_a_login_code(client: httpx.AsyncClient, simulator: None) -> None:
    mobile = "+919811122233"
    r = await client.post(
        f"{API}/auth/register",
        json={
            "full_name": "Half Done",
            "mobile_number": mobile,
            "email": "half.done@example.com",
            "otp_channel": "whatsapp",
        },
    )
    assert r.status_code in (200, 201), r.text  # registration started; code never entered
    r = await client.post(
        f"{API}/auth/send-otp", json={"mobile_number": mobile, "purpose": "login", "channel": "whatsapp"}
    )
    assert r.status_code == 200, r.text
    inbox = (
        await client.get(
            f"{API}/whatsapp/simulator/inbox", params={"phone": mobile}, headers={"x-simulator-key": "sim-key-123"}
        )
    ).json()["data"]
    v = await client.post(
        f"{API}/auth/verify-otp", json={"mobile_number": mobile, "code": inbox[0]["code"], "purpose": "login"}
    )
    assert v.status_code == 200 and v.json()["data"]["user"]["mobile_verified"] is True
    nobody = await client.post(
        f"{API}/auth/send-otp", json={"mobile_number": "+919800099999", "purpose": "login", "channel": "whatsapp"}
    )
    assert nobody.status_code == 200  # H2: unknown numbers get the same reply as registered ones
