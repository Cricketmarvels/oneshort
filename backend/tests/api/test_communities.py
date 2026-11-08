import httpx

from tests.conftest import register

API = "/api/v1"
NOIDA = {"lat": 28.5355, "lng": 77.3910}


async def test_private_community_permissions_and_moderation(client: httpx.AsyncClient) -> None:
    owner = await register(client, "Owner Com", city="Noida")
    member = await register(client, "Member Com", city="Noida")
    other = await register(client, "Other Com", city="Noida")
    outsider = await register(client, "Outsider Com", city="Noida")
    r = await client.post(
        f"{API}/communities",
        headers=owner.h,
        json={
            "name": "Sector 137 Cricket",
            "kind": "sector",
            "visibility": "private",
            "city": "Noida",
            "area": "Sector 137",
            "location": NOIDA,
            "guidelines": "Be on time. No abuse.",
        },
    )
    assert r.status_code == 201, r.text
    com = r.json()["data"]
    cid = com["id"]
    assert com["my_role"] == "owner" and com["can_admin"] and "not responsible" in com["disclaimer"]
    assert "location" not in com

    # Profile visible, but feed/members are members-only
    assert (await client.get(f"{API}/communities/{cid}", headers=outsider.h)).json()["data"]["my_role"] is None
    r = await client.get(f"{API}/communities/{cid}/feed", headers=outsider.h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "COMMUNITY_PRIVATE"
    assert (await client.get(f"{API}/communities/{cid}/members", headers=outsider.h)).status_code == 403

    # Joining requires accepting guidelines; private -> pending -> approval by staff
    r = await client.post(f"{API}/communities/{cid}/join", headers=member.h, json={"accept_guidelines": False})
    assert r.json()["error"]["code"] == "GUIDELINES_REQUIRED"
    r = await client.post(f"{API}/communities/{cid}/join", headers=member.h, json={"accept_guidelines": True})
    assert r.json()["data"]["my_status"] == "pending"
    await client.post(f"{API}/communities/{cid}/join", headers=other.h, json={"accept_guidelines": True})
    assert (
        await client.post(f"{API}/communities/{cid}/members/{other.id}/approve", headers=member.h)
    ).status_code == 403
    pending = (await client.get(f"{API}/communities/{cid}/members?status=pending", headers=owner.h)).json()["data"]
    assert {m["user"]["id"] for m in pending} == {member.id, other.id}
    for u in (member, other):
        assert (
            await client.post(f"{API}/communities/{cid}/members/{u.id}/approve", headers=owner.h)
        ).status_code == 204
    assert (await client.get(f"{API}/communities/{cid}", headers=owner.h)).json()["data"]["member_count"] == 3

    # Members post; only staff post announcements and polls
    r = await client.post(
        f"{API}/communities/{cid}/posts", headers=member.h, json={"body": "Anyone for nets on Saturday?"}
    )
    assert r.status_code == 201
    member_post = r.json()["data"]["id"]
    r = await client.post(
        f"{API}/communities/{cid}/posts", headers=member.h, json={"type": "announcement", "body": "Big news"}
    )
    assert r.status_code == 403
    r = await client.post(
        f"{API}/communities/{cid}/posts",
        headers=owner.h,
        json={"type": "announcement", "body": "Ground booked for Sunday 7am"},
    )
    assert r.status_code == 201
    notes = (await client.get(f"{API}/notifications", headers=member.h)).json()["data"]
    assert any(n["type"] == "community_announcement" for n in notes)

    # Owner appoints a moderator; moderator runs a poll; one vote each
    assert (
        await client.put(
            f"{API}/communities/{cid}/members/{member.id}/role", headers=member.h, json={"role": "moderator"}
        )
    ).status_code == 403
    assert (
        await client.put(
            f"{API}/communities/{cid}/members/{member.id}/role", headers=owner.h, json={"role": "moderator"}
        )
    ).status_code == 204
    r = await client.post(
        f"{API}/communities/{cid}/posts",
        headers=member.h,
        json={"type": "poll", "body": "Format this weekend?", "poll_options": [{"text": "T10"}, {"text": "T20"}]},
    )
    poll = r.json()["data"]["id"]
    r = await client.post(f"{API}/communities/{cid}/posts/{poll}/vote", headers=other.h, json={"option": 1})
    assert r.json()["data"]["poll"][1]["votes"] == 1 and r.json()["data"]["my_vote"] == 1
    assert (
        await client.post(f"{API}/communities/{cid}/posts/{poll}/vote", headers=other.h, json={"option": 0})
    ).status_code == 409

    # Moderation: other posts; moderator removes it; other can't remove the owner's post
    r = await client.post(f"{API}/communities/{cid}/posts", headers=other.h, json={"body": "spam spam"})
    spam = r.json()["data"]["id"]
    feed = (await client.get(f"{API}/communities/{cid}/feed", headers=other.h)).json()["data"]
    owner_post = next(p["id"] for p in feed if p["author"]["id"] == owner.id)
    assert feed[0]["type"] == "announcement"  # pinned first
    assert (await client.delete(f"{API}/communities/{cid}/posts/{owner_post}", headers=other.h)).status_code == 403
    assert (
        await client.post(
            f"{API}/communities/{cid}/posts/{member_post}/report", headers=other.h, json={"reason": "off-topic"}
        )
    ).status_code == 204
    assert (
        await client.post(
            f"{API}/communities/{cid}/posts/{member_post}/report", headers=other.h, json={"reason": "again"}
        )
    ).status_code == 409
    assert (await client.delete(f"{API}/communities/{cid}/posts/{spam}", headers=member.h)).status_code == 204
    feed = (await client.get(f"{API}/communities/{cid}/feed", headers=owner.h)).json()["data"]
    assert spam not in [p["id"] for p in feed]
    assert next(p for p in feed if p["id"] == member_post)["report_count"] == 1  # moderators see reports
    assert (
        next(
            p
            for p in (await client.get(f"{API}/communities/{cid}/feed", headers=other.h)).json()["data"]
            if p["id"] == member_post
        )["report_count"]
        is None
    )

    # Blocking hides that user's posts from me
    assert (await client.post(f"{API}/users/{member.id}/block", headers=other.h)).status_code == 204
    feed = (await client.get(f"{API}/communities/{cid}/feed", headers=other.h)).json()["data"]
    assert all(p["author"]["id"] != member.id for p in feed)

    # Role hierarchy: moderator can't remove the owner; only admins ban; owner can't leave
    assert (await client.delete(f"{API}/communities/{cid}/members/{owner.id}", headers=member.h)).status_code == 403
    assert (
        await client.delete(f"{API}/communities/{cid}/members/{other.id}?ban=true", headers=member.h)
    ).status_code == 403
    assert (
        await client.delete(f"{API}/communities/{cid}/members/{other.id}?ban=true", headers=owner.h)
    ).status_code == 204
    r = await client.post(f"{API}/communities/{cid}/join", headers=other.h, json={"accept_guidelines": True})
    assert r.json()["error"]["code"] == "COMMUNITY_BANNED"
    assert (await client.post(f"{API}/communities/{cid}/leave", headers=owner.h)).json()["error"][
        "code"
    ] == "OWNER_CANNOT_LEAVE"


async def test_public_community_instant_join_and_discovery(client: httpx.AsyncClient) -> None:
    owner = await register(client, "Owner Pub", city="Noida")
    joiner = await register(client, "Joiner Pub", city="Noida")
    r = await client.post(
        f"{API}/communities",
        headers=owner.h,
        json={
            "name": "Greater Noida Weekend Cricket",
            "kind": "weekend",
            "city": "Greater Noida",
            "location": {"lat": 28.4744, "lng": 77.5040},
        },
    )
    cid = r.json()["data"]["id"]
    found = (
        await client.get(f"{API}/communities/discover?lat=28.5355&lng=77.391&radius_km=20", headers=joiner.h)
    ).json()["data"]
    match = next(c for c in found if c["id"] == cid)
    assert match["distance_km"] is not None and match["distance_km"] % 0.5 == 0
    assert (await client.get(f"{API}/communities/{cid}/feed", headers=joiner.h)).status_code == 200  # public: readable
    r = await client.post(f"{API}/communities/{cid}/posts", headers=joiner.h, json={"body": "hi"})
    assert r.status_code == 403  # must join to post
    r = await client.post(f"{API}/communities/{cid}/join", headers=joiner.h, json={"accept_guidelines": True})
    assert r.json()["data"]["my_status"] == "active"
    mine = (await client.get(f"{API}/communities/discover?mine=true", headers=joiner.h)).json()["data"]
    assert cid in [c["id"] for c in mine]
    lb = (await client.get(f"{API}/communities/{cid}/leaderboard", headers=joiner.h)).json()["data"]
    assert lb == {"players": [], "teams": []}  # no verified matches yet: nothing invented


async def test_combined_feed_scopes_hide_and_block(client: httpx.AsyncClient) -> None:
    owner = await register(client, "Feed Owner", city="Noida")
    reader = await register(client, "Feed Reader", city="Noida")
    mk = {"kind": "sector", "city": "Noida", "guidelines": "Be kind."}
    pub = (
        await client.post(
            f"{API}/communities",
            headers=owner.h,
            json={**mk, "name": "Feed Public CF", "visibility": "public", "area": "Sector 18", "location": NOIDA},
        )
    ).json()["data"]["id"]
    priv = (
        await client.post(
            f"{API}/communities",
            headers=owner.h,
            json={**mk, "name": "Feed Private CF", "visibility": "private", "area": "Sector 62", "location": NOIDA},
        )
    ).json()["data"]["id"]
    p1 = (
        await client.post(
            f"{API}/communities/{pub}/posts", headers=owner.h, json={"type": "post", "body": "Need 1 bowler Sunday"}
        )
    ).json()["data"]["id"]
    await client.post(
        f"{API}/communities/{priv}/posts", headers=owner.h, json={"type": "post", "body": "Members-only note"}
    )
    near = f"{API}/communities/feed?scope=nearby&lat={NOIDA['lat']}&lng={NOIDA['lng']}"

    got = (await client.get(near, headers=reader.h)).json()["data"]
    bodies = [p["body"] for p in got]
    assert "Need 1 bowler Sunday" in bodies and "Members-only note" not in bodies  # private never leaks
    mine = next(p for p in got if p["id"] == p1)
    assert mine["community_name"] == "Feed Public CF" and mine["community_joined"] is False
    assert mine["approx_distance_km"] is not None and "location" not in str(mine)
    assert (await client.get(f"{API}/communities/feed?scope=following", headers=reader.h)).json()["data"] == []

    assert (await client.post(f"{API}/communities/posts/{p1}/hide", headers=reader.h)).status_code == 204
    assert p1 not in [p["id"] for p in (await client.get(near, headers=reader.h)).json()["data"]]
    assert (await client.delete(f"{API}/communities/posts/{p1}/hide", headers=reader.h)).status_code == 204
    assert p1 in [p["id"] for p in (await client.get(near, headers=reader.h)).json()["data"]]

    assert (await client.post(f"{API}/users/{owner.id}/block", headers=reader.h)).status_code == 204
    assert all(p["author"]["id"] != owner.id for p in (await client.get(near, headers=reader.h)).json()["data"])
    blocks = (await client.get(f"{API}/users/me/blocks", headers=reader.h)).json()["data"]
    assert [b["user"]["full_name"] for b in blocks] == ["Feed Owner"]
    assert (await client.delete(f"{API}/users/{owner.id}/block", headers=reader.h)).status_code == 204
    assert (await client.get(f"{API}/users/me/blocks", headers=reader.h)).json()["data"] == []
