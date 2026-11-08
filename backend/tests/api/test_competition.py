"""Team challenges -> fixture -> result verification -> ratings -> leaderboards."""

from datetime import timedelta
from typing import Any

import httpx
from bson import ObjectId

from app.core.container import Container
from tests.conftest import TestUser as User
from tests.conftest import future, iso, register

API = "/api/v1"
SECTOR_18 = (28.5708, 77.3261)
SECTOR_62 = (28.6280, 77.3649)  # ~7.5 km from Sector 18
CONNAUGHT_PLACE = (28.6315, 77.2167)  # ~13 km


async def player(client: httpx.AsyncClient, name: str, role: str, at: tuple[float, float], city: str = "Noida") -> User:
    u = await register(client, name, city=city)
    r = await client.put(
        f"{API}/players/me",
        headers=u.h,
        json={"primary_role": role, "home_location": {"lat": at[0], "lng": at[1]}, "locality": "Sector 18"},
    )
    assert r.status_code == 200, r.text
    return u


async def team(client: httpx.AsyncClient, cap: User, name: str, at: tuple[float, float], members: list[User]) -> str:
    r = await client.post(
        f"{API}/teams",
        headers=cap.h,
        json={"team_name": name, "location": {"lat": at[0], "lng": at[1]}, "area": "Sector 18", "city": "Noida"},
    )
    assert r.status_code == 201, r.text
    tid = str(r.json()["data"]["id"])
    for m in members:
        assert (
            await client.post(f"{API}/teams/{tid}/members", headers=cap.h, json={"user_id": m.id})
        ).status_code == 204
        assert (await client.post(f"{API}/teams/{tid}/membership/accept", headers=m.h)).status_code == 204
    return tid


def proposal(days: int = 4, hour: int = 7, fmt: str = "T20") -> dict[str, Any]:
    return {
        "start_at": iso(future(days, hour)),
        "venue": {"name": "Noida Stadium", "area": "Sector 21A", "city": "Noida"},
        "format": fmt,
    }


async def setup_two_teams(client: httpx.AsyncClient, tag: str) -> dict[str, Any]:
    cap_a = await player(client, f"Captain A{tag}", "all_rounder", SECTOR_18)
    a1 = await player(client, f"Batter A{tag}", "batsman", SECTOR_18)
    a2 = await player(client, f"Bowler A{tag}", "bowler", SECTOR_18)
    cap_b = await player(client, f"Captain B{tag}", "all_rounder", SECTOR_62)
    b1 = await player(client, f"Batter B{tag}", "batsman", SECTOR_62)
    b2 = await player(client, f"Bowler B{tag}", "bowler", SECTOR_62)
    ta = await team(client, cap_a, f"Kings {tag}", SECTOR_18, [a1, a2])
    tb = await team(client, cap_b, f"Tech XI {tag}", SECTOR_62, [b1, b2])
    return {"cap_a": cap_a, "a1": a1, "a2": a2, "cap_b": cap_b, "b1": b1, "b2": b2, "ta": ta, "tb": tb}


async def confirmed_fixture(client: httpx.AsyncClient, s: dict[str, Any], days: int = 4) -> str:
    r = await client.post(
        f"{API}/challenges",
        headers=s["cap_a"].h,
        json={"from_team_id": s["ta"], "to_team_id": s["tb"], "proposal": proposal(days)},
    )
    assert r.status_code == 201, r.text
    cid = r.json()["data"]["id"]
    assert (await client.post(f"{API}/challenges/{cid}/accept", headers=s["cap_b"].h)).status_code == 200
    r = await client.post(f"{API}/challenges/{cid}/confirm", headers=s["cap_a"].h)
    assert r.status_code == 200, r.text
    return str(r.json()["data"]["fixture_id"])


def scorecard(s: dict[str, Any], winner_runs: int = 168, loser_runs: int = 141) -> dict[str, Any]:
    ta, tb = s["ta"], s["tb"]
    return {
        "result_type": "won",
        "winner_team_id": ta,
        "innings": [
            {"batting_team_id": ta, "runs": winner_runs, "wickets": 6, "balls": 120},
            {"batting_team_id": tb, "runs": loser_runs, "wickets": 9, "balls": 120},
        ],
        "players": [
            {
                "user_id": s["cap_a"].id,
                "team_id": ta,
                "batting": {"runs": 34, "balls": 25, "fours": 3, "sixes": 1},
                "bowling": {"balls": 24, "runs": 30, "wickets": 2},
            },
            {
                "user_id": s["a1"].id,
                "team_id": ta,
                "batting": {"runs": 72, "balls": 44, "fours": 8, "sixes": 3, "out": False},
                "fielding": {"catches": 2},
            },
            {
                "user_id": s["a2"].id,
                "team_id": ta,
                "batting": {"runs": 4, "balls": 6},
                "bowling": {"balls": 24, "runs": 19, "wickets": 3},
            },
            {
                "user_id": s["cap_b"].id,
                "team_id": tb,
                "batting": {"runs": 51, "balls": 40, "fours": 5, "sixes": 1},
                "bowling": {"balls": 24, "runs": 36, "wickets": 1},
            },
            {"user_id": s["b1"].id, "team_id": tb, "batting": {"runs": 12, "balls": 15, "fours": 1}},
            {
                "user_id": s["b2"].id,
                "team_id": tb,
                "batting": {"runs": 2, "balls": 5},
                "bowling": {"balls": 24, "runs": 44, "wickets": 1},
            },
        ],
    }


async def backdate(container: Container, fid: str) -> None:
    from app.common.types import utcnow

    await container.mongo["fixtures"].update_one(
        {"_id": ObjectId(fid)}, {"$set": {"start_at": utcnow() - timedelta(hours=5)}}
    )


async def test_challenge_workflow_counter_confirm_and_guards(client: httpx.AsyncClient) -> None:
    s = await setup_two_teams(client, "CW")
    body = {"from_team_id": s["ta"], "to_team_id": s["tb"], "proposal": proposal(), "message": "Sunday?"}
    # Non-manager can't challenge on the team's behalf
    assert (await client.post(f"{API}/challenges", headers=s["a1"].h, json=body)).status_code == 403
    r = await client.post(f"{API}/challenges", headers=s["cap_a"].h, json=body)
    assert r.status_code == 201, r.text
    ch = r.json()["data"]
    assert ch["status"] == "pending" and ch["awaiting_team_id"] == s["tb"] and ch["actions"] == ["cancel"]
    cid = ch["id"]
    # Duplicate active challenge for the same pair & day (either direction)
    rev = {"from_team_id": s["tb"], "to_team_id": s["ta"], "proposal": proposal()}
    r = await client.post(f"{API}/challenges", headers=s["cap_b"].h, json=rev)
    assert r.status_code == 409 and r.json()["error"]["code"] == "DUPLICATE_CHALLENGE"
    # Incoming box + notification for B's captain
    inbox = (await client.get(f"{API}/challenges?box=incoming", headers=s["cap_b"].h)).json()["data"]
    assert [c["id"] for c in inbox] == [cid] and set(inbox[0]["actions"]) == {"accept", "counter", "reject"}
    notes = (await client.get(f"{API}/notifications", headers=s["cap_b"].h)).json()
    assert any(n["type"] == "team_challenge" for n in notes["data"])
    # Proposer can't accept own proposal; B counters with a new time
    r = await client.post(f"{API}/challenges/{cid}/accept", headers=s["cap_a"].h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_CHALLENGE_TRANSITION"
    r = await client.post(
        f"{API}/challenges/{cid}/counter-propose",
        headers=s["cap_b"].h,
        json={"proposal": proposal(5, 16, "T10"), "message": "Evening T10?"},
    )
    assert r.status_code == 200 and r.json()["data"]["status"] == "counter_proposed"
    assert r.json()["data"]["proposal"]["overs"] == 10 and len(r.json()["data"]["history"]) == 2
    # A accepts the counter; B (the proposer) must confirm
    r = await client.post(f"{API}/challenges/{cid}/accept", headers=s["cap_a"].h)
    assert r.json()["data"]["status"] == "accepted" and r.json()["data"]["awaiting_team_id"] == s["tb"]
    r = await client.post(f"{API}/challenges/{cid}/confirm", headers=s["cap_a"].h)
    assert r.status_code == 422
    r = await client.post(f"{API}/challenges/{cid}/confirm", headers=s["cap_b"].h)
    assert r.status_code == 200 and r.json()["data"]["status"] == "confirmed"
    fid = r.json()["data"]["fixture_id"]
    # Fixture in both teams' schedules, visible to ordinary members
    for u in (s["a1"], s["b2"]):
        fixtures = (await client.get(f"{API}/fixtures", headers=u.h)).json()["data"]
        assert fid in [f["id"] for f in fixtures]
    fx = (await client.get(f"{API}/fixtures/{fid}", headers=s["a1"].h)).json()["data"]
    assert fx["format"] == "T10" and fx["actions"] == []  # ordinary member: no actions
    # Scheduling conflict: A already plays within 4 hours of that slot
    cap_c = await player(client, "Captain CW3", "batsman", SECTOR_18)
    tc = await team(client, cap_c, "Strikers CW", SECTOR_18, [])
    r = await client.post(
        f"{API}/challenges",
        headers=cap_c.h,
        json={"from_team_id": tc, "to_team_id": s["ta"], "proposal": proposal(5, 17)},
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "SCHEDULE_CONFLICT"
    # Draft is invisible to the other team until sent; reject flow
    r = await client.post(
        f"{API}/challenges",
        headers=cap_c.h,
        json={"from_team_id": tc, "to_team_id": s["tb"], "proposal": proposal(9), "send": False},
    )
    draft = r.json()["data"]
    assert draft["status"] == "draft"
    assert (await client.get(f"{API}/challenges/{draft['id']}", headers=s["cap_b"].h)).status_code == 404
    assert (await client.post(f"{API}/challenges/{draft['id']}/send", headers=cap_c.h)).json()["data"][
        "status"
    ] == "pending"
    r = await client.post(f"{API}/challenges/{draft['id']}/reject", headers=s["cap_b"].h, json={"message": "Booked"})
    assert r.json()["data"]["status"] == "rejected" and r.json()["data"]["actions"] == []
    # Cancelling a confirmed challenge cancels its fixture
    r = await client.post(f"{API}/challenges/{cid}/cancel", headers=s["cap_a"].h)
    assert r.json()["data"]["status"] == "cancelled"
    assert (await client.get(f"{API}/fixtures/{fid}", headers=s["a1"].h)).json()["data"]["status"] == "cancelled"


async def test_result_verification_dispute_ratings_and_leaderboards(
    client: httpx.AsyncClient, container: Container
) -> None:
    s = await setup_two_teams(client, "RV")
    fid = await confirmed_fixture(client, s)
    r = await client.post(f"{API}/fixtures/{fid}/result", headers=s["cap_a"].h, json=scorecard(s))
    assert r.json()["error"]["code"] == "MATCH_NOT_STARTED"
    await backdate(container, fid)
    # Scorecard validation
    bad = scorecard(s, winner_runs=120, loser_runs=141)
    r = await client.post(f"{API}/fixtures/{fid}/result", headers=s["cap_a"].h, json=bad)
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_SCORECARD"
    outsider = await player(client, "Outsider RV", "batsman", SECTOR_18)
    bad = scorecard(s)
    bad["players"][0]["user_id"] = outsider.id
    assert (await client.post(f"{API}/fixtures/{fid}/result", headers=s["cap_a"].h, json=bad)).status_code == 422
    # Ordinary player can't submit; captain submits
    assert (await client.post(f"{API}/fixtures/{fid}/result", headers=s["a1"].h, json=scorecard(s))).status_code == 403
    r = await client.post(f"{API}/fixtures/{fid}/result", headers=s["cap_a"].h, json=scorecard(s, loser_runs=150))
    assert r.status_code == 200 and r.json()["data"]["result"]["status"] == "submitted"
    # Submitting team can't verify its own result
    r = await client.post(f"{API}/fixtures/{fid}/verify", headers=s["cap_a"].h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "NOT_OPPOSING_MANAGER"
    # Opposing captain disputes -> held, ratings untouched
    r = await client.post(
        f"{API}/fixtures/{fid}/dispute", headers=s["cap_b"].h, json={"reason": "We scored 141, not 150"}
    )
    assert r.json()["data"]["result"]["status"] == "disputed"
    assert await container.mongo["player_ratings"].count_documents({"user_id": ObjectId(s["a1"].id)}) == 0
    assert await container.mongo["team_ratings"].count_documents({"team_id": ObjectId(s["ta"])}) == 0
    # Corrected resubmission, then verification makes it official
    r = await client.post(f"{API}/fixtures/{fid}/result", headers=s["cap_a"].h, json=scorecard(s))
    assert r.json()["data"]["result"]["status"] == "submitted"
    r = await client.post(f"{API}/fixtures/{fid}/verify", headers=s["cap_b"].h)
    fx = r.json()["data"]
    assert fx["status"] == "completed" and fx["result"]["status"] == "confirmed" and fx["result"]["ratings_applied"]
    assert fx["result"]["summary"] == "Kings RV won by 27 runs"
    # Verify again is rejected (idempotent ratings)
    assert (await client.post(f"{API}/fixtures/{fid}/verify", headers=s["cap_b"].h)).status_code == 422

    # Ratings: winners up, losers down, explained from real numbers
    a1 = (await client.get(f"{API}/ratings/players/{s['a1'].id}", headers=s["b1"].h)).json()["data"]
    b2 = (await client.get(f"{API}/ratings/players/{s['b2'].id}", headers=s["b1"].h)).json()["data"]
    assert a1["verified_matches"] == 1 and a1["overall"]["provisional"] and a1["overall"]["rating"] > 1500
    assert a1["batting"]["matches"] == 1 and a1["bowling"]["matches"] == 0
    assert b2["overall"]["rating"] < a1["overall"]["rating"]
    assert a1["career"]["runs"] == 72 and a1["career"]["catches"] == 2
    hist = (await client.get(f"{API}/ratings/players/{s['a1'].id}/history", headers=s["a1"].h)).json()
    reasons = hist["data"][0]["reasons"]
    assert any(x.startswith("Batting +") and "72* off 44" in x for x in reasons)
    teams = (
        await container.mongo["team_ratings"]
        .find({"team_id": {"$in": [ObjectId(s["ta"]), ObjectId(s["tb"])]}})
        .to_list()
    )
    by_id = {str(t["team_id"]): t for t in teams}
    assert by_id[s["ta"]]["rating"] > 1500 > by_id[s["tb"]]["rating"]
    assert by_id[s["ta"]]["won"] == 1 and by_id[s["tb"]]["lost"] == 1
    ch = (await client.get(f"{API}/challenges?status=completed", headers=s["cap_a"].h)).json()["data"]
    assert len(ch) == 1

    # Leaderboards
    lb = (
        await client.get(f"{API}/players/leaderboard?scope=city&city=Noida&category=batting", headers=s["a1"].h)
    ).json()
    names = [e["user"]["full_name"] for e in lb["data"]]
    assert "Batter ARV" in names and lb["me"]["user"]["id"] == s["a1"].id
    assert all("location" not in e and "lat" not in str(e) for e in lb["data"])
    near = (
        await client.get(
            f"{API}/players/leaderboard?scope=5km&lat={SECTOR_18[0]}&lng={SECTOR_18[1]}", headers=s["a1"].h
        )
    ).json()
    near_names = {e["user"]["full_name"] for e in near["data"]}
    assert "Batter ARV" in near_names and "Batter BRV" not in near_names  # Sector 62 is ~7.5 km away
    assert all(e["distance_km"] is not None and e["distance_km"] % 0.5 == 0 for e in near["data"])
    wide = (
        await client.get(
            f"{API}/players/leaderboard?scope=10km&lat={SECTOR_18[0]}&lng={SECTOR_18[1]}&page_size=100",
            headers=s["a1"].h,
        )
    ).json()
    assert "Batter BRV" in {e["user"]["full_name"] for e in wide["data"]}
    r = await client.get(f"{API}/players/leaderboard?scope=5km", headers=(await register(client, "No Home")).h)
    assert r.json()["error"]["code"] == "LOCATION_REQUIRED"
    fmt = (await client.get(f"{API}/players/leaderboard?scope=national&format=T20", headers=s["a1"].h)).json()
    assert fmt["meta"]["insufficient_data"] in (True, False) and all(e["matches"] >= 3 for e in fmt["data"])
    tl = (await client.get(f"{API}/teams/leaderboard?scope=city&city=Noida", headers=s["a1"].h)).json()
    rows = {e["team"]["id"]: e for e in tl["data"]}
    assert rows[s["ta"]]["rank"] < rows[s["tb"]]["rank"] and rows[s["ta"]]["form"] == ["W"]
    cmp = (await client.get(f"{API}/players/compare?a={s['a1'].id}&b={s['b1'].id}", headers=s["a1"].h)).json()["data"]
    assert cmp["a"]["batting"]["rating"] > cmp["b"]["batting"]["rating"]
    h2h = (await client.get(f"{API}/teams/{s['ta']}/head-to-head/{s['tb']}", headers=s["a1"].h)).json()["data"]
    assert (h2h["played"], h2h["a_wins"], h2h["b_wins"]) == (1, 1, 0)

    # Dashboard: managers see join requests; members don't
    joiner = await player(client, "Joiner RV", "bowler", SECTOR_18)
    assert (await client.post(f"{API}/teams/{s['ta']}/join-requests", headers=joiner.h)).status_code == 204
    dash = (await client.get(f"{API}/teams/{s['ta']}/dashboard", headers=s["cap_a"].h)).json()["data"]
    assert dash["can_manage"] and [j["user"]["id"] for j in dash["join_requests"]] == [joiner.id]
    assert dash["record"]["won"] == 1 and dash["streak"] == "1W" and dash["head_to_head"][0]["played"] == 1
    assert dash["contributions"][0]["matches"] == 1
    member_view = (await client.get(f"{API}/teams/{s['ta']}/dashboard", headers=s["a1"].h)).json()["data"]
    assert not member_view["can_manage"] and member_view["join_requests"] == []
    assert (
        await client.post(f"{API}/teams/{s['ta']}/join-requests/{joiner.id}/approve", headers=s["a1"].h)
    ).status_code == 403
    assert (
        await client.post(f"{API}/teams/{s['ta']}/join-requests/{joiner.id}/approve", headers=s["cap_a"].h)
    ).status_code == 204

    # Admin voids the confirmed result -> ratings recomputed without it
    admin = await register(client, "Admin RV")
    await container.mongo["users"].update_one({"_id": ObjectId(admin.id)}, {"$addToSet": {"roles": "admin"}})
    r = await client.post(
        f"{API}/admin/fixtures/{fid}/resolve",
        headers=admin.h,
        json={"action": "void", "reason": "Ground was never booked"},
    )
    assert r.status_code == 200 and r.json()["data"]["result"]["status"] == "voided"
    assert await container.mongo["player_ratings"].count_documents({"user_id": ObjectId(s["a1"].id)}) == 0
    a1 = (await client.get(f"{API}/ratings/players/{s['a1'].id}", headers=s["a1"].h)).json()["data"]
    assert a1["verified_matches"] == 0 and a1["summary"][0].startswith("No verified matches")


async def test_admin_confirms_disputed_result(client: httpx.AsyncClient, container: Container) -> None:
    s = await setup_two_teams(client, "AD")
    fid = await confirmed_fixture(client, s, days=6)
    await backdate(container, fid)
    await client.post(f"{API}/fixtures/{fid}/result", headers=s["cap_b"].h, json=scorecard(s))
    await client.post(
        f"{API}/fixtures/{fid}/dispute", headers=s["cap_a"].h, json={"reason": "Check the bowling figures"}
    )
    admin = await register(client, "Admin AD")
    assert (await client.get(f"{API}/admin/fixtures/disputed", headers=admin.h)).status_code == 403
    await container.mongo["users"].update_one({"_id": ObjectId(admin.id)}, {"$addToSet": {"roles": "admin"}})
    queue = (await client.get(f"{API}/admin/fixtures/disputed", headers=admin.h)).json()["data"]
    assert fid in [f["id"] for f in queue]
    r = await client.post(
        f"{API}/admin/fixtures/{fid}/resolve",
        headers=admin.h,
        json={"action": "confirm", "reason": "Scorebook photo checked"},
    )
    assert r.json()["data"]["result"]["status"] == "confirmed"
    assert await container.mongo["player_ratings"].count_documents({"user_id": ObjectId(s["a1"].id)}) == 1
    audit = await container.mongo["audit_logs"].find_one(
        {"entity_id": ObjectId(fid), "action": "fixture.result_confirmed_by_admin"}
    )
    assert audit and str(audit["actor_id"]) == admin.id


async def test_team_discovery_for_challenges(client: httpx.AsyncClient) -> None:
    s = await setup_two_teams(client, "TD")
    far_cap = await player(client, "Captain Far", "batsman", CONNAUGHT_PLACE, city="Delhi")
    far = await team(client, far_cap, "CP Gymkhana TD", CONNAUGHT_PLACE, [])
    r = await client.get(
        f"{API}/teams/discover?lat={SECTOR_18[0]}&lng={SECTOR_18[1]}&radius_km=10&from_team_id={s['ta']}&q=TD",
        headers=s["cap_a"].h,
    )
    ids = [e["team"]["id"] for e in r.json()["data"]]
    assert s["tb"] in ids and s["ta"] not in ids and far not in ids
    assert all("location" not in str(e) for e in r.json()["data"])


async def test_home_command_centre(client: httpx.AsyncClient, container: Container) -> None:
    s = await setup_two_teams(client, "HM")
    fid = await confirmed_fixture(client, s, days=8)
    home = (await client.get(f"{API}/home", headers=s["cap_a"].h)).json()["data"]
    assert home["greeting_name"] == "Captain" and home["has_location"]
    assert fid in [f["id"] for f in home["upcoming"]] and home["managed_team_ids"] == [s["ta"]]
    assert home["rating"] is None and home["spotlight"] is None or home["spotlight"]["gain"] > 0
    await backdate(container, fid)
    await client.post(f"{API}/fixtures/{fid}/result", headers=s["cap_a"].h, json=scorecard(s))
    home_b = (await client.get(f"{API}/home", headers=s["cap_b"].h)).json()["data"]
    assert [f["id"] for f in home_b["awaiting_result"]] == [fid]
    await client.post(f"{API}/fixtures/{fid}/verify", headers=s["cap_b"].h)
    home = (await client.get(f"{API}/home", headers=s["a1"].h)).json()["data"]
    assert home["rating"]["provisional"] and home["verified_matches"] == 1 and home["rank_city"] >= 1
