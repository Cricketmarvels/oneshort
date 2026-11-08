from datetime import timedelta

import httpx

from tests.conftest import HSR_LAYOUT, KORAMANGALA, add_slot, future, make_match, make_player, make_team, register

API = "/api/v1"


async def _squad(client: httpx.AsyncClient, day: int, n: int, non_payee: int = 0):  # type: ignore[no-untyped-def]
    captain = await make_player(client, f"Fee Skip {day}", "all_rounder", KORAMANGALA)
    team = await make_team(client, captain, f"Fee XI {day}")
    start = future(day)
    match = await make_match(client, captain, team, start=start, capacity=n + 1)
    players = []
    for i in range(n):
        p = await make_player(client, f"F{day}-{i}", "batsman", HSR_LAYOUT)
        await add_slot(client, p, start - timedelta(hours=1), hours=5)
        players.append(p)
    res = (
        await client.post(
            f"{API}/matches/{match['id']}/invitations",
            headers=captain.h,
            json={
                "invites": [
                    {"player_id": p.id, "contribution_type": "non_payee" if i < non_payee else "payee"}
                    for i, p in enumerate(players)
                ]
            },
        )
    ).json()["data"]
    for p, r in zip(players, res, strict=True):
        await client.post(f"{API}/invitations/{r['invitation_id']}/accept", headers=p.h)
        assert (
            await client.post(f"{API}/invitations/{r['invitation_id']}/confirm", headers=captain.h)
        ).status_code == 200
    return captain, match, players


async def _publish(client, captain, match, expenses, **draft):  # type: ignore[no-untyped-def]
    for label, amount in expenses:
        r = await client.post(
            f"{API}/matches/{match['id']}/expenses",
            headers=captain.h,
            json={"label": label, "category": "ground", "amount_paise": amount},
        )
        assert r.status_code == 201
    r = await client.post(
        f"{API}/matches/{match['id']}/settlements",
        headers=captain.h,
        json={"payment_instructions": "UPI to skipper@okaxis", **draft},
    )
    assert r.status_code == 201, r.text
    draft_out = r.json()["data"]
    assert draft_out["settlement_status"] == "draft"
    r = await client.post(f"{API}/settlements/{draft_out['id']}/publish", headers=captain.h)
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def test_fee_split_with_non_payee_and_exemption(client: httpx.AsyncClient) -> None:
    # Captain + 10 players; 1 non-payee guest, 1 exempted junior → 9 eligible.
    captain, match, players = await _squad(client, 50, 10, non_payee=1)
    st = await _publish(
        client,
        captain,
        match,
        [("Ground booking", 300000), ("Balls", 60000), ("Umpire", 90000)],
        exempt_player_ids=[players[1].id],
    )
    assert st["total_expenses_paise"] == 450000
    assert st["eligible_players"] == 9 and st["individual_contribution_paise"] == 50000
    lines = {line["player"]["id"]: line for line in st["lines"]}
    assert lines[players[0].id]["amount_paise"] == 0 and not lines[players[0].id]["eligible"]
    assert lines[players[1].id]["exempt"] is True
    dash = (await client.get(f"{API}/settlements/{st['id']}/payments", headers=captain.h)).json()["data"]
    assert dash["outstanding_paise"] == 450000 and dash["exempted_count"] == 2


async def test_mark_paid_audited_and_notified(client: httpx.AsyncClient, container) -> None:  # type: ignore[no-untyped-def]
    captain, match, players = await _squad(client, 51, 3)
    st = await _publish(client, captain, match, [("Ground", 400000)])
    p = players[0]
    r = await client.post(
        f"{API}/settlements/{st['id']}/payments/{p.id}/mark-paid",
        headers=captain.h,
        json={"method": "gpay", "remarks": "Received on GPay"},
    )
    assert r.status_code == 200
    rec = r.json()["data"]
    assert rec["status"] == "paid" and rec["method"] == "gpay" and rec["verification"] == "manual_captain_confirmed"
    assert rec["updated_by"] == captain.id and rec["history"][-1]["to_status"] == "paid"
    from bson import ObjectId

    audit = await container.mongo["audit_logs"].find_one({"entity_id": ObjectId(rec["id"]), "action": "payment.paid"})
    assert audit and audit["actor_id"] == ObjectId(captain.id)
    notes = (await client.get(f"{API}/notifications", headers=p.h)).json()["data"]
    assert any(n["type"] == "payment_marked_paid" for n in notes)
    dash = (await client.get(f"{API}/settlements/{st['id']}/payments", headers=captain.h)).json()["data"]
    assert dash["collected_paise"] == 100000 and dash["outstanding_paise"] == 300000
    # Marking paid twice is rejected; correction requires a reason.
    r = await client.post(f"{API}/settlements/{st['id']}/payments/{p.id}/mark-paid", headers=captain.h, json={})
    assert r.json()["error"]["code"] == "INVALID_PAYMENT_TRANSITION"
    r = await client.post(
        f"{API}/settlements/{st['id']}/payments/{p.id}/correct", headers=captain.h, json={"status": "pending"}
    )
    assert r.status_code == 422
    r = await client.post(
        f"{API}/settlements/{st['id']}/payments/{p.id}/correct",
        headers=captain.h,
        json={"status": "pending", "reason": "Marked the wrong player"},
    )
    assert r.json()["data"]["status"] == "pending"
    # Player dashboard
    me = (await client.get(f"{API}/settlements/me", headers=p.h)).json()["data"]
    assert me["outstanding_paise"] == 100000 and me["pending_count"] == 1
    assert me["records"][0]["team_name"] == "Fee XI 51"
    share = (await client.get(f"{API}/settlements/{st['id']}/share", headers=captain.h)).json()["data"]
    assert share["whatsapp_url"].startswith("https://wa.me/?text=") and "₹1,000" in share["text"]


async def test_player_cannot_mark_paid(client: httpx.AsyncClient) -> None:
    captain, match, players = await _squad(client, 52, 2)
    st = await _publish(client, captain, match, [("Ground", 300000)])
    a, b = players
    for who, target in ((a, a), (a, b)):
        r = await client.post(f"{API}/settlements/{st['id']}/payments/{target.id}/mark-paid", headers=who.h, json={})
        assert r.status_code == 403
    stranger = await register(client)
    r = await client.get(f"{API}/settlements/{st['id']}/payments", headers=stranger.h)
    assert r.status_code == 403
    r = await client.post(
        f"{API}/matches/{match['id']}/expenses", headers=a.h, json={"label": "x", "amount_paise": 100}
    )
    assert r.status_code == 403


async def test_dispute_and_discussion(client: httpx.AsyncClient) -> None:
    captain, match, players = await _squad(client, 53, 2)
    st = await _publish(client, captain, match, [("Ground", 300000)])
    a, b = players
    r = await client.post(f"{API}/settlements/{st['id']}/payments/{b.id}/dispute", headers=a.h, json={"reason": "x"})
    assert r.status_code == 403  # not own record
    r = await client.post(
        f"{API}/settlements/{st['id']}/payments/{a.id}/dispute",
        headers=a.h,
        json={"reason": "I paid cash at the ground"},
    )
    assert r.status_code == 200 and r.json()["data"]["status"] == "disputed"
    rec_id = r.json()["data"]["id"]
    notes = (await client.get(f"{API}/notifications", headers=captain.h)).json()["data"]
    assert any(n["type"] == "payment_dispute" for n in notes)
    r = await client.post(f"{API}/payments/{rec_id}/discussion", headers=a.h, json={"message": "Gave ₹1000 to Rahul"})
    assert r.status_code == 201
    r = await client.post(f"{API}/payments/{rec_id}/discussion", headers=captain.h, json={"message": "Confirmed"})
    thread = (await client.get(f"{API}/payments/{rec_id}/discussion", headers=a.h)).json()["data"]
    assert [m["message"] for m in thread] == ["Gave ₹1000 to Rahul", "Confirmed"]
    assert (await client.get(f"{API}/payments/{rec_id}/discussion", headers=b.h)).status_code == 404
    r = await client.post(
        f"{API}/settlements/{st['id']}/payments/{a.id}/mark-paid",
        headers=captain.h,
        json={"method": "cash", "remarks": "Resolved: cash confirmed"},
    )
    assert r.json()["data"]["status"] == "paid"


async def test_published_settlement_is_immutable_and_revision_carries_credit(client: httpx.AsyncClient) -> None:
    captain, match, players = await _squad(client, 54, 3)
    st1 = await _publish(client, captain, match, [("Ground", 400000)])  # 4 payees × ₹1000
    a = players[0]
    await client.post(f"{API}/settlements/{st1['id']}/payments/{a.id}/mark-paid", headers=captain.h, json={})
    r = await client.post(f"{API}/settlements/{st1['id']}/publish", headers=captain.h)
    assert r.status_code == 409 and r.json()["error"]["code"] == "SETTLEMENT_IMMUTABLE"
    # Additional expense → revised settlement (v2)
    await client.post(
        f"{API}/matches/{match['id']}/expenses",
        headers=captain.h,
        json={"label": "Refreshments", "category": "refreshments", "amount_paise": 80000},
    )
    r = await client.post(
        f"{API}/matches/{match['id']}/settlements", headers=captain.h, json={"revision_reason": "Added refreshments"}
    )
    draft = r.json()["data"]
    assert draft["version"] == 2 and draft["revises_settlement_id"] == st1["id"]
    assert draft["individual_contribution_paise"] == 120000
    st2 = (await client.post(f"{API}/settlements/{draft['id']}/publish", headers=captain.h)).json()["data"]
    versions = (await client.get(f"{API}/matches/{match['id']}/settlements", headers=captain.h)).json()["data"]
    assert [(v["version"], v["settlement_status"]) for v in versions] == [(2, "published"), (1, "superseded")]
    dash = (await client.get(f"{API}/settlements/{st2['id']}/payments", headers=captain.h)).json()["data"]
    rec_a = [r for r in dash["records"] if r["player"]["id"] == a.id][0]
    assert rec_a["credited_paise"] == 100000 and rec_a["balance_paise"] == 20000 and rec_a["status"] == "pending"
    # Old version can no longer be updated
    r = await client.post(
        f"{API}/settlements/{st1['id']}/payments/{players[1].id}/mark-paid", headers=captain.h, json={}
    )
    assert r.json()["error"]["code"] == "SETTLEMENT_NOT_CURRENT"
    # Player dashboard only counts the current version
    me = (await client.get(f"{API}/settlements/me", headers=a.h)).json()["data"]
    assert me["outstanding_paise"] == 20000 and len(me["records"]) == 1
