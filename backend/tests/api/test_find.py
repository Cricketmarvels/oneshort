"""Find a Player / Find a Team (join mode)."""

import httpx

from tests.api.test_competition import SECTOR_18, SECTOR_62, player, setup_two_teams
from tests.conftest import add_slot, future, make_match

API = "/api/v1"
NEAR = f"lat={SECTOR_18[0]}&lng={SECTOR_18[1]}"


async def test_find_players_filters_and_privacy(client: httpx.AsyncClient) -> None:
    me = await player(client, "Seeker FP", "batsman", SECTOR_18)
    bowler = await player(client, "Bowler FP", "bowler", SECTOR_18)
    keeper = await player(client, "Keeper FP", "wicketkeeper", SECTOR_18)
    far = await player(client, "Far FP", "bowler", SECTOR_62)
    hidden = await player(client, "Hidden FP", "bowler", SECTOR_18)
    r = await client.put(
        f"{API}/players/me",
        headers=hidden.h,
        json={
            "primary_role": "bowler",
            "availability_visibility": "private",
            "home_location": {"lat": SECTOR_18[0], "lng": SECTOR_18[1]},
        },
    )
    assert r.status_code == 200
    await add_slot(client, bowler, future(2, 7), at=SECTOR_18)

    res = (await client.get(f"{API}/players/nearby?{NEAR}&radius_km=5&q=FP", headers=me.h)).json()["data"]
    names = {p["user"]["full_name"] for p in res}
    assert {"Bowler FP", "Keeper FP"} <= names
    assert "Seeker FP" not in names and "Hidden FP" not in names and "Far FP" not in names  # self, private, 7.5 km
    assert all(p["distance_km"] % 0.5 == 0 and "lat" not in str(p) for p in res)
    assert all(p["rating"] is None for p in res)  # unrated players are still findable
    bowlers = (await client.get(f"{API}/players/nearby?{NEAR}&radius_km=5&q=FP&role=bowler", headers=me.h)).json()[
        "data"
    ]
    assert [p["user"]["full_name"] for p in bowlers] == ["Bowler FP"]
    free = (await client.get(f"{API}/players/nearby?{NEAR}&radius_km=5&q=FP&available=true", headers=me.h)).json()[
        "data"
    ]
    assert [p["user"]["full_name"] for p in free] == ["Bowler FP"] and free[0]["available_this_week"]
    rated = (await client.get(f"{API}/players/nearby?{NEAR}&radius_km=5&q=FP&min_rating=1000", headers=me.h)).json()[
        "data"
    ]
    assert rated == []
    wide = (await client.get(f"{API}/players/nearby?{NEAR}&radius_km=10&q=FP", headers=me.h)).json()["data"]
    assert "Far FP" in {p["user"]["full_name"] for p in wide}
    del keeper, far


async def test_find_teams_to_join_shows_open_spots_and_membership(client: httpx.AsyncClient) -> None:
    s = await setup_two_teams(client, "FT")
    seeker = await player(client, "Joiner FT", "batsman", SECTOR_18)
    start = future(5, 7)
    await make_match(client, s["cap_b"], s["tb"], start=start, at=SECTOR_62, capacity=11)
    join = (await client.get(f"{API}/teams/discover?{NEAR}&radius_km=20&purpose=join&q=FT", headers=s["a1"].h)).json()[
        "data"
    ]
    by = {e["team"]["id"]: e for e in join}
    assert s["ta"] in by and by[s["ta"]]["my_membership"] == "member"  # join mode includes my own teams, flagged
    assert by[s["tb"]]["open_spots"] > 0 and by[s["tb"]]["next_open_match_id"]
    assert by[s["tb"]]["next_open_match_at"] and by[s["tb"]]["next_open_match_format"]
    assert isinstance(by[s["tb"]]["open_roles"], dict)
    recruiting = (
        await client.get(
            f"{API}/teams/discover?{NEAR}&radius_km=20&purpose=join&recruiting=true&q=FT", headers=seeker.h
        )
    ).json()["data"]
    assert [e["team"]["id"] for e in recruiting] == [s["tb"]]
    challenge = (await client.get(f"{API}/teams/discover?{NEAR}&radius_km=20&q=FT", headers=s["a1"].h)).json()["data"]
    assert s["ta"] not in {e["team"]["id"] for e in challenge}  # challenge mode still excludes own teams
