"""Captain invite links: share in WhatsApp group → register (if new) → add myself to team + squad."""

import httpx

from tests.api.test_competition import SECTOR_18, player, team
from tests.conftest import future, make_match

API = "/api/v1"


async def test_invite_link_register_join_and_revoke(client: httpx.AsyncClient) -> None:
    cap = await player(client, "Captain IL", "all_rounder", SECTOR_18)
    tid = await team(client, cap, "Knights IL", SECTOR_18, [])
    match_id = (await make_match(client, cap, tid, start=future(3, 7), at=SECTOR_18, capacity=11))["id"]

    r = await client.post(f"{API}/matches/{match_id}/invite-link", headers=cap.h)
    assert r.status_code == 200, r.text
    link = r.json()["data"]
    code = link["code"]
    assert link["path"] == f"/join/{code}" and "Knights IL" in link["message"] and link["uses"] == 0
    again = (await client.post(f"{API}/matches/{match_id}/invite-link", headers=cap.h)).json()["data"]
    assert again["code"] == code  # reused, not regenerated

    prev = (await client.get(f"{API}/join/{code}")).json()["data"]  # public, no auth
    assert prev["team_name"] == "Knights IL" and prev["status"] == "open" and prev["spots_left"] >= 1
    assert "name" not in prev and "lat" not in str(prev)

    reg = await client.post(
        f"{API}/auth/invite-register",
        json={
            "code": code,
            "full_name": "Regular IL",
            "mobile_number": "+919811100077",
            "email": "regular.il@example.in",
            "password": "Str0ngPassw0rd!",
        },
    )
    assert reg.status_code == 201, reg.text
    tok = reg.json()["data"]
    h = {"Authorization": f"Bearer {tok['access_token']}"}
    me = (await client.get(f"{API}/users/me", headers=h)).json()["data"]
    assert me["full_name"] == "Regular IL"
    login = await client.post(
        f"{API}/auth/login", json={"email": "regular.il@example.in", "password": "Str0ngPassw0rd!"}
    )
    assert login.status_code == 200, login.text  # password login works before OTP verification
    dup = await client.post(
        f"{API}/auth/invite-register",
        json={
            "code": code,
            "full_name": "Xavier Dup",
            "mobile_number": "+919811100077",
            "email": "other.il@example.in",
            "password": "Str0ngPassw0rd!",
        },
    )
    assert dup.status_code == 422 and dup.json()["error"]["code"] == "ACCOUNT_EXISTS"

    # accept the agreement if required, create a player profile, then join
    cur = (await client.get(f"{API}/agreements/current")).json()["data"]["version"]
    await client.post(
        f"{API}/agreements/acceptance",
        headers=h,
        json={"version": cur, "accepted": True, "age_confirmed": True, "privacy_acknowledged": True},
    )
    assert (await client.put(f"{API}/players/me", headers=h, json={"primary_role": "bowler"})).status_code == 200
    j = await client.post(f"{API}/join/{code}", headers=h, json={})
    assert j.status_code == 200, j.text
    assert j.json()["data"]["status"] == "joined"
    assert (await client.post(f"{API}/join/{code}", headers=h, json={})).json()["data"]["status"] == "already_in"

    roster = (await client.get(f"{API}/matches/{match_id}/roster", headers=cap.h)).json()["data"]
    assert any(e["player"]["full_name"] == "Regular IL" for e in roster["active"])
    members = (await client.get(f"{API}/teams/{tid}/members", headers=cap.h)).json()["data"]
    assert any(m["user"]["full_name"] == "Regular IL" and m["status"] == "active" for m in members)
    after = (await client.post(f"{API}/matches/{match_id}/invite-link", headers=cap.h)).json()["data"]
    assert after["uses"] == 1 and after["joined"] == ["Regular IL"]

    assert (await client.delete(f"{API}/matches/{match_id}/invite-link", headers=cap.h)).status_code == 204
    assert (await client.get(f"{API}/join/{code}")).json()["data"]["status"] == "closed"
    stranger = await player(client, "Late IL", "batsman", SECTOR_18)
    late = await client.post(f"{API}/join/{code}", headers=stranger.h, json={})
    assert late.status_code == 422 and late.json()["error"]["code"] == "INVITE_CLOSED"
    other = await player(client, "Nosy IL", "batsman", SECTOR_18)
    assert (await client.post(f"{API}/matches/{match_id}/invite-link", headers=other.h)).status_code in (403, 404)
