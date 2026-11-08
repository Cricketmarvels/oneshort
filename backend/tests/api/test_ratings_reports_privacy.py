from datetime import timedelta

import httpx
from bson import ObjectId

from tests.conftest import HSR_LAYOUT, KORAMANGALA, add_slot, future, make_match, make_player, make_team, register

API = "/api/v1"


async def _completed_match(client: httpx.AsyncClient, container, day: int):  # type: ignore[no-untyped-def]
    captain = await make_player(client, f"Rate Skip {day}", "all_rounder", KORAMANGALA)
    team = await make_team(client, captain, f"Rating XI {day}")
    start = future(day)
    match = await make_match(client, captain, team, start=start, capacity=4)
    players = []
    for i in range(3):
        p = await make_player(client, f"R{day}-{i}", "batsman", HSR_LAYOUT)
        await add_slot(client, p, start - timedelta(hours=1), hours=5)
        players.append(p)
    res = (
        await client.post(
            f"{API}/matches/{match['id']}/invitations",
            headers=captain.h,
            json={"invites": [{"player_id": p.id} for p in players]},
        )
    ).json()["data"]
    for p, r in zip(players, res, strict=True):
        await client.post(f"{API}/invitations/{r['invitation_id']}/accept", headers=p.h)
        await client.post(f"{API}/invitations/{r['invitation_id']}/confirm", headers=captain.h)
    # Not yet completed → no ratings
    r = await client.post(
        f"{API}/matches/{match['id']}/ratings",
        headers=players[0].h,
        json={"reviewed_user_id": captain.id, "scores": {"overall": 5}},
    )
    assert r.json()["error"]["code"] == "MATCH_NOT_COMPLETED"
    # Move the match into the past (test shortcut) and complete with attendance.
    past = start - timedelta(days=day + 1)
    await container.mongo["matches"].update_one(
        {"_id": ObjectId(match["id"])},
        {"$set": {"start_at": past, "end_at": past + timedelta(hours=3), "match_status": "scheduled"}},
    )
    r = await client.post(
        f"{API}/matches/{match['id']}/complete",
        headers=captain.h,
        json={
            "attendance": [
                {"player_id": players[0].id, "attendance": "present"},
                {"player_id": players[1].id, "attendance": "late"},
                {"player_id": players[2].id, "attendance": "no_show"},
            ]
        },
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["match_status"] == "completed"
    return captain, match, players


async def test_verified_match_ratings(client: httpx.AsyncClient, container) -> None:  # type: ignore[no-untyped-def]
    captain, match, (a, b, no_show) = await _completed_match(client, container, 60)
    mid = match["id"]
    # Player rates captain with captain categories
    r = await client.post(
        f"{API}/matches/{mid}/ratings",
        headers=a.h,
        json={
            "reviewed_user_id": captain.id,
            "comment": "Fair rotation, everyone batted",
            "scores": {
                "behaviour": 5,
                "fair_opportunities": 5,
                "team_management": 4,
                "communication": 4,
                "punctuality": 5,
                "overall": 5,
            },
        },
    )
    assert r.status_code == 201, r.text and r.json()["data"]["rating_type"] == "captain"
    # Duplicate prevented
    r = await client.post(
        f"{API}/matches/{mid}/ratings", headers=a.h, json={"reviewed_user_id": captain.id, "scores": {"overall": 1}}
    )
    assert r.status_code == 409 and r.json()["error"]["code"] == "DUPLICATE_RATING"
    # Wrong categories for a player rating
    r = await client.post(
        f"{API}/matches/{mid}/ratings",
        headers=captain.h,
        json={"reviewed_user_id": a.id, "scores": {"fair_opportunities": 5, "overall": 5}},
    )
    assert r.json()["error"]["code"] == "INVALID_CATEGORIES"
    r = await client.post(
        f"{API}/matches/{mid}/ratings",
        headers=captain.h,
        json={
            "reviewed_user_id": a.id,
            "scores": {"punctuality": 5, "behaviour": 5, "sportsmanship": 5, "participation": 5, "overall": 5},
        },
    )
    assert r.status_code == 201
    # No-show is not a verified participant; outsiders can't rate.
    r = await client.post(
        f"{API}/matches/{mid}/ratings",
        headers=no_show.h,
        json={"reviewed_user_id": captain.id, "scores": {"overall": 1}},
    )
    assert r.status_code == 403
    outsider = await register(client)
    r = await client.post(
        f"{API}/matches/{mid}/ratings",
        headers=outsider.h,
        json={"reviewed_user_id": captain.id, "scores": {"overall": 1}},
    )
    assert r.status_code == 403
    r = await client.post(
        f"{API}/matches/{mid}/ratings", headers=b.h, json={"reviewed_user_id": b.id, "scores": {"overall": 5}}
    )
    assert r.json()["error"]["code"] == "SELF_RATING"
    # Reputation aggregates
    cap = (await client.get(f"{API}/users/{captain.id}/ratings?type=captain", headers=b.h)).json()["data"]
    assert cap["average_rating"] == 5 and cap["rating_count"] == 1 and cap["breakdown"]["team_management"] == 4
    pl = (await client.get(f"{API}/users/{a.id}/ratings?type=player", headers=b.h)).json()["data"]
    assert pl["average_rating"] == 5 and pl["matches_played"] == 1
    ns = (await client.get(f"{API}/players/{no_show.id}", headers=b.h)).json()["data"]
    pa = (await client.get(f"{API}/players/{a.id}", headers=b.h)).json()["data"]
    assert ns["stats"]["no_shows"] == 1 and ns["reliability_score"] < pa["reliability_score"]
    pending = (await client.get(f"{API}/matches/{mid}/ratings/pending", headers=a.h)).json()["data"]
    assert [p["already_rated"] for p in pending if p["rating_type"] == "captain"] == [True]


async def test_misbehaviour_reporting_and_moderation(client: httpx.AsyncClient, container) -> None:  # type: ignore[no-untyped-def]
    reporter = await register(client, "Reporter")
    target = await make_player(client, "Hothead", "bowler", KORAMANGALA)
    r = await client.post(
        f"{API}/reports",
        headers=reporter.h,
        json={
            "target_user_id": target.id,
            "category": "abusive_language",
            "description": "Repeatedly abused the umpire and opposition during Sunday's match.",
        },
    )
    assert r.status_code == 201, r.text
    rid = r.json()["data"]["id"]
    dup = await client.post(
        f"{API}/reports",
        headers=reporter.h,
        json={
            "target_user_id": target.id,
            "category": "abusive_language",
            "description": "Same issue again, reporting.",
        },
    )
    assert dup.status_code == 409
    assert (
        await client.post(
            f"{API}/reports",
            headers=reporter.h,
            json={"target_user_id": reporter.id, "category": "other", "description": "reporting myself here"},
        )
    ).status_code == 422
    # Non-admin cannot access moderation
    assert (await client.get(f"{API}/admin/reports", headers=reporter.h)).status_code == 403
    admin = await register(client, "Admin")
    await container.mongo["users"].update_one({"_id": ObjectId(admin.id)}, {"$addToSet": {"roles": "admin"}})
    lst = (await client.get(f"{API}/admin/reports?status=open", headers=admin.h)).json()
    assert any(x["id"] == rid for x in lst["data"])
    r = await client.put(
        f"{API}/admin/reports/{rid}",
        headers=admin.h,
        json={
            "note": "Two witnesses confirmed.",
            "status": "resolved",
            "action": {"type": "restrict_matchmaking", "reason": "Abusive language"},
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()["data"]
    assert body["status"] == "resolved" and body["actions"][0]["action"] == "restrict_matchmaking"
    assert body["investigation_notes"][0]["note"] == "Two witnesses confirmed."
    r = await client.post(f"{API}/discovery/teams", headers=target.h, json={"radius_km": 5})
    assert r.status_code == 403 and r.json()["error"]["code"] == "MATCHMAKING_RESTRICTED"
    # Temporary suspension blocks all authenticated access
    await client.put(
        f"{API}/admin/reports/{rid}",
        headers=admin.h,
        json={"action": {"type": "temp_suspend", "days": 7, "reason": "Repeat offence"}},
    )
    r = await client.get(f"{API}/users/me", headers=target.h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "ACCOUNT_SUSPENDED"
    mine = (await client.get(f"{API}/reports/me", headers=reporter.h)).json()["data"]
    assert mine[0]["status"] == "resolved"
    notes = (await client.get(f"{API}/notifications", headers=reporter.h)).json()["data"]
    assert any(n["type"] == "report_update" for n in notes)


async def test_account_deletion_anonymises(client: httpx.AsyncClient, container) -> None:  # type: ignore[no-untyped-def]
    u = await make_player(client, "Leaving Player", "batsman", KORAMANGALA)
    await add_slot(client, u, future(70))
    export = (await client.get(f"{API}/users/me/export", headers=u.h)).json()["data"]
    assert export["user"]["full_name"] == "Leaving Player" and len(export["availability"]) == 1
    assert "password_hash" not in export["user"]
    r = await client.request("DELETE", f"{API}/users/me", headers=u.h, json={"confirm": "DELETE"})
    assert r.status_code == 204
    doc = await container.mongo["users"].find_one({"_id": ObjectId(u.id)})
    assert doc["full_name"] == "Deleted player" and doc["mobile_number"] is None and doc["email"] is None
    prof = await container.mongo["player_profiles"].find_one({"user_id": ObjectId(u.id)})
    assert "home_location" not in prof
    assert await container.mongo["availability"].count_documents({"player_id": ObjectId(u.id)}) == 0
    assert (await client.get(f"{API}/users/me", headers=u.h)).status_code == 401
    assert (await client.post(f"{API}/auth/refresh", json={"refresh_token": u.refresh})).status_code == 401
    # The mobile number can register again as a new account.
    r = await client.post(
        f"{API}/auth/register",
        json={"full_name": "Fresh Start", "mobile_number": u.mobile, "email": "fresh@example.com"},
    )
    assert r.status_code == 201


async def test_dashboard_and_upload(client: httpx.AsyncClient) -> None:
    u = await make_player(client, "Dash Player", "batsman", KORAMANGALA)
    r = await client.get(f"{API}/dashboard", headers=u.h)
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["greeting_name"] == "Dash" and d["outstanding_paise"] == 0
    import io

    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGBA", (40, 40), (0, 140, 134, 128)).save(buf, "PNG")
    png = buf.getvalue()
    r = await client.post(
        f"{API}/uploads/images", headers=u.h, files={"file": ("a.png", png, "image/png")}, data={"purpose": "profile"}
    )
    assert r.status_code == 201 and r.json()["data"]["url"].endswith(".png")
    r = await client.post(f"{API}/uploads/images", headers=u.h, files={"file": ("a.png", b"<script>", "image/png")})
    assert r.status_code == 422
