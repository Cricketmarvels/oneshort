"""Scenario E: two accepted invitations race for the final squad seat; exactly one is confirmed."""

import asyncio
from datetime import timedelta

import httpx

from tests.api.test_competition import SECTOR_18, player, team
from tests.conftest import add_slot, future, make_match

API = "/api/v1"


async def test_last_seat_confirmed_exactly_once(client: httpx.AsyncClient) -> None:
    cap = await player(client, "Race Captain", "all_rounder", SECTOR_18)
    tid = await team(client, cap, "Race XI", SECTOR_18, [])
    start = future(6, 7)
    match = await make_match(client, cap, tid, start=start, at=SECTOR_18, capacity=2)  # captain + 1 seat
    p1 = await player(client, "Race P1", "batsman", SECTOR_18)
    p2 = await player(client, "Race P2", "bowler", SECTOR_18)
    for pl in (p1, p2):  # captains may only invite players who are actually available for the slot
        await add_slot(client, pl, start - timedelta(hours=1), hours=5)

    res = (
        await client.post(
            f"{API}/matches/{match['id']}/invitations",
            headers=cap.h,
            json={"invites": [{"player_id": p1.id}, {"player_id": p2.id}]},
        )
    ).json()["data"]
    assert all(r.get("ok") for r in res), res
    inv1, inv2 = res[0]["invitation_id"], res[1]["invitation_id"]
    assert (await client.post(f"{API}/invitations/{inv1}/accept", headers=p1.h)).status_code == 200
    assert (await client.post(f"{API}/invitations/{inv2}/accept", headers=p2.h)).status_code == 200

    r1, r2 = await asyncio.gather(
        client.post(f"{API}/invitations/{inv1}/confirm", headers=cap.h),
        client.post(f"{API}/invitations/{inv2}/confirm", headers=cap.h),
    )
    outcomes = sorted([r1.status_code, r2.status_code])
    assert outcomes == [200, 422], (r1.text, r2.text)
    loser = r1 if r1.status_code != 200 else r2
    assert loser.json()["error"]["code"] == "SQUAD_FULL"

    m = (await client.get(f"{API}/matches/{match['id']}", headers=cap.h)).json()["data"]
    assert m["composition"]["confirmed_total"] == 2 and m["composition"]["vacancies"] == 0
    roster = (await client.get(f"{API}/matches/{match['id']}/roster", headers=cap.h)).json()["data"]
    assert len(roster["active"]) == 2  # captain + exactly one of the two players

    # the same confirm again is rejected, not double-seated
    winner_inv = inv1 if r1.status_code == 200 else inv2
    again = await client.post(f"{API}/invitations/{winner_inv}/confirm", headers=cap.h)
    assert again.status_code == 422
    m2 = (await client.get(f"{API}/matches/{match['id']}", headers=cap.h)).json()["data"]
    assert m2["composition"]["confirmed_total"] == 2
