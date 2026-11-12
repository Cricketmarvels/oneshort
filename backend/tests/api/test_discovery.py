import httpx

from tests.conftest import (
    HSR_LAYOUT,
    KORAMANGALA,
    MYSURU,
    WHITEFIELD,
    YELAHANKA,
    add_slot,
    future,
    make_match,
    make_player,
    make_team,
    register,
)

API = "/api/v1"


async def _setup(client: httpx.AsyncClient, day: int) -> tuple[object, dict[str, object], dict[str, object]]:
    captain = await make_player(client, f"Captain D{day}", "all_rounder", KORAMANGALA)
    team = await make_team(client, captain, f"Discovery XI {day}")
    start = future(day)
    match = await make_match(client, captain, team, start=start)
    players = {
        "near_bat": await make_player(client, f"Near Bat {day}", "batsman", HSR_LAYOUT),
        "near_bowl": await make_player(client, f"Near Bowl {day}", "bowler", HSR_LAYOUT, secondary=["batsman"]),
        "white_bat": await make_player(client, f"Whitefield Bat {day}", "batsman", WHITEFIELD),
        "yel_wk": await make_player(client, f"Yelahanka WK {day}", "wicketkeeper", YELAHANKA),
        "mys_bat": await make_player(client, f"Mysuru Bat {day}", "batsman", MYSURU),
        "wrong_time": await make_player(client, f"Morning Only {day}", "batsman", HSR_LAYOUT),
        "partial": await make_player(client, f"Partial {day}", "batsman", HSR_LAYOUT),
    }
    from datetime import timedelta

    for key in ("near_bat", "near_bowl", "white_bat", "yel_wk", "mys_bat"):
        assert (await add_slot(client, players[key], start - timedelta(hours=1), hours=5)).status_code == 201
    # Same date, no time overlap
    assert (await add_slot(client, players["wrong_time"], start + timedelta(hours=6), hours=2)).status_code == 201
    # Covers only the first 1.5h of a 3h match
    assert (await add_slot(client, players["partial"], start, hours=1.5)).status_code == 201
    return captain, match, players


def names(resp: httpx.Response) -> list[str]:
    return [r["player"]["full_name"] for r in resp.json()["data"]]


async def test_players_within_radius_ranked(client: httpx.AsyncClient) -> None:
    captain, match, _ = await _setup(client, 20)
    r = await client.post(
        f"{API}/discovery/players",
        headers=captain.h,  # type: ignore[attr-defined]
        json={"match_id": match["id"], "radius_km": 5},
    )
    assert r.status_code == 200, r.text
    got = names(r)
    assert got[:2] == ["Near Bat 20", "Near Bowl 20"] or set(got) == {"Near Bat 20", "Near Bowl 20"}
    assert r.json()["meta"]["ranker"] == "weighted-v1"
    first = r.json()["data"][0]
    assert first["score"] > 0 and "proximity" in first["score_breakdown"]


async def test_radius_is_hard_constraint(client: httpx.AsyncClient) -> None:
    captain, match, _ = await _setup(client, 21)
    h = captain.h  # type: ignore[attr-defined]
    r5 = names(await client.post(f"{API}/discovery/players", headers=h, json={"match_id": match["id"], "radius_km": 5}))
    r15 = names(
        await client.post(f"{API}/discovery/players", headers=h, json={"match_id": match["id"], "radius_km": 15})
    )
    r20 = names(
        await client.post(f"{API}/discovery/players", headers=h, json={"match_id": match["id"], "radius_km": 20})
    )
    assert "Whitefield Bat 21" not in r5 and "Whitefield Bat 21" in r15
    assert "Yelahanka WK 21" not in r15 and "Yelahanka WK 21" in r20
    assert "Mysuru Bat 21" not in r20
    assert "Morning Only 21" not in r20  # date matched but times didn't
    assert "Partial 21" not in r20  # only 50% coverage
    r = await client.post(
        f"{API}/discovery/players", headers=h, json={"match_id": match["id"], "radius_km": 20, "allow_partial": True}
    )
    assert "Partial 21" in names(r)
    bad = await client.post(f"{API}/discovery/players", headers=h, json={"match_id": match["id"], "radius_km": 7})
    assert bad.status_code == 422


async def test_role_filter(client: httpx.AsyncClient) -> None:
    captain, match, _ = await _setup(client, 22)
    h = captain.h  # type: ignore[attr-defined]
    r = await client.post(
        f"{API}/discovery/players",
        headers=h,
        json={"match_id": match["id"], "radius_km": 20, "roles": ["wicketkeeper"]},
    )
    assert names(r) == ["Yelahanka WK 22"]
    r = await client.post(
        f"{API}/discovery/players", headers=h, json={"match_id": match["id"], "radius_km": 5, "roles": ["batsman"]}
    )
    data = {d["player"]["full_name"]: d["role_match"] for d in r.json()["data"]}
    assert data == {"Near Bat 22": "primary", "Near Bowl 22": "secondary"}
    assert names(r)[0] == "Near Bat 22"  # primary outranks secondary at the same distance


async def test_no_coordinates_leak(client: httpx.AsyncClient) -> None:
    captain, match, _ = await _setup(client, 23)
    r = await client.post(
        f"{API}/discovery/players",
        headers=captain.h,  # type: ignore[attr-defined]
        json={"match_id": match["id"], "radius_km": 20},
    )
    text = r.text
    for coord in (HSR_LAYOUT, WHITEFIELD, YELAHANKA):
        assert str(coord[0]) not in text and str(coord[1]) not in text
    assert "location" not in text and "coordinates" not in text
    for d in r.json()["data"]:
        assert d["approx_distance_km"] * 2 == int(d["approx_distance_km"] * 2)  # 0.5 km buckets


async def test_only_match_managers_can_search_for_a_match(client: httpx.AsyncClient) -> None:
    _, match, _ = await _setup(client, 24)
    outsider = await register(client)
    r = await client.post(f"{API}/discovery/players", headers=outsider.h, json={"match_id": match["id"]})
    assert r.status_code == 403


async def test_find_team(client: httpx.AsyncClient) -> None:
    captain, match, players = await _setup(client, 25)
    near = players["near_bat"]
    r = await client.post(f"{API}/discovery/teams", headers=near.h, json={"radius_km": 5})  # type: ignore[attr-defined]
    assert r.status_code == 200, r.text
    ops = [o for o in r.json()["data"] if o["match_id"] == match["id"]]
    assert ops, r.json()
    op = ops[0]
    assert op["vacancies"] == 10 and op["team"]["team_name"] == "Discovery XI 25"
    assert "address" not in r.text and "Hosur" not in r.text  # venue address hidden from non-participants
    far = players["mys_bat"]
    r = await client.post(f"{API}/discovery/teams", headers=far.h, json={"radius_km": 20})  # type: ignore[attr-defined]
    assert all(o["match_id"] != match["id"] for o in r.json()["data"])
    # Join request flow
    r = await client.post(
        f"{API}/matches/{match['id']}/join-requests",
        headers=near.h,  # type: ignore[attr-defined]
        json={"proposed_role": "batsman", "message": "Opening bat, available all day"},
    )
    assert r.status_code == 201, r.text
    req_id = r.json()["data"]["id"]
    r = await client.post(f"{API}/discovery/teams", headers=near.h, json={"radius_km": 5})  # type: ignore[attr-defined]
    assert [o["my_status"] for o in r.json()["data"] if o["match_id"] == match["id"]] == ["pending"]
    r = await client.post(f"{API}/invitations/{req_id}/confirm", headers=captain.h)  # type: ignore[attr-defined]
    assert r.status_code == 200 and r.json()["data"]["invitation_status"] == "confirmed"
    notes = (await client.get(f"{API}/notifications", headers=near.h)).json()["data"]  # type: ignore[attr-defined]
    assert any(n["type"] == "match_confirmed" for n in notes)


async def test_role_counts_window_search_and_supply(client: httpx.AsyncClient) -> None:
    captain, match, _ = await _setup(client, 26)
    h = captain.h  # type: ignore[attr-defined]
    r = await client.post(
        f"{API}/discovery/players",
        headers=h,
        json={"match_id": match["id"], "radius_km": 20, "role_counts": {"wicketkeeper": 1, "batsman": 2}},
    )
    assert r.status_code == 200, r.text
    meta = r.json()["meta"]
    assert meta["players_needed"] == 3 and meta["role_counts"] == {"wicketkeeper": 1, "batsman": 2}
    by_name = {d["player"]["full_name"]: d["matched_role"] for d in r.json()["data"]}
    assert by_name["Yelahanka WK 26"] == "wicketkeeper" and by_name["Near Bat 26"] == "batsman"
    assert meta["role_supply"]["wicketkeeper"] == 1 and meta["role_supply"]["batsman"] >= 1
    bad = await client.post(
        f"{API}/discovery/players", headers=h, json={"match_id": match["id"], "role_counts": {"bowler": 0}}
    )
    assert bad.status_code == 422


async def test_captain_sees_who_wants_to_play_free(client: httpx.AsyncClient) -> None:
    """The slot's fee choice reaches the captain before they invite, so the split isn't a surprise later."""
    from datetime import timedelta

    captain = await make_player(client, "Captain Fees", "all_rounder", KORAMANGALA)
    team = await make_team(client, captain, "Fee Aware XI")
    start = future(33)
    match = await make_match(client, captain, team, start=start)
    free = await make_player(client, "Plays Free 33", "batsman", HSR_LAYOUT)
    pays = await make_player(client, "Pays Share 33", "bowler", HSR_LAYOUT)
    assert (
        await add_slot(client, free, start - timedelta(hours=1), hours=5, contribution="non_payee")
    ).status_code == 201
    assert (await add_slot(client, pays, start - timedelta(hours=1), hours=5)).status_code == 201
    # A free slot on another day doesn't colour this match.
    assert (
        await add_slot(client, pays, start + timedelta(days=1), hours=3, contribution="non_payee")
    ).status_code == 201
    r = await client.post(
        f"{API}/discovery/players",
        headers=captain.h,  # type: ignore[attr-defined]
        json={"match_id": match["id"], "radius_km": 5},
    )
    assert r.status_code == 200, r.text
    by_name = {x["player"]["full_name"]: x["contribution"] for x in r.json()["data"]}
    assert by_name["Plays Free 33"] == "non_payee"
    assert by_name["Pays Share 33"] == "payee"
