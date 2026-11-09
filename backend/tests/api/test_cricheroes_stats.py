"""Players add their CricHeroes link and self-reported CricHeroes stats; other players and captains see them."""

import httpx

from tests.api.test_competition import SECTOR_18, player
from tests.conftest import register

API = "/api/v1"
P_URL = "https://cricheroes.com/player-profile/4794795/nitin-daksh/stats"
STATS = {
    "matches": 64,
    "runs": 1520,
    "highest_score": "102*",
    "batting_average": 29.8,
    "strike_rate": 131.4,
    "wickets": 23,
    "best_bowling": "4/18",
    "economy": 7.2,
    "catches": 19,
}


async def test_link_and_stats_saved_kept_and_removed(client: httpx.AsyncClient) -> None:
    u = await player(client, "CH Stats Owner", "all_rounder", SECTOR_18)
    r = await client.put(f"{API}/players/me/cricheroes", headers=u.h, json={"profile_url": P_URL, "stats": STATS})
    assert r.status_code == 200, r.text
    me = r.json()["data"]
    assert me["cricheroes_profile_url"] == P_URL
    assert me["cricheroes_stats"]["runs"] == 1520 and me["cricheroes_stats"]["self_reported"] is True
    assert me["cricheroes_stats"]["updated_at"]

    # Omitting a field keeps it; other profile edits don't wipe it.
    r = await client.put(f"{API}/players/me/cricheroes", headers=u.h, json={"stats": {**STATS, "runs": 1600}})
    me = r.json()["data"]
    assert me["cricheroes_profile_url"] == P_URL and me["cricheroes_stats"]["runs"] == 1600
    # null removes
    me = (await client.put(f"{API}/players/me/cricheroes", headers=u.h, json={"stats": None})).json()["data"]
    assert me["cricheroes_stats"] is None and me["cricheroes_profile_url"] == P_URL
    me = (await client.put(f"{API}/players/me/cricheroes", headers=u.h, json={"profile_url": None})).json()["data"]
    assert me["cricheroes_profile_url"] is None


async def test_stats_are_validated(client: httpx.AsyncClient) -> None:
    u = await player(client, "CH Stats Bad", "bowler", SECTOR_18)
    for bad in (
        {"best_bowling": "four for 18"},
        {"highest_score": "1000"},
        {"runs": -5},
        {"economy": 99},
        {"hacked": 1},
    ):
        r = await client.put(f"{API}/players/me/cricheroes", headers=u.h, json={"stats": bad})
        assert r.status_code == 422, bad
    r = await client.put(f"{API}/players/me/cricheroes", headers=u.h, json={"profile_url": "https://evil.example/p/1"})
    assert r.status_code == 422


async def test_needs_a_player_profile(client: httpx.AsyncClient) -> None:
    u = await register(client, "CH No Profile")
    r = await client.put(f"{API}/players/me/cricheroes", headers=u.h, json={"stats": STATS})
    assert r.status_code == 404 and r.json()["error"]["code"] == "PLAYER_PROFILE_REQUIRED"


async def test_captains_and_players_see_link_stats_and_bio(client: httpx.AsyncClient) -> None:
    owner = await player(client, "CH Stats Shown", "batsman", SECTOR_18)
    viewer = await player(client, "CH Stats Viewer", "bowler", SECTOR_18)
    prof = (await client.get(f"{API}/players/me", headers=owner.h)).json()["data"]
    body = {k: prof[k] for k in ("primary_role", "locality")} | {"bio": "Opening bat for weekend sides in Noida."}
    assert (await client.put(f"{API}/players/me", headers=owner.h, json=body)).status_code == 200
    await client.put(f"{API}/players/me/cricheroes", headers=owner.h, json={"profile_url": P_URL, "stats": STATS})

    seen = (await client.get(f"{API}/ratings/players/{owner.id}", headers=viewer.h)).json()["data"]
    assert seen["cricheroes_profile_url"] == P_URL
    assert seen["cricheroes_stats"]["best_bowling"] == "4/18" and seen["cricheroes_stats"]["self_reported"] is True
    assert seen["bio"] == "Opening bat for weekend sides in Noida."

    near = (
        await client.get(
            f"{API}/players/nearby?lat={SECTOR_18[0]}&lng={SECTOR_18[1]}&radius_km=5&q=CH Stats", headers=viewer.h
        )
    ).json()["data"]
    flags = {p["user"]["full_name"]: p["has_cricheroes"] for p in near}
    assert flags.get("CH Stats Shown") is True and flags.get("CH Stats Bad") is False  # viewer is never in own results
