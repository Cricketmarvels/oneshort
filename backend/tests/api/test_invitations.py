import asyncio

import httpx

from tests.conftest import HSR_LAYOUT, KORAMANGALA, add_slot, future, make_match, make_player, make_team

API = "/api/v1"


async def _match_with_players(client: httpx.AsyncClient, day: int, n: int, capacity: int = 11):  # type: ignore[no-untyped-def]
    from datetime import timedelta

    captain = await make_player(client, f"Skipper {day}", "all_rounder", KORAMANGALA)
    team = await make_team(client, captain, f"Invite XI {day}")
    start = future(day)
    match = await make_match(client, captain, team, start=start, capacity=capacity)
    players = []
    for i in range(n):
        p = await make_player(client, f"P{day}-{i}", "batsman", HSR_LAYOUT)
        assert (await add_slot(client, p, start - timedelta(hours=1), hours=5)).status_code == 201
        players.append(p)
    return captain, match, players


async def _invite(client: httpx.AsyncClient, captain, match, players, **kw):  # type: ignore[no-untyped-def]
    r = await client.post(
        f"{API}/matches/{match['id']}/invitations",
        headers=captain.h,
        json={"invites": [{"player_id": p.id, **kw} for p in players]},
    )
    assert r.status_code == 201, r.text
    return r.json()["data"]


async def test_invitation_lifecycle_and_payee_visible(client: httpx.AsyncClient) -> None:
    captain, match, (p,) = await _match_with_players(client, 30, 1)
    res = await _invite(client, captain, match, [p], contribution_type="non_payee")
    assert res[0]["ok"] is True
    inbox = (await client.get(f"{API}/invitations/me?box=received", headers=p.h)).json()["data"]
    inv = inbox[0]
    assert inv["contribution_type"] == "non_payee" and inv["can_accept"] is True  # shown before accepting
    assert inv["match"]["per_head_fee_paise"] > 0
    # Match moved to recruiting
    m = (await client.get(f"{API}/matches/{match['id']}", headers=captain.h)).json()["data"]
    assert m["match_status"] == "recruiting"
    # Captain cannot accept on the player's behalf.
    assert (await client.post(f"{API}/invitations/{inv['id']}/accept", headers=captain.h)).status_code == 404
    # Can't confirm before acceptance.
    r = await client.post(f"{API}/invitations/{inv['id']}/confirm", headers=captain.h)
    assert r.json()["error"]["code"] == "INVALID_INVITATION_TRANSITION"
    r = await client.post(f"{API}/invitations/{inv['id']}/accept", headers=p.h)
    assert r.json()["data"]["invitation_status"] == "accepted"
    r = await client.post(f"{API}/matches/{match['id']}/roster", headers=captain.h, json={"invitation_id": inv["id"]})
    assert r.status_code == 200, r.text
    roster = r.json()["data"]
    assert roster["composition"]["confirmed_total"] == 2
    seat = [e for e in roster["active"] if e["player"]["id"] == p.id][0]
    assert seat["contribution_type"] == "non_payee"
    # Venue becomes visible to the roster member.
    m = (await client.get(f"{API}/matches/{match['id']}", headers=p.h)).json()["data"]
    assert m["viewer_relation"] == "roster" and m["venue"]["address"] and m["venue"]["restricted"] is False


async def test_duplicate_active_invitation(client: httpx.AsyncClient) -> None:
    captain, match, (p,) = await _match_with_players(client, 31, 1)
    await _invite(client, captain, match, [p])
    res = await _invite(client, captain, match, [p])
    assert res[0]["ok"] is False and res[0]["error_code"] == "DUPLICATE_INVITATION"
    # Concurrent duplicates: exactly one survives.
    p2 = (await _match_with_players(client, 32, 1))[2][0]
    from datetime import timedelta

    assert (await add_slot(client, p2, future(31) - timedelta(hours=1), hours=5)).status_code in (201, 409)
    results = await asyncio.gather(
        *[
            client.post(
                f"{API}/matches/{match['id']}/invitations", headers=captain.h, json={"invites": [{"player_id": p2.id}]}
            )
            for _ in range(5)
        ]
    )
    oks = [r.json()["data"][0]["ok"] for r in results]
    assert oks.count(True) == 1


async def test_cannot_invite_unavailable_or_self(client: httpx.AsyncClient) -> None:
    from datetime import timedelta

    captain, match, _ = await _match_with_players(client, 33, 0)
    busy = await make_player(client, "Busy", "bowler", HSR_LAYOUT)
    await add_slot(client, busy, future(33) - timedelta(hours=1), hours=5, status="unavailable")
    silent = await make_player(client, "No Slots", "bowler", HSR_LAYOUT)
    res = await _invite(client, captain, match, [busy, silent, captain])
    codes = {r["player_id"]: r["error_code"] for r in res}
    assert codes[busy.id] == "PLAYER_UNAVAILABLE"
    assert codes[silent.id] == "PLAYER_UNAVAILABLE"
    assert codes[captain.id] == "SELF_INVITE"


async def test_reject_cancel_and_authorization(client: httpx.AsyncClient) -> None:
    captain, match, (a, b, c) = await _match_with_players(client, 34, 3)
    res = await _invite(client, captain, match, [a, b, c])
    ia, ib, ic = (r["invitation_id"] for r in res)
    r = await client.post(f"{API}/invitations/{ia}/reject", headers=a.h, json={"reason": "Family function"})
    assert r.json()["data"]["invitation_status"] == "rejected"
    # Rejected invitation is final; a fresh invite is allowed afterwards.
    assert (await client.post(f"{API}/invitations/{ia}/accept", headers=a.h)).status_code == 422
    assert (await _invite(client, captain, match, [a]))[0]["ok"] is True
    # Another player cannot cancel b's invite.
    assert (await client.post(f"{API}/invitations/{ib}/cancel", headers=c.h, json={})).status_code == 403
    r = await client.post(f"{API}/invitations/{ib}/cancel", headers=captain.h, json={"reason": "Squad changed"})
    assert r.json()["data"]["invitation_status"] == "cancelled"
    # Unrelated captain cannot touch this match's invitations.
    other_captain = await make_player(client, "Other Skipper", "batsman", KORAMANGALA)
    assert (await client.post(f"{API}/invitations/{ic}/cancel", headers=other_captain.h, json={})).status_code == 403
    r = await client.get(f"{API}/matches/{match['id']}/invitations", headers=other_captain.h)
    assert r.status_code == 403


async def test_concurrent_confirm_never_overbooks(client: httpx.AsyncClient) -> None:
    # capacity 4: captain occupies 1 seat → only 3 of 8 accepted players can be confirmed.
    captain, match, players = await _match_with_players(client, 35, 8, capacity=4)
    res = await _invite(client, captain, match, players)
    ids = [r["invitation_id"] for r in res]
    for p, iid in zip(players, ids, strict=True):
        assert (await client.post(f"{API}/invitations/{iid}/accept", headers=p.h)).status_code == 200
    results = await asyncio.gather(*[client.post(f"{API}/invitations/{iid}/confirm", headers=captain.h) for iid in ids])
    ok = [r for r in results if r.status_code == 200]
    full = [r for r in results if r.status_code == 422 and r.json()["error"]["code"] == "SQUAD_FULL"]
    assert len(ok) == 3 and len(full) == 5, [r.text for r in results]
    roster = (await client.get(f"{API}/matches/{match['id']}/roster", headers=captain.h)).json()["data"]
    assert roster["composition"]["confirmed_total"] == 4 and len(roster["active"]) == 4


async def test_double_booking_prevented(client: httpx.AsyncClient) -> None:
    captain, match, (p,) = await _match_with_players(client, 36, 1)
    captain2 = await make_player(client, "Rival Skipper", "bowler", KORAMANGALA)
    team2 = await make_team(client, captain2, "Rival XI 36")
    match2 = await make_match(client, captain2, team2, start=future(36))
    i1 = (await _invite(client, captain, match, [p]))[0]["invitation_id"]
    i2 = (await _invite(client, captain2, match2, [p]))[0]["invitation_id"]
    await client.post(f"{API}/invitations/{i1}/accept", headers=p.h)
    assert (await client.post(f"{API}/invitations/{i1}/confirm", headers=captain.h)).status_code == 200
    r = await client.post(f"{API}/invitations/{i2}/accept", headers=p.h)
    assert r.json()["error"]["code"] == "PLAYER_DOUBLE_BOOKED"
