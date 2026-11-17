"""Match invitation → WhatsApp copy (opt-in, provider-gated) → accept → captain/player chat + WhatsApp link."""

import httpx

from app.core.container import Container
from tests.api.test_competition import SECTOR_18, player, team
from tests.conftest import add_slot, future, make_match

API = "/api/v1"


class FakeWhatsApp:
    configured = True

    def __init__(self) -> None:
        self.sent: list[tuple[str, str, list[str]]] = []

    async def send(self, to_e164: str, body: str, params: list[str]) -> str:
        self.sent.append((to_e164, body, params))
        return "sent"


async def _setup(client: httpx.AsyncClient, tag: str) -> tuple:  # type: ignore[type-arg]
    cap = await player(client, f"Captain {tag}", "all_rounder", SECTOR_18)
    p = await player(client, f"Player {tag}", "bowler", SECTOR_18)
    tid = await team(client, cap, f"Team {tag}", SECTOR_18, [])
    await add_slot(client, p, future(4, 7), at=SECTOR_18)
    match_id = (await make_match(client, cap, tid, start=future(4, 7), at=SECTOR_18, capacity=11))["id"]
    return cap, p, match_id


async def _invite(client: httpx.AsyncClient, cap, match_id: str, pid: str, message: str | None = None) -> dict:  # type: ignore[no-untyped-def,type-arg]
    body: dict = {"invites": [{"player_id": pid}]}  # type: ignore[type-arg]
    if message:
        body["message"] = message
    r = await client.post(f"{API}/matches/{match_id}/invitations", headers=cap.h, json=body)
    assert r.status_code in (200, 201), r.text
    item = r.json()["data"][0]
    assert item["ok"], item
    return item


async def test_invite_whatsapp_is_on_by_default_and_reports_status(
    client: httpx.AsyncClient, container: Container
) -> None:
    cap, p, match_id = await _setup(client, "WA1")
    await client.put(f"{API}/users/me", headers=p.h, json={"notification_prefs": {"whatsapp": False}})
    assert (await _invite(client, cap, match_id, p.id))["whatsapp_status"] == "opted_out"
    cap0, p0, match0 = await _setup(client, "WA0")  # never chose: on by default
    assert (await _invite(client, cap0, match0, p0.id))["whatsapp_status"] == "not_configured"

    cap2, p2, match2 = await _setup(client, "WA2")
    await client.put(f"{API}/users/me", headers=p2.h, json={"notification_prefs": {"whatsapp": True}})
    assert (await _invite(client, cap2, match2, p2.id))["whatsapp_status"] == "not_configured"

    fake = FakeWhatsApp()
    original = container.whatsapp
    container.whatsapp = fake  # type: ignore[assignment]
    try:
        cap3, p3, match3 = await _setup(client, "WA3")
        await client.put(f"{API}/users/me", headers=p3.h, json={"notification_prefs": {"whatsapp": True}})
        assert (await _invite(client, cap3, match3, p3.id, "Need a bowler"))["whatsapp_status"] == "sent"
    finally:
        container.whatsapp = original
    to, body, params = fake.sent[0]
    assert to.startswith("+") and "Captain WA3 invited you" in body and "Need a bowler" in body
    assert f"/match/{match3}" in body and params[-1].endswith(f"/match/{match3}")
    managed = (await client.get(f"{API}/invitations/managed", headers=cap3.h)).json()["data"]
    assert managed[0]["whatsapp_status"] == "sent"
    got = (await client.get(f"{API}/invitations/me?box=received", headers=p3.h)).json()["data"]
    assert got[0]["whatsapp_status"] is None and got[0]["can_chat"] is False
    assert got[0]["match"]["venue_name"]


async def test_chat_opens_on_accept_and_whatsapp_link_needs_opt_in(client: httpx.AsyncClient) -> None:
    cap, p, match_id = await _setup(client, "CH")
    inv = (await _invite(client, cap, match_id, p.id))["invitation_id"]
    assert (await client.post(f"{API}/invitations/{inv}/chat", headers=p.h, json={"body": "hi"})).status_code == 422

    assert (await client.post(f"{API}/invitations/{inv}/accept", headers=p.h)).status_code == 200
    t = (await client.get(f"{API}/invitations/{inv}/chat", headers=p.h)).json()["data"]
    assert t["can_send"] and t["other"]["full_name"] == "Captain CH" and t["whatsapp_url"] is None

    r = await client.post(
        f"{API}/invitations/{inv}/chat", headers=p.h, json={"body": "Thanks! What time should I reach?"}
    )
    assert r.status_code == 201 and r.json()["data"]["mine"] is True
    await client.put(f"{API}/users/me", headers=p.h, json={"notification_prefs": {"whatsapp": True}})
    ct = (await client.get(f"{API}/invitations/{inv}/chat", headers=cap.h)).json()["data"]
    assert [m["mine"] for m in ct["messages"]] == [False] and ct["messages"][0]["sender_name"] == "Player CH"
    assert ct["whatsapp_url"] and ct["whatsapp_url"].startswith("https://wa.me/")
    notes = (await client.get(f"{API}/notifications", headers=cap.h)).json()["data"]
    assert any(n["type"] == "chat_message" for n in notes)

    outsider = await player(client, "Outsider CH", "batsman", SECTOR_18)
    assert (await client.get(f"{API}/invitations/{inv}/chat", headers=outsider.h)).status_code == 404
