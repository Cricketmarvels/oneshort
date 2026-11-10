"""Unified search: prefix matches on players, teams and grounds; ranking; privacy; write-through indexing."""

import httpx
from bson import ObjectId

from app.core.container import Container
from app.modules.search.indexer import SearchIndexer
from app.modules.search.text import edge_ngrams, normalise, soundex
from tests.api.test_competition import SECTOR_18, player, team

API = "/api/v1"


def test_text_helpers() -> None:
    assert normalise("  Shubhang  D'Souza ") == "shubhang dsouza"
    grams = edge_ngrams("Rahul Menon")
    assert {"r", "ra", "rahul", "m", "me", "menon"} <= set(grams)
    assert soundex("Rao") == soundex("Rau") and soundex("Sharma") == soundex("Sarma")
    assert soundex("Shubhang") == soundex("Subhang")


async def test_search_players_teams_grounds_by_prefix(client: httpx.AsyncClient, container: Container) -> None:
    me = await player(client, "Searcher One", "batsman", SECTOR_18)
    target = await player(client, "Zubin Qureshi-Search", "bowler", SECTOR_18)
    cap = await player(client, "Captain Qsearch", "all_rounder", SECTOR_18)
    tid = await team(client, cap, "Quokka Searchers XI", SECTOR_18, [])
    await container.mongo["venues"].insert_one(
        {
            "name": "Qureshi Memorial Ground",
            "address": "Plot 9",
            "area": "Sector 18",
            "city": "Noida",
            "location": {"type": "Point", "coordinates": [SECTOR_18[1], SECTOR_18[0]]},
        }
    )
    vid = (await container.mongo["venues"].find_one({"name": "Qureshi Memorial Ground"}))["_id"]
    await SearchIndexer(container.mongo).index_venue(vid)

    r = await client.get(f"{API}/search", headers=me.h, params={"q": "qu", "lat": SECTOR_18[0], "lng": SECTOR_18[1]})
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert any(p["id"] == target.id and p["role"] == "bowler" for p in d["players"])  # "qu" is a prefix of Qureshi
    assert any(t["id"] == tid for t in d["teams"])
    g = next(x for x in d["grounds"] if x["id"] == str(vid))
    assert g["distance_km"] is not None and g["address"] == "Plot 9"

    # Two-word query: both words must prefix-match; exact name ranks first.
    r = await client.get(f"{API}/search", headers=me.h, params={"q": "zubin qureshi", "types": "players"})
    d = r.json()["data"]
    assert d["players"] and d["players"][0]["id"] == target.id and d["teams"] == [] and d["grounds"] == []

    # Spelling variant falls back to the phonetic stage.
    r = await client.get(f"{API}/search", headers=me.h, params={"q": "kureshi", "types": "players"})
    assert any(p["id"] == target.id for p in r.json()["data"]["players"])

    # You never appear in your own results.
    r = await client.get(f"{API}/search", headers=me.h, params={"q": "searcher one", "types": "players"})
    assert all(p["id"] != me.id for p in r.json()["data"]["players"])


async def test_search_reflects_profile_changes_and_cricheroes(client: httpx.AsyncClient) -> None:
    me = await player(client, "Viewer Two", "batsman", SECTOR_18)
    p = await player(client, "Indexed Rename", "bowler", SECTOR_18)
    r = await client.put(
        f"{API}/players/me/cricheroes",
        headers=p.h,
        json={"profile_url": "https://cricheroes.com/player-profile/4794795/indexed-rename/stats"},
    )
    assert r.status_code == 200, r.text
    r = await client.get(f"{API}/search", headers=me.h, params={"q": "indexed ren", "types": "players"})
    hit = next(x for x in r.json()["data"]["players"] if x["id"] == p.id)
    assert hit["has_cricheroes"] and hit["cricheroes_profile_url"].startswith("https://cricheroes.com/player-profile/")

    assert (await client.put(f"{API}/users/me", headers=p.h, json={"full_name": "Priya Walsh"})).status_code == 200
    r = await client.get(f"{API}/search", headers=me.h, params={"q": "priya wal", "types": "players"})
    assert any(x["id"] == p.id for x in r.json()["data"]["players"])
    r = await client.get(f"{API}/search", headers=me.h, params={"q": "indexed ren", "types": "players"})
    assert all(x["id"] != p.id for x in r.json()["data"]["players"])


async def test_search_hides_blocked_users_and_deleted_accounts(client: httpx.AsyncClient, container: Container) -> None:
    me = await player(client, "Blocker Three", "batsman", SECTOR_18)
    other = await player(client, "Blockee Threeson", "bowler", SECTOR_18)
    r = await client.get(f"{API}/search", headers=me.h, params={"q": "blockee", "types": "players"})
    assert any(x["id"] == other.id for x in r.json()["data"]["players"])
    await container.mongo["user_blocks"].insert_one({"user_id": ObjectId(me.id), "blocked_id": ObjectId(other.id)})
    r = await client.get(f"{API}/search", headers=me.h, params={"q": "blockee", "types": "players"})
    assert all(x["id"] != other.id for x in r.json()["data"]["players"])

    gone = await player(client, "Vanishing Fourth", "bowler", SECTOR_18)
    assert (await client.request("DELETE", f"{API}/users/me", headers=gone.h, json={"confirm": "DELETE", "reason": "test"})).status_code == 204
    r = await client.get(f"{API}/search", headers=me.h, params={"q": "vanishing", "types": "players"})
    assert all(x["id"] != gone.id for x in r.json()["data"]["players"])
