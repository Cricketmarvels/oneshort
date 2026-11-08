import httpx

from tests.conftest import KORAMANGALA, make_player, make_team, register

API = "/api/v1"


async def test_team_creation_membership_and_admin_delegation(client: httpx.AsyncClient) -> None:
    captain = await make_player(client, "Team Skip", "batsman", KORAMANGALA)
    team_id = await make_team(client, captain, "Indiranagar Strikers", category="corporate")
    t = (await client.get(f"{API}/teams/{team_id}", headers=captain.h)).json()["data"]
    assert t["my_membership"] == "captain" and t["can_manage"] and t["member_count"] == 1
    me = (await client.get(f"{API}/users/me", headers=captain.h)).json()["data"]
    assert "captain" in me["roles"]  # same account is player + captain

    p = await make_player(client, "New Member", "bowler", KORAMANGALA)
    assert (
        await client.post(f"{API}/teams/{team_id}/members", headers=captain.h, json={"mobile_number": p.mobile})
    ).status_code == 204
    assert (
        await client.post(f"{API}/teams/{team_id}/members", headers=captain.h, json={"user_id": p.id})
    ).status_code == 409
    invites = (await client.get(f"{API}/teams/invitations", headers=p.h)).json()["data"]
    assert invites[0]["id"] == team_id
    assert (await client.post(f"{API}/teams/{team_id}/membership/accept", headers=p.h)).status_code == 204
    members = (await client.get(f"{API}/teams/{team_id}/members", headers=p.h)).json()["data"]
    assert {m["user"]["full_name"] for m in members} == {"Team Skip", "New Member"}

    # Non-manager cannot edit; delegated admin can.
    assert (await client.put(f"{API}/teams/{team_id}", headers=p.h, json={"description": "x"})).status_code == 403
    assert (
        await client.put(f"{API}/teams/{team_id}/members/{p.id}", headers=captain.h, json={"member_role": "admin"})
    ).status_code == 204
    r = await client.put(f"{API}/teams/{team_id}", headers=p.h, json={"description": "Corporate league side"})
    assert r.status_code == 200 and r.json()["data"]["description"] == "Corporate league side"
    # Admin cannot promote others to admin (captain only)
    q = await make_player(client, "Third", "batsman", KORAMANGALA)
    r = await client.post(f"{API}/teams/{team_id}/members", headers=p.h, json={"user_id": q.id, "member_role": "admin"})
    assert r.status_code == 403
    # Leave team
    assert (await client.delete(f"{API}/teams/{team_id}/members/{p.id}", headers=p.h)).status_code == 204
    t = (await client.get(f"{API}/teams/{team_id}", headers=captain.h)).json()["data"]
    assert t["member_count"] == 1
    # Captain cannot leave
    r = await client.delete(f"{API}/teams/{team_id}/members/{captain.id}", headers=captain.h)
    assert r.json()["error"]["code"] == "CAPTAIN_CANNOT_LEAVE"


async def test_team_requires_agreement(client: httpx.AsyncClient) -> None:
    u = await register(client, agree=False)
    r = await client.post(
        f"{API}/teams",
        headers=u.h,
        json={"team_name": "No Agreement XI", "location": {"lat": 12.9, "lng": 77.6}, "area": "A", "city": "B"},
    )
    assert r.status_code == 403 and r.json()["error"]["code"] == "AGREEMENT_REQUIRED"
