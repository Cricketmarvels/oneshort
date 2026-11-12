from datetime import timedelta
from typing import Any

import httpx

from tests.conftest import HSR_LAYOUT, KORAMANGALA, add_slot, future, iso, make_match, make_player, make_team, register

API = "/api/v1"


async def _confirmed_squad(client: httpx.AsyncClient, day: int, n: int, capacity: int):  # type: ignore[no-untyped-def]
    captain = await make_player(client, f"Lifecycle Skip {day}", "all_rounder", KORAMANGALA)
    team = await make_team(client, captain, f"Lifecycle XI {day}")
    start = future(day)
    match = await make_match(client, captain, team, start=start, capacity=capacity, roles={"batsman": 2, "bowler": 1})
    players = []
    for i in range(n):
        p = await make_player(client, f"L{day}-{i}", "batsman" if i % 2 == 0 else "bowler", HSR_LAYOUT)
        await add_slot(client, p, start - timedelta(hours=1), hours=5)
        players.append(p)
    res = (
        await client.post(
            f"{API}/matches/{match['id']}/invitations",
            headers=captain.h,
            json={"invites": [{"player_id": p.id} for p in players]},
        )
    ).json()["data"]
    for p, r in zip(players, res, strict=True):
        await client.post(f"{API}/invitations/{r['invitation_id']}/accept", headers=p.h)
        assert (
            await client.post(f"{API}/invitations/{r['invitation_id']}/confirm", headers=captain.h)
        ).status_code == 200
    return captain, match, players


async def test_create_validation_and_unique_code(client: httpx.AsyncClient) -> None:
    captain = await make_player(client, "Code Skip", "batsman", KORAMANGALA)
    team = await make_team(client, captain, "Code XI")
    m1 = await make_match(client, captain, team)
    m2 = await make_match(client, captain, team)
    assert m1["match_code"] != m2["match_code"] and m1["match_code"].startswith("CM-")
    assert m1["match_status"] == "published" and m1["per_head_fee_paise"] == 36400  # ₹4000 / 11 → ₹364
    start = future(40)
    r = await client.post(
        f"{API}/matches",
        headers=captain.h,
        json={
            "team_id": team,
            "venue": {"name": "X", "area": "Y", "city": "Z"},
            "location": {"lat": 12.9, "lng": 77.6},
            "start_at": iso(start),
            "end_at": iso(start + timedelta(hours=2)),
            "squad_capacity": 5,
            "required_roles": {"batsman": 4, "bowler": 3},
        },
    )
    assert r.status_code == 422  # composition exceeds capacity
    outsider = await register(client)
    r = await client.post(
        f"{API}/matches",
        headers=outsider.h,
        json={
            "team_id": team,
            "venue": {"name": "X", "area": "Y", "city": "Z"},
            "location": {"lat": 12.9, "lng": 77.6},
            "start_at": iso(start),
            "end_at": iso(start + timedelta(hours=2)),
        },
    )
    assert r.status_code == 403


async def test_full_lifecycle_with_replacement_and_withdrawal(client: httpx.AsyncClient) -> None:
    captain, match, players = await _confirmed_squad(client, 41, 3, capacity=4)
    mid = match["id"]
    roster = (await client.get(f"{API}/matches/{mid}/roster", headers=captain.h)).json()["data"]
    assert roster["composition"]["required"] == {"batsman": 2, "bowler": 1, "wicketkeeper": 0, "all_rounder": 0}
    assert roster["composition"]["vacancies"] == 0
    # Invalid jump
    r = await client.post(f"{API}/matches/{mid}/transition", headers=captain.h, json={"to": "in_progress"})
    assert r.json()["error"]["code"] == "INVALID_MATCH_TRANSITION"
    r = await client.post(f"{API}/matches/{mid}/transition", headers=captain.h, json={"to": "squad_confirmed"})
    assert r.status_code == 200 and r.json()["data"]["match_status"] == "squad_confirmed"
    # A player (not manager) cannot transition
    r = await client.post(f"{API}/matches/{mid}/transition", headers=players[0].h, json={"to": "scheduled"})
    assert r.status_code == 403
    # Withdrawal re-opens recruitment
    assert (
        await client.post(f"{API}/matches/{mid}/withdraw", headers=players[0].h, json={"reason": "Injury"})
    ).status_code == 204
    m = (await client.get(f"{API}/matches/{mid}", headers=captain.h)).json()["data"]
    assert m["match_status"] == "recruiting" and m["composition"]["vacancies"] == 1
    # Replacement: swap players[1] for a new substitute
    sub = await make_player(client, "Substitute 41", "bowler", HSR_LAYOUT)
    await add_slot(client, sub, future(41) - timedelta(hours=1), hours=5)
    r = await client.post(
        f"{API}/matches/{mid}/roster/{players[1].id}/replace",
        headers=captain.h,
        json={"replacement_player_id": sub.id, "reason": "Late arrival risk"},
    )
    assert r.status_code == 200 and r.json()["data"][0]["ok"], r.text
    inv = (await client.get(f"{API}/invitations/me", headers=sub.h)).json()["data"][0]
    assert inv["is_substitute"] is True
    roster = (await client.get(f"{API}/matches/{mid}/roster", headers=captain.h)).json()["data"]
    statuses = {e["player"]["id"]: e["status"] for e in roster["history"]}
    assert statuses == {players[0].id: "withdrawn", players[1].id: "replaced"}
    # Reschedule notifies the squad
    new_start = future(42)
    r = await client.put(
        f"{API}/matches/{mid}",
        headers=captain.h,
        json={"start_at": iso(new_start), "end_at": iso(new_start + timedelta(hours=3)), "reschedule_reason": "Rain"},
    )
    assert r.status_code == 200 and r.json()["data"]["reschedule_count"] == 1
    notes = (await client.get(f"{API}/notifications", headers=players[2].h)).json()["data"]
    assert any(n["type"] == "match_rescheduled" for n in notes)
    # Cancel
    r = await client.post(f"{API}/matches/{mid}/cancel", headers=captain.h, json={"reason": "Ground unavailable"})
    assert r.json()["data"]["match_status"] == "cancelled"
    inv = (await client.get(f"{API}/invitations/me", headers=sub.h)).json()["data"][0]
    assert inv["invitation_status"] == "cancelled"
    r = await client.post(f"{API}/matches/{mid}/transition", headers=captain.h, json={"to": "published"})
    assert r.json()["error"]["code"] == "INVALID_MATCH_TRANSITION"


async def test_venue_hidden_from_public(client: httpx.AsyncClient) -> None:
    captain = await make_player(client, "Venue Skip", "batsman", KORAMANGALA)
    team = await make_team(client, captain, "Venue XI")
    match = await make_match(client, captain, team)
    stranger = await register(client)
    m = (await client.get(f"{API}/matches/{match['id']}", headers=stranger.h)).json()["data"]
    assert m["venue"]["restricted"] is True and m["venue"]["address"] is None and m["venue"]["lat"] is None
    assert m["venue"]["area"] == "Koramangala"
    assert (await client.get(f"{API}/matches/{match['id']}/roster", headers=stranger.h)).status_code == 403


async def test_match_history_lists(client: httpx.AsyncClient) -> None:
    captain, match, players = await _confirmed_squad(client, 43, 1, capacity=4)
    mine = (await client.get(f"{API}/matches?role=player", headers=players[0].h)).json()
    assert any(m["id"] == match["id"] for m in mine["data"])
    cap = (await client.get(f"{API}/matches?role=captain", headers=captain.h)).json()
    assert cap["meta"]["total"] >= 1


async def test_cancelling_one_of_this_weeks_matches_clears_it_from_the_dashboard(
    client: httpx.AsyncClient,
) -> None:
    """The captain's use case: two matches this week, one called off.

    What the dashboard reads is `role=captain&when=upcoming`, so the cancelled match has to leave that list
    while staying visible under past matches — the squad, the fee ledger and the reason are history, not litter.
    """
    from tests.api.test_competition import SECTOR_18, player, team

    cap = await player(client, "Weekly Captain", "all_rounder", SECTOR_18)
    squad_member = await player(client, "Weekly Player", "bowler", SECTOR_18)
    tid = await team(client, cap, "Weekly XI", SECTOR_18, [])
    sat_start = future(2, 7)
    saturday = (await make_match(client, cap, tid, start=sat_start, at=SECTOR_18, capacity=11))["id"]
    sunday = (await make_match(client, cap, tid, start=future(3, 7), at=SECTOR_18, capacity=11))["id"]

    await add_slot(client, squad_member, sat_start, at=SECTOR_18)
    r = await client.post(
        f"{API}/matches/{saturday}/invitations", headers=cap.h, json={"invites": [{"player_id": squad_member.id}]}
    )
    assert r.status_code == 201 and r.json()["data"][0]["ok"], r.text

    async def upcoming() -> list[dict[str, Any]]:
        r = await client.get(f"{API}/matches", headers=cap.h, params={"role": "captain", "when": "upcoming"})
        return list(r.json()["data"])

    rows = await upcoming()
    assert sorted(m["id"] for m in rows) == sorted([saturday, sunday])
    assert "cancelled" in rows[0]["allowed_transitions"]  # the app shows the button from this

    r = await client.post(f"{API}/matches/{saturday}/cancel", headers=cap.h, json={"reason": "Ground unavailable"})
    assert r.status_code == 200, r.text
    assert r.json()["data"]["cancelled_reason"] == "Ground unavailable"

    assert [m["id"] for m in await upcoming()] == [sunday]  # the dashboard now shows one match

    past = (await client.get(f"{API}/matches", headers=cap.h, params={"role": "captain", "when": "past"})).json()
    cancelled = next(m for m in past["data"] if m["id"] == saturday)
    assert cancelled["match_status"] == "cancelled" and cancelled["allowed_transitions"] == []

    # The invited player is told, loses the invitation, and no longer counts the match as theirs.
    inv = (await client.get(f"{API}/invitations/me", headers=squad_member.h)).json()["data"]
    assert all(i["invitation_status"] == "cancelled" for i in inv if i["match"]["id"] == saturday)
    notes = (await client.get(f"{API}/notifications", headers=squad_member.h)).json()["data"]
    assert any(n["type"] == "match_cancelled" for n in notes)
    mine = (await client.get(f"{API}/matches", headers=squad_member.h, params={"when": "upcoming"})).json()["data"]
    assert saturday not in [m["id"] for m in mine]

    # Cancelling is final: no second cancel, no way back to recruiting.
    again = await client.post(f"{API}/matches/{saturday}/cancel", headers=cap.h, json={"reason": "Changed my mind"})
    assert again.status_code == 422 and again.json()["error"]["code"] == "INVALID_MATCH_TRANSITION"
