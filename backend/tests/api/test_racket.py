"""Badminton & Pickleball: profiles, sport-isolated nearby search, play requests, courts, preferred sport."""

import httpx

from app.core.container import Container
from tests.api.test_competition import SECTOR_18, SECTOR_62
from tests.conftest import TestUser as RacketUser
from tests.conftest import register

API = "/api/v1"
NEAR = f"lat={SECTOR_18[0]}&lng={SECTOR_18[1]}"


async def racket(
    client: httpx.AsyncClient, name: str, sport: str, at: tuple[float, float], **extra: object
) -> RacketUser:
    u = await register(client, name)
    body = {
        "level": "intermediate",
        "preferred_times": ["evening"],
        "availability": ["weekends"],
        "formats": ["singles"],
        "home_location": {"lat": at[0], "lng": at[1]},
        "locality": "Sector 18",
        **extra,
    }
    r = await client.put(f"{API}/racket/{sport}/profile/me", headers=u.h, json=body)
    assert r.status_code == 200, r.text
    return u


async def test_nearby_is_sport_isolated_private_and_filterable(client: httpx.AsyncClient) -> None:
    me = await racket(client, "Seeker RK", "badminton", SECTOR_18)
    pro = await racket(client, "Pro RK", "badminton", SECTOR_18, level="advanced", formats=["doubles"])
    await racket(client, "Pickle RK", "pickleball", SECTOR_18)
    await racket(client, "Far RK", "badminton", SECTOR_62)
    await racket(client, "Hidden RK", "badminton", SECTOR_18, discoverable=False)

    res = (await client.get(f"{API}/racket/badminton/players/nearby?{NEAR}&radius_km=5&q=RK", headers=me.h)).json()[
        "data"
    ]
    names = {p["user"]["full_name"] for p in res}
    assert names == {"Pro RK"}  # not self, not pickleball, not hidden, not 7.5 km away
    assert all(p["distance_km"] % 0.5 == 0 and "lat" not in str(p) and "coordinates" not in str(p) for p in res)
    assert res[0]["rating"] is None and res[0]["matches_played"] == 0

    wide = (await client.get(f"{API}/racket/badminton/players/nearby?{NEAR}&radius_km=10&q=RK", headers=me.h)).json()[
        "data"
    ]
    assert "Far RK" in {p["user"]["full_name"] for p in wide}
    lvl = (
        await client.get(f"{API}/racket/badminton/players/nearby?{NEAR}&radius_km=10&q=RK&level=beginner", headers=me.h)
    ).json()["data"]
    assert lvl == []
    dbl = (
        await client.get(f"{API}/racket/badminton/players/nearby?{NEAR}&radius_km=10&q=RK&format=doubles", headers=me.h)
    ).json()["data"]
    assert [p["user"]["full_name"] for p in dbl] == ["Pro RK"]
    pickle = (
        await client.get(f"{API}/racket/pickleball/players/nearby?{NEAR}&radius_km=5&q=RK", headers=pro.h)
    ).json()["data"]
    assert [p["user"]["full_name"] for p in pickle] == ["Pickle RK"]


async def test_play_request_lifecycle(client: httpx.AsyncClient) -> None:
    a = await racket(client, "Asker PR", "pickleball", SECTOR_18)
    b = await racket(client, "Answer PR", "pickleball", SECTOR_18)
    other = await register(client, "NoProfile PR")

    r = await client.post(f"{API}/racket/pickleball/requests", headers=a.h, json={"to_user_id": other.id})
    assert r.status_code == 404  # target doesn't play pickleball
    r = await client.post(f"{API}/racket/badminton/requests", headers=a.h, json={"to_user_id": b.id})
    assert r.status_code == 404  # b plays pickleball, not badminton

    r = await client.post(
        f"{API}/racket/pickleball/requests", headers=a.h, json={"to_user_id": b.id, "message": "Doubles Sunday?"}
    )
    assert r.status_code == 201, r.text
    req = r.json()["data"]
    assert req["status"] == "pending" and req["direction"] == "sent"
    assert (
        await client.post(f"{API}/racket/pickleball/requests", headers=a.h, json={"to_user_id": b.id})
    ).status_code == 409

    received = (await client.get(f"{API}/racket/requests?box=received&sport=pickleball", headers=b.h)).json()["data"]
    assert [x["id"] for x in received] == [req["id"]] and received[0]["other"]["full_name"] == "Asker PR"
    assert (
        await client.post(f"{API}/racket/requests/{req['id']}/accept", headers=a.h)
    ).status_code == 403  # sender can't accept
    acc = await client.post(f"{API}/racket/requests/{req['id']}/accept", headers=b.h)
    assert acc.status_code == 200 and acc.json()["data"]["status"] == "accepted"
    assert (await client.post(f"{API}/racket/requests/{req['id']}/reject", headers=b.h)).status_code == 409

    near = (await client.get(f"{API}/racket/pickleball/players/nearby?{NEAR}&radius_km=5&q=PR", headers=a.h)).json()[
        "data"
    ]
    assert near[0]["matches_played"] == 1 and near[0]["request_status"] == "accepted"
    notes = (await client.get(f"{API}/notifications", headers=a.h)).json()["data"]
    assert any("accepted your Pickleball request" in n["title"] for n in notes)


async def test_courts_are_sport_filtered_and_demo_flagged(client: httpx.AsyncClient, container: Container) -> None:
    u = await register(client, "Court Finder")
    mongo = container.mongo
    await mongo["courts"].insert_many(
        [
            {
                "name": "Shuttle Hub CT",
                "address": "A1",
                "area": "Sector 18",
                "city": "Noida",
                "sports": ["badminton"],
                "courts": {"badminton": 4},
                "indoor": True,
                "amenities": ["Parking"],
                "is_demo": True,
                "location": {"type": "Point", "coordinates": [SECTOR_18[1], SECTOR_18[0]]},
            },
            {
                "name": "Dink Park CT",
                "address": "B2",
                "area": "Sector 62",
                "city": "Noida",
                "sports": ["pickleball"],
                "courts": {"pickleball": 2},
                "indoor": False,
                "amenities": [],
                "is_demo": True,
                "location": {"type": "Point", "coordinates": [SECTOR_62[1], SECTOR_62[0]]},
            },
        ]
    )
    bad = (await client.get(f"{API}/racket/badminton/courts?{NEAR}&radius_km=20&q=CT", headers=u.h)).json()["data"]
    assert [c["name"] for c in bad] == ["Shuttle Hub CT"]
    assert bad[0]["is_demo"] is True and bad[0]["booking_available"] is False and bad[0]["courts"] == {"badminton": 4}
    pk = (await client.get(f"{API}/racket/pickleball/courts?{NEAR}&radius_km=20&q=CT", headers=u.h)).json()["data"]
    assert [c["name"] for c in pk] == ["Dink Park CT"] and pk[0]["distance_km"] >= 0.5


async def test_preferred_sport_defaults_to_cricket_and_persists(client: httpx.AsyncClient) -> None:
    u = await register(client, "Sport Switcher")
    me = (await client.get(f"{API}/users/me", headers=u.h)).json()["data"]
    assert me["preferred_sport"] == "cricket"
    r = await client.put(f"{API}/users/me", headers=u.h, json={"preferred_sport": "badminton"})
    assert r.status_code == 200 and r.json()["data"]["preferred_sport"] == "badminton"
    assert (await client.put(f"{API}/users/me", headers=u.h, json={"preferred_sport": "tennis"})).status_code == 422
