"""CricHeroes profile links (URL only — never fetched): players and teams."""

import httpx

from tests.api.test_competition import SECTOR_18, player, team

API = "/api/v1"
P_URL = "https://cricheroes.com/player-profile/4794795/nitin-daksh/stats"
T_URL = "https://cricheroes.com/team-profile/1275057/sfcc-noida-knights/stats"
BAD = [
    "http://cricheroes.com/player-profile/4794795/nitin-daksh/stats",  # not https
    "https://cricheroes.com.evil.com/player-profile/4794795/x",  # lookalike host
    "https://evilcricheroes.com/player-profile/4794795/x",
    "javascript:alert(1)//cricheroes.com/player-profile/1/x",
    "https://user:pw@cricheroes.com/player-profile/1/x",
    "https://cricheroes.com/team-profile/1275057/sfcc/stats",  # wrong profile type
    "https://cricheroes.com/player-profile/abc/x",
]


async def test_player_link_add_edit_remove_and_validation(client: httpx.AsyncClient) -> None:
    p = await player(client, "Linker CH", "batsman", SECTOR_18)
    base = {"primary_role": "batsman"}
    r = await client.put(
        f"{API}/players/me",
        headers=p.h,
        json={**base, "cricheroes_profile_url": "www.cricheroes.com/player-profile/4794795/nitin-daksh"},
    )
    assert r.status_code == 200, r.text
    me = r.json()["data"]
    assert me["cricheroes_profile_url"] == P_URL and me["cricheroes_player_id"] == "4794795"

    # unrelated edits keep the link
    r = await client.put(f"{API}/players/me", headers=p.h, json={**base, "locality": "Sector 18"})
    assert r.json()["data"]["cricheroes_profile_url"] == P_URL

    # shown to others (public profile + player detail rating profile)
    viewer = await player(client, "Viewer CH", "bowler", SECTOR_18)
    pub = (await client.get(f"{API}/players/{p.id}", headers=viewer.h)).json()["data"]
    assert pub["cricheroes_profile_url"] == P_URL
    rating = (await client.get(f"{API}/ratings/players/{p.id}", headers=viewer.h)).json()["data"]
    assert rating["cricheroes_profile_url"] == P_URL and rating["cricheroes_player_id"] == "4794795"

    for bad in BAD:
        rr = await client.put(f"{API}/players/me", headers=p.h, json={**base, "cricheroes_profile_url": bad})
        assert rr.status_code == 422, (bad, rr.text)
    assert (await client.get(f"{API}/players/me", headers=p.h)).json()["data"]["cricheroes_profile_url"] == P_URL

    # remove
    r = await client.put(f"{API}/players/me", headers=p.h, json={**base, "cricheroes_profile_url": None})
    assert r.json()["data"]["cricheroes_profile_url"] is None and r.json()["data"]["cricheroes_player_id"] is None
    assert (await client.get(f"{API}/ratings/players/{p.id}", headers=viewer.h)).json()["data"][
        "cricheroes_profile_url"
    ] is None


async def test_team_link_create_edit_remove_and_permissions(client: httpx.AsyncClient) -> None:
    cap = await player(client, "Captain CHT", "all_rounder", SECTOR_18)
    body = {
        "team_name": "Knights CHT",
        "location": {"lat": SECTOR_18[0], "lng": SECTOR_18[1]},
        "area": "Sector 18",
        "city": "Noida",
    }
    r = await client.post(f"{API}/teams", headers=cap.h, json={**body, "cricheroes_team_url": T_URL})
    assert r.status_code == 201, r.text
    t = r.json()["data"]
    assert t["cricheroes_team_url"] == T_URL and t["cricheroes_team_id"] == "1275057"
    tid = t["id"]
    dash = (await client.get(f"{API}/teams/{tid}/dashboard", headers=cap.h)).json()["data"]
    assert dash["cricheroes_team_url"] == T_URL

    bad = await client.post(
        f"{API}/teams",
        headers=cap.h,
        json={**body, "team_name": "Bad CHT", "cricheroes_team_url": "https://cricheroes.com/player-profile/1/x"},
    )
    assert bad.status_code == 422

    outsider = await player(client, "Outsider CHT", "batsman", SECTOR_18)
    assert (
        await client.put(f"{API}/teams/{tid}", headers=outsider.h, json={"cricheroes_team_url": None})
    ).status_code == 403

    new_url = "https://cricheroes.com/team-profile/999/knights-cht/stats"
    r = await client.put(f"{API}/teams/{tid}", headers=cap.h, json={"cricheroes_team_url": new_url})
    assert r.status_code == 200 and r.json()["data"]["cricheroes_team_id"] == "999"
    r = await client.put(f"{API}/teams/{tid}", headers=cap.h, json={"description": "Weekend side"})
    assert r.json()["data"]["cricheroes_team_url"] == new_url  # other edits keep it
    r = await client.put(f"{API}/teams/{tid}", headers=cap.h, json={"cricheroes_team_url": None})
    assert r.json()["data"]["cricheroes_team_url"] is None and r.json()["data"]["cricheroes_team_id"] is None

    plain = await team(client, cap, "Plain CHT", SECTOR_18, [])  # teams without a link keep working
    assert (await client.get(f"{API}/teams/{plain}/dashboard", headers=cap.h)).json()["data"][
        "cricheroes_team_url"
    ] is None
