import httpx

from tests.conftest import KORAMANGALA, register

API = "/api/v1"


async def test_agreement_flow(client: httpx.AsyncClient) -> None:
    u = await register(client, agree=False)
    cur = (await client.get(f"{API}/agreements/current")).json()["data"]
    assert cur["version"] == 2 and len(cur["sections"]) >= 12
    r = await client.post(
        f"{API}/agreements/acceptance", headers=u.h, json={"version": cur["version"], "accepted": False}
    )
    assert r.status_code == 422
    r = await client.post(f"{API}/agreements/acceptance", headers=u.h, json={"version": 99, "accepted": True})
    assert r.json()["error"]["code"] == "AGREEMENT_VERSION_MISMATCH"
    r = await client.post(
        f"{API}/agreements/acceptance", headers=u.h, json={"version": cur["version"], "accepted": True, "age_confirmed": True, "privacy_acknowledged": True}
    )
    assert r.status_code == 200 and r.json()["data"]["satisfied"] is True
    mine = (await client.get(f"{API}/agreements/me", headers=u.h)).json()["data"]
    assert mine["acceptances"][0]["agreement_version"] == 2
    me = (await client.get(f"{API}/users/me", headers=u.h)).json()["data"]
    assert me["agreement"]["satisfied"] is True


async def test_player_profile_create_and_public_view_hides_location(client: httpx.AsyncClient) -> None:
    u = await register(client, "Jasprit Rao")
    r = await client.put(
        f"{API}/players/me",
        headers=u.h,
        json={
            "primary_role": "bowler",
            "secondary_roles": ["bowler", "batsman"],
            "bowling_style": "right_arm_fast",
            "experience_years": 6,
            "preferred_formats": ["T20"],
            "cricheroes_url": "https://cricheroes.com/player-profile/123",
            "home_location": {"lat": KORAMANGALA[0], "lng": KORAMANGALA[1]},
        },
    )
    assert r.status_code == 200, r.text
    me = r.json()["data"]
    assert me["secondary_roles"] == ["batsman"]  # primary removed from secondary
    assert me["home_location"]["lat"] == KORAMANGALA[0]
    assert "profile_image" in me["missing_fields"]

    other = await register(client, "Viewer")
    pub = await client.get(f"{API}/players/{u.id}", headers=other.h)
    assert pub.status_code == 200
    body = pub.text
    assert "home_location" not in body and str(KORAMANGALA[0]) not in body
    assert "mobile" not in body


async def test_player_profile_validation(client: httpx.AsyncClient) -> None:
    u = await register(client)
    r = await client.put(
        f"{API}/players/me", headers=u.h, json={"primary_role": "keeper", "cricheroes_url": "https://evil.example.com"}
    )
    assert r.status_code == 422
    r = await client.put(f"{API}/players/me", headers=u.h, json={"primary_role": "batsman", "unknown_field": 1})
    assert r.status_code == 422


async def test_captain_profile(client: httpx.AsyncClient) -> None:
    u = await register(client, "Captain Dhoni")
    r = await client.put(f"{API}/captains/me", headers=u.h, json={"bio": "Weekend skipper"})
    assert r.status_code == 200
    assert r.json()["data"]["bio"] == "Weekend skipper"
    me = (await client.get(f"{API}/users/me", headers=u.h)).json()["data"]
    assert "captain" in me["roles"] and "player" in me["roles"]
    assert me["has_captain_profile"] is True
