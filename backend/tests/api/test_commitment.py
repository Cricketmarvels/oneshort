"""Tentative or confirmed joining, captain removal, withdrawal and the wording of chat notifications."""

import httpx

from tests.api.test_invitations import _invite, _match_with_players

API = "/api/v1"


async def test_tentative_accept_needs_a_note_and_reaches_captain_and_roster(client: httpx.AsyncClient) -> None:
    captain, match, (p,) = await _match_with_players(client, 41, 1)
    inv = (await _invite(client, captain, match, [p]))[0]["invitation_id"]
    r = await client.post(f"{API}/invitations/{inv}/accept", headers=p.h, json={"commitment": "tentative"})
    assert r.status_code == 422  # tentative without saying by when
    r = await client.post(
        f"{API}/invitations/{inv}/accept",
        headers=p.h,
        json={"commitment": "tentative", "commitment_note": "Will confirm by Friday 6 pm"},
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["commitment"] == "tentative"

    seen = (await client.get(f"{API}/matches/{match['id']}/invitations", headers=captain.h)).json()["data"]
    mine = next(i for i in seen if i["id"] == inv)
    assert mine["commitment"] == "tentative" and mine["commitment_note"] == "Will confirm by Friday 6 pm"
    assert mine["can_confirm"] is True
    notes = (await client.get(f"{API}/notifications", headers=captain.h)).json()["data"]
    assert any("tentative" in n["title"] and "Friday" in n["body"] for n in notes)

    r = await client.post(f"{API}/invitations/{inv}/confirm", headers=captain.h)
    assert r.status_code == 200, r.text
    roster = (await client.get(f"{API}/matches/{match['id']}/roster", headers=captain.h)).json()["data"]
    seat = next(e for e in roster["active"] if e["player"]["id"] == p.id)
    assert seat["commitment"] == "tentative" and "Friday" in seat["commitment_note"]

    # the player firms up; the captain sees it
    r = await client.post(f"{API}/matches/{match['id']}/commitment", headers=p.h, json={"commitment": "confirmed"})
    assert r.status_code == 204, r.text
    roster = (await client.get(f"{API}/matches/{match['id']}/roster", headers=captain.h)).json()["data"]
    seat = next(e for e in roster["active"] if e["player"]["id"] == p.id)
    assert seat["commitment"] == "confirmed" and seat["commitment_note"] is None


async def test_plain_accept_still_means_confirmed(client: httpx.AsyncClient) -> None:
    captain, match, (p,) = await _match_with_players(client, 42, 1)
    inv = (await _invite(client, captain, match, [p]))[0]["invitation_id"]
    r = await client.post(f"{API}/invitations/{inv}/accept", headers=p.h)  # older apps send no body
    assert r.status_code == 200 and r.json()["data"]["commitment"] == "confirmed"


async def test_captain_accepts_or_declines_a_join_request(client: httpx.AsyncClient) -> None:
    captain, match, (a, b) = await _match_with_players(client, 43, 2)
    await client.put(f"{API}/matches/{match['id']}/status", headers=captain.h, json={"status": "published"})
    for p, body in ((a, {"commitment": "tentative", "commitment_note": "Depends on office shift"}), (b, {})):
        r = await client.post(f"{API}/matches/{match['id']}/join-requests", headers=p.h, json=body)
        assert r.status_code in (200, 201), r.text
    reqs = (await client.get(f"{API}/matches/{match['id']}/invitations", headers=captain.h)).json()["data"]
    ra = next(i for i in reqs if i["player"]["id"] == a.id)
    rb = next(i for i in reqs if i["player"]["id"] == b.id)
    assert ra["direction"] == "request" and ra["can_confirm"] and ra["can_reject"] and ra["commitment"] == "tentative"
    assert (await client.post(f"{API}/invitations/{ra['id']}/confirm", headers=captain.h)).status_code == 200
    r = await client.post(f"{API}/invitations/{rb['id']}/reject", headers=captain.h, json={"reason": None})
    assert r.status_code == 200 and r.json()["data"]["invitation_status"] == "rejected"
    # a player cannot approve their own request
    assert (await client.post(f"{API}/invitations/{rb['id']}/confirm", headers=b.h)).status_code in (403, 404, 422)


async def test_removed_and_withdrawn_players_leave_the_squad_list(client: httpx.AsyncClient) -> None:
    captain, match, (a, b) = await _match_with_players(client, 44, 2)
    for p in (a, b):
        inv = (await _invite(client, captain, match, [p]))[0]["invitation_id"]
        assert (await client.post(f"{API}/invitations/{inv}/accept", headers=p.h)).status_code == 200
        assert (await client.post(f"{API}/invitations/{inv}/confirm", headers=captain.h)).status_code == 200

    r = await client.put(
        f"{API}/matches/{match['id']}/roster/{a.id}",
        headers=captain.h,
        json={"status": "removed", "reason": "Squad change"},
    )
    assert r.status_code == 200, r.text
    assert a.id not in [e["player"]["id"] for e in r.json()["data"]["active"]]
    # a removed player may ask to join again
    again = await client.post(f"{API}/matches/{match['id']}/join-requests", headers=a.h, json={})
    assert again.status_code in (200, 201), again.text

    assert (await client.post(f"{API}/matches/{match['id']}/withdraw", headers=b.h, json={})).status_code == 204
    roster = (await client.get(f"{API}/matches/{match['id']}/roster", headers=captain.h)).json()["data"]
    assert b.id not in [e["player"]["id"] for e in roster["active"]]
    assert b.id in [e["player"]["id"] for e in roster["history"]]
    # another player cannot remove squad members
    r = await client.put(f"{API}/matches/{match['id']}/roster/{captain.id}", headers=b.h, json={"status": "removed"})
    assert r.status_code in (403, 404)


async def test_chat_notification_names_the_sender_and_match(client: httpx.AsyncClient) -> None:
    captain, match, (p,) = await _match_with_players(client, 45, 1)
    inv = (await _invite(client, captain, match, [p]))[0]["invitation_id"]
    await client.post(f"{API}/invitations/{inv}/accept", headers=p.h)
    r = await client.post(f"{API}/invitations/{inv}/chat", headers=captain.h, json={"body": "hi"})
    assert r.status_code in (200, 201), r.text
    notes = (await client.get(f"{API}/notifications", headers=p.h)).json()["data"]
    chat = next(n for n in notes if n["type"] == "chat_message")
    assert chat["title"] == f"New message from {captain.name}"
    assert chat["body"].endswith(": hi") and match["title"] in chat["body"]


async def test_team_join_request_notifies_the_captain(client: httpx.AsyncClient) -> None:
    captain, match, (p,) = await _match_with_players(client, 46, 1)
    r = await client.post(f"{API}/teams/{match['team_id']}/join-requests", headers=p.h)
    assert r.status_code == 204, r.text
    notes = (await client.get(f"{API}/notifications", headers=captain.h)).json()["data"]
    assert any(n["type"] == "join_request" and p.name in n["title"] for n in notes)
