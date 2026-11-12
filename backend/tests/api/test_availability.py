from datetime import timedelta

import httpx

from tests.conftest import KORAMANGALA, add_slot, future, iso, make_player, register

API = "/api/v1"


async def test_requires_profile_and_agreement(client: httpx.AsyncClient) -> None:
    u = await register(client, agree=False)
    r = await add_slot(client, u, future(10))
    assert r.status_code == 403 and r.json()["error"]["code"] == "AGREEMENT_REQUIRED"
    u2 = await register(client)
    r = await add_slot(client, u2, future(10))
    assert r.json()["error"]["code"] == "PLAYER_PROFILE_MISSING"


async def test_create_list_update_delete_and_conflicts(client: httpx.AsyncClient) -> None:
    p = await make_player(client, "Shreyas Iyer", "batsman", KORAMANGALA)
    start = future(11)
    r = await add_slot(client, p, start, hours=4)
    assert r.status_code == 201, r.text
    slot = r.json()["data"][0]
    # Overlapping slot (any status) is rejected with the conflicting slot id.
    r = await add_slot(client, p, start + timedelta(hours=2), hours=3, status="unavailable")
    assert r.status_code == 409 and r.json()["error"]["code"] == "AVAILABILITY_CONFLICT"
    assert r.json()["error"]["details"][0]["conflicting_slot_id"] == slot["id"]
    # Adjacent slot is fine.
    assert (await add_slot(client, p, start + timedelta(hours=4), hours=2)).status_code == 201
    mine = (await client.get(f"{API}/availability/me", headers=p.h)).json()["data"]
    assert len(mine) == 2
    r = await client.put(f"{API}/availability/{slot['id']}", headers=p.h, json={"status": "tentative"})
    assert r.status_code == 200 and r.json()["data"]["status"] == "tentative"
    # Extending into the next slot conflicts.
    r = await client.put(
        f"{API}/availability/{slot['id']}", headers=p.h, json={"end_at": iso(start + timedelta(hours=5))}
    )
    assert r.status_code == 409
    assert (await client.delete(f"{API}/availability/{slot['id']}", headers=p.h)).status_code == 204
    other = await make_player(client, "Other", "bowler", KORAMANGALA)
    assert (await client.delete(f"{API}/availability/{slot['id']}", headers=other.h)).status_code == 404


async def test_validation_and_repeat(client: httpx.AsyncClient) -> None:
    p = await make_player(client, "Repeat Player", "bowler", KORAMANGALA)
    start = future(12)
    r = await client.post(
        f"{API}/availability", headers=p.h, json={"start_at": iso(start), "end_at": iso(start - timedelta(hours=1))}
    )
    assert r.status_code == 422
    r = await client.post(
        f"{API}/availability",
        headers=p.h,
        json={"start_at": start.replace(tzinfo=None).isoformat(), "end_at": iso(start + timedelta(hours=2))},
    )
    assert r.status_code == 422  # naive datetimes rejected (timezone required)
    r = await client.post(
        f"{API}/availability",
        headers=p.h,
        json={"start_at": iso(start), "end_at": iso(start + timedelta(hours=2)), "repeat_weeks": 3},
    )
    assert r.status_code == 201 and len(r.json()["data"]) == 4


async def test_concurrent_duplicate_submissions_create_one_slot(client: httpx.AsyncClient) -> None:
    import asyncio

    p = await make_player(client, "Double Tap", "batsman", KORAMANGALA)
    start = future(13)
    results = await asyncio.gather(*[add_slot(client, p, start) for _ in range(5)])
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1 and all(c == 409 for c in codes if c != 201)


async def test_slot_carries_whether_the_player_pays(client: httpx.AsyncClient) -> None:
    """A player can say "I'll play free" on a slot; the default is that they pay their share."""
    p = await make_player(client, "Free Agent", "bowler", KORAMANGALA)
    r = await add_slot(client, p, future(12))
    assert r.status_code == 201 and r.json()["data"][0]["contribution"] == "payee"
    r = await add_slot(client, p, future(13), contribution="non_payee")
    assert r.status_code == 201, r.text
    slot = r.json()["data"][0]
    assert slot["contribution"] == "non_payee"
    r = await client.put(f"{API}/availability/{slot['id']}", headers=p.h, json={"contribution": "payee"})
    assert r.status_code == 200 and r.json()["data"]["contribution"] == "payee"
    assert (await add_slot(client, p, future(14), contribution="sponsor")).status_code == 422
    mine = (await client.get(f"{API}/availability/me", headers=p.h)).json()["data"]
    assert {s["contribution"] for s in mine} == {"payee"}
