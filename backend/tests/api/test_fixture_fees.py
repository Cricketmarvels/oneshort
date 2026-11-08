"""Team-vs-team match fees: each team splits its own share over the existing settlement engine."""

import httpx

from tests.api.test_competition import confirmed_fixture, setup_two_teams

API = "/api/v1"


async def test_team_match_fee_split_publish_and_track(client: httpx.AsyncClient) -> None:
    s = await setup_two_teams(client, "FEE")
    fid = await confirmed_fixture(client, s, days=10)
    # Only a team manager can open (create) the ledger
    r = await client.post(f"{API}/fixtures/{fid}/fees/{s['ta']}", headers=s["a1"].h)
    assert r.status_code == 404 and r.json()["error"]["code"] == "NO_FEE_LEDGER"
    r = await client.post(f"{API}/fixtures/{fid}/fees/{s['ta']}", headers=s["cap_a"].h)
    assert r.status_code == 200, r.text
    side = r.json()["data"]
    lid = side["id"]
    assert side["can_manage"] and side["title"].endswith("vs Tech XI FEE")
    assert {m["user"]["id"] for m in side["members"] if m["in_squad"]} == {s["cap_a"].id, s["a1"].id, s["a2"].id}
    # Idempotent; other team can't use it; members can view once in the squad
    assert (await client.post(f"{API}/fixtures/{fid}/fees/{s['ta']}", headers=s["cap_a"].h)).json()["data"]["id"] == lid
    assert (await client.post(f"{API}/fixtures/{fid}/fees/{s['ta']}", headers=s["cap_b"].h)).status_code == 403
    # Captain picks squad: a2 plays free; only active members allowed
    bad = await client.put(f"{API}/fees/{lid}/squad", headers=s["cap_a"].h, json={"player_ids": [s["b1"].id]})
    assert bad.status_code == 422
    assert (
        await client.put(f"{API}/fees/{lid}/squad", headers=s["a1"].h, json={"player_ids": [s["a1"].id]})
    ).status_code == 403
    r = await client.put(
        f"{API}/fees/{lid}/squad",
        headers=s["cap_a"].h,
        json={"player_ids": [s["cap_a"].id, s["a1"].id, s["a2"].id], "non_payee_ids": [s["a2"].id]},
    )
    assert r.status_code == 200
    # Expenses + split use the same endpoints as pickup matches, with the ledger id
    for label, amt in (("Ground", 300000), ("Balls", 60000)):
        assert (
            await client.post(
                f"{API}/matches/{lid}/expenses",
                headers=s["cap_a"].h,
                json={"label": label, "category": "ground", "amount_paise": amt},
            )
        ).status_code == 201
    assert (
        await client.post(f"{API}/matches/{lid}/expenses", headers=s["a1"].h, json={"label": "x", "amount_paise": 100})
    ).status_code == 403
    r = await client.post(
        f"{API}/matches/{lid}/settlements", headers=s["cap_a"].h, json={"payment_instructions": "UPI to kings@okaxis"}
    )
    assert r.status_code == 201, r.text
    st = r.json()["data"]
    assert (
        st["total_expenses_paise"] == 360000
        and st["eligible_players"] == 2
        and st["individual_contribution_paise"] == 180000
    )
    free = next(line for line in st["lines"] if line["player"]["id"] == s["a2"].id)
    assert not free["eligible"] and free["amount_paise"] == 0
    r = await client.post(f"{API}/settlements/{st['id']}/publish", headers=s["cap_a"].h)
    assert r.json()["data"]["settlement_status"] == "published"
    # Player sees what they owe, with the fixture title
    mine = (await client.get(f"{API}/settlements/me", headers=s["a1"].h)).json()["data"]
    assert mine["outstanding_paise"] == 180000 and mine["records"][0]["match_title"].startswith("Kings FEE vs")
    # Squad member sees the transparency dashboard; other team doesn't
    assert (await client.get(f"{API}/settlements/{st['id']}/payments", headers=s["a1"].h)).status_code == 200
    assert (await client.get(f"{API}/settlements/{st['id']}/payments", headers=s["b1"].h)).status_code == 403
    # Captain marks paid; reminder link for WhatsApp
    r = await client.post(
        f"{API}/settlements/{st['id']}/payments/{s['a1'].id}/mark-paid", headers=s["cap_a"].h, json={"method": "upi"}
    )
    assert r.json()["data"]["status"] == "paid"
    dash = (await client.get(f"{API}/settlements/{st['id']}/payments", headers=s["cap_a"].h)).json()["data"]
    assert dash["collected_paise"] == 180000 and dash["outstanding_paise"] == 180000
    share = (await client.get(f"{API}/settlements/{st['id']}/share", headers=s["cap_a"].h)).json()["data"]
    assert "wa.me" in share["whatsapp_url"] or "whatsapp" in share["whatsapp_url"]
    # The opposing team keeps its own separate ledger
    rb = await client.post(f"{API}/fixtures/{fid}/fees/{s['tb']}", headers=s["cap_b"].h)
    assert rb.status_code == 200 and rb.json()["data"]["id"] != lid


async def test_non_squad_member_cannot_view_fee(client: httpx.AsyncClient) -> None:
    s = await setup_two_teams(client, "FEX")
    fid = await confirmed_fixture(client, s, days=11)
    lid = (await client.post(f"{API}/fixtures/{fid}/fees/{s['ta']}", headers=s["cap_a"].h)).json()["data"]["id"]
    await client.put(f"{API}/fees/{lid}/squad", headers=s["cap_a"].h, json={"player_ids": [s["cap_a"].id, s["a1"].id]})
    r = await client.post(f"{API}/fixtures/{fid}/fees/{s['ta']}", headers=s["a2"].h)
    assert r.status_code == 403 and r.json()["error"]["code"] == "FEES_PRIVATE"
    rv = await client.get(f"{API}/fees/{lid}", headers=s["a1"].h)
    assert rv.status_code == 200, rv.text
    view = rv.json()["data"]
    assert not view["can_manage"] and {m["user"]["id"] for m in view["members"]} == {s["cap_a"].id, s["a1"].id}
