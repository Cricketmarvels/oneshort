"""Nearby discovery never shows someone either side has blocked."""

import httpx

from tests.api.test_competition import SECTOR_18, player

API = "/api/v1"
NEAR = f"lat={SECTOR_18[0]}&lng={SECTOR_18[1]}&radius_km=5"


async def test_blocked_users_are_hidden_both_ways(client: httpx.AsyncClient) -> None:
    me = await player(client, "Blocker NB", "batsman", SECTOR_18)
    them = await player(client, "Blockee NB", "bowler", SECTOR_18)
    names = lambda r: {p["user"]["full_name"] for p in r.json()["data"]}  # noqa: E731
    assert "Blockee NB" in names(await client.get(f"{API}/players/nearby?{NEAR}&q=NB", headers=me.h))
    assert (await client.post(f"{API}/users/{them.id}/block", headers=me.h)).status_code in (200, 204)
    assert "Blockee NB" not in names(await client.get(f"{API}/players/nearby?{NEAR}&q=NB", headers=me.h))
    assert "Blocker NB" not in names(await client.get(f"{API}/players/nearby?{NEAR}&q=NB", headers=them.h))
    assert (await client.delete(f"{API}/users/{them.id}/block", headers=me.h)).status_code in (200, 204)
    assert "Blockee NB" in names(await client.get(f"{API}/players/nearby?{NEAR}&q=NB", headers=me.h))
