from datetime import timedelta

import httpx
import pytest
from bson import ObjectId
from starlette.testclient import TestClient

from app.common.types import utcnow
from app.modules.matches.scheduler import run_once
from tests.conftest import HSR_LAYOUT, KORAMANGALA, add_slot, future, make_match, make_player, make_team

API = "/api/v1"


async def test_invitations_expire_and_reminders_sent(client: httpx.AsyncClient, container) -> None:  # type: ignore[no-untyped-def]
    captain = await make_player(client, "Sched Skip", "all_rounder", KORAMANGALA)
    team = await make_team(client, captain, "Scheduler XI")
    start = utcnow() + timedelta(hours=20)
    match = await make_match(client, captain, team, start=start, capacity=4)
    p = await make_player(client, "Sched Player", "batsman", HSR_LAYOUT)
    await add_slot(client, p, start - timedelta(hours=1), hours=5)
    inv = (
        await client.post(
            f"{API}/matches/{match['id']}/invitations", headers=captain.h, json={"invites": [{"player_id": p.id}]}
        )
    ).json()["data"][0]["invitation_id"]
    await container.mongo["invitations"].update_one(
        {"_id": ObjectId(inv)}, {"$set": {"expires_at": utcnow() - timedelta(minutes=1)}}
    )
    r = await client.post(f"{API}/invitations/{inv}/accept", headers=p.h)
    assert r.json()["error"]["code"] == "INVITATION_EXPIRED"
    await run_once(container)
    doc = await container.mongo["invitations"].find_one({"_id": ObjectId(inv)})
    assert doc["invitation_status"] == "expired" and doc["is_active"] is False
    # Reminder for a match starting within 24h goes to the squad exactly once.
    await run_once(container)
    notes = (await client.get(f"{API}/notifications", headers=captain.h)).json()["data"]
    assert sum(n["type"] == "match_reminder" for n in notes) == 1


async def test_muted_notification_types_are_respected(client: httpx.AsyncClient) -> None:
    captain = await make_player(client, "Mute Skip", "all_rounder", KORAMANGALA)
    team = await make_team(client, captain, "Mute XI")
    start = future(80)
    match = await make_match(client, captain, team, start=start)
    p = await make_player(client, "Mute Player", "batsman", HSR_LAYOUT)
    await add_slot(client, p, start - timedelta(hours=1), hours=5)
    r = await client.put(
        f"{API}/users/me", headers=p.h, json={"notification_prefs": {"muted_types": ["player_invitation"]}}
    )
    assert r.status_code == 200
    await client.post(
        f"{API}/matches/{match['id']}/invitations", headers=captain.h, json={"invites": [{"player_id": p.id}]}
    )
    notes = (await client.get(f"{API}/notifications", headers=p.h)).json()["data"]
    assert not any(n["type"] == "player_invitation" for n in notes)


def test_websocket_rejects_invalid_token(app) -> None:  # type: ignore[no-untyped-def]
    from starlette.websockets import WebSocketDisconnect

    tc = TestClient(app)  # no lifespan: the invalid-token path never touches the database
    with pytest.raises(WebSocketDisconnect) as exc:
        with tc.websocket_connect("/api/v1/ws?token=bogus") as ws:
            ws.receive_text()
    assert exc.value.code == 4401
