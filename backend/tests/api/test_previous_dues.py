"""Adding earlier unpaid match fees of the same team to the current split, without ever billing them twice."""

from datetime import timedelta

import httpx

from tests.api.test_settlements import _join, _squad
from tests.conftest import HSR_LAYOUT, add_slot, future, make_match

API = "/api/v1"


async def _draft(client, captain, mid, **body):  # type: ignore[no-untyped-def]
    return await client.post(
        f"{API}/matches/{mid}/settlements", headers=captain.h, json={"upi_id": "skip@okaxis", **body}
    )


async def _record(client, captain, sid, pid):  # type: ignore[no-untyped-def]
    dash = (await client.get(f"{API}/settlements/{sid}/payments", headers=captain.h)).json()["data"]
    return next(r for r in dash["records"] if r["player"]["id"] == pid), dash


async def test_previous_dues_are_added_to_the_next_match_fee(client: httpx.AsyncClient) -> None:
    captain, m1, (a, b) = await _squad(client, 82, 2)
    team_id = m1["team_id"]

    # Match 1: ₹1,200 between the captain, a, b and guest Anshul → ₹300 each. Only a pays.
    await client.post(
        f"{API}/matches/{m1['id']}/expenses",
        headers=captain.h,
        json={"label": "Ground", "category": "ground", "amount_paise": 120000},
    )
    d1 = (await _draft(client, captain, m1["id"], extra_players=[{"name": "Anshul"}])).json()["data"]
    st1 = (await client.post(f"{API}/settlements/{d1['id']}/publish", headers=captain.h)).json()["data"]
    assert st1["individual_contribution_paise"] == 30000
    paid = await client.post(f"{API}/settlements/{st1['id']}/payments/{a.id}/mark-paid", headers=captain.h, json={})
    assert paid.status_code == 200

    # Match 2, same team: a and b play again, and Anshul comes back (typed in by name again).
    start = future(84)
    m2 = await make_match(client, captain, team_id, start=start, capacity=3)
    for p in (a, b):
        await add_slot(client, p, start - timedelta(hours=1), hours=5, at=HSR_LAYOUT)
        await _join(client, captain, m2, p)
    await client.post(
        f"{API}/matches/{m2['id']}/expenses",
        headers=captain.h,
        json={"label": "Ground", "category": "ground", "amount_paise": 90000},
    )

    dues = (await client.get(f"{API}/matches/{m2['id']}/previous-dues", headers=captain.h)).json()["data"]
    by_name = {d["name"]: d for d in dues}
    assert set(by_name) == {captain.name, b.name, "Anshul"}  # a paid, so a owes nothing
    assert by_name["Anshul"]["guest"] and by_name[b.name]["total_paise"] == 30000
    assert by_name[b.name]["items"][0]["match_id"] == m1["id"]
    b_rec, anshul_rec = by_name[b.name]["items"][0]["record_id"], by_name["Anshul"]["items"][0]["record_id"]
    assert (await client.get(f"{API}/matches/{m2['id']}/previous-dues", headers=b.h)).status_code == 403

    # A due can only land on someone in this split.
    r = await _draft(client, captain, m2["id"], player_ids=[captain.id, a.id], carry_record_ids=[b_rec])
    assert r.status_code == 422 and r.json()["error"]["code"] == "NOT_IN_SPLIT"

    r = await _draft(
        client, captain, m2["id"], extra_players=[{"name": "anshul "}], carry_record_ids=[b_rec, anshul_rec]
    )
    assert r.status_code == 201, r.text
    d2 = r.json()["data"]
    lines = {line["player"]["full_name"].strip().lower(): line for line in d2["lines"]}
    assert d2["individual_contribution_paise"] == 22500 and d2["carried_paise"] == 60000
    b_line = lines[b.name.lower()]
    assert (b_line["share_paise"], b_line["carried_paise"], b_line["amount_paise"]) == (22500, 30000, 52500)
    assert b_line["carried"][0]["match_title"] == m1["title"]
    assert lines["anshul"]["amount_paise"] == 52500 and lines[a.name.lower()]["amount_paise"] == 22500

    text = (await client.get(f"{API}/settlements/{d2['id']}/share", headers=captain.h)).json()["data"]["text"]
    assert "📌 *Earlier unpaid fees added (₹600)*" in text
    assert f"{b.name}: *₹525* (₹225 + ₹300 earlier)" in text and f"• {b.name}: ₹300 · {m1['title']}" in text
    assert "₹225 each" in text

    st2 = (await client.post(f"{API}/settlements/{d2['id']}/publish", headers=captain.h)).json()["data"]

    # Match 1 now shows b's fee as moved, and no longer counts it as outstanding.
    old, dash1 = await _record(client, captain, st1["id"], b.id)
    assert old["status"] == "carried_forward" and old["balance_paise"] == 0
    assert old["carried_to_match_title"] == m2["title"]
    assert dash1["outstanding_paise"] == 30000  # only the captain's own share is left there
    r = await client.post(
        f"{API}/settlements/{st1['id']}/payments/{b.id}/correct",
        headers=captain.h,
        json={"status": "paid", "reason": "paid"},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "FEE_CARRIED_FORWARD"

    # b owes ₹525 in total, not ₹825: the old ₹300 is counted once.
    mine = (await client.get(f"{API}/settlements/me", headers=b.h)).json()["data"]
    assert mine["outstanding_paise"] == 52500
    new, _ = await _record(client, captain, st2["id"], b.id)
    assert new["carried_paise"] == 30000
    remind = (await client.post(f"{API}/settlements/{st2['id']}/payments/{b.id}/remind", headers=captain.h)).json()
    assert "₹225 for this match + ₹300 unpaid from earlier matches" in remind["data"]["text"]

    # Another match can't pick up a due that has already moved.
    start3 = future(86)
    m3 = await make_match(client, captain, team_id, start=start3, capacity=3)
    await add_slot(client, b, start3 - timedelta(hours=1), hours=5, at=HSR_LAYOUT)
    await _join(client, captain, m3, b)
    await client.post(
        f"{API}/matches/{m3['id']}/expenses",
        headers=captain.h,
        json={"label": "Balls", "category": "balls", "amount_paise": 20000},
    )
    r = await _draft(client, captain, m3["id"], carry_record_ids=[b_rec])
    assert r.status_code == 422 and r.json()["error"]["code"] == "PREVIOUS_DUE_CHANGED"

    # Revising match 2 without b's old due sends it back to match 1 as unpaid; Anshul's stays moved.
    dues = (await client.get(f"{API}/matches/{m2['id']}/previous-dues", headers=captain.h)).json()["data"]
    assert {d["name"] for d in dues} >= {b.name, "Anshul"}  # still offered, so a revision can keep them
    guest_id = lines["anshul"]["player"]["id"]
    d3 = (
        await _draft(
            client,
            captain,
            m2["id"],
            extra_players=[{"name": "Anshul", "guest_id": guest_id}],
            carry_record_ids=[anshul_rec],
            revision_reason="b paid the old fee in cash",
        )
    ).json()["data"]
    await client.post(f"{API}/settlements/{d3['id']}/publish", headers=captain.h)
    old, dash1 = await _record(client, captain, st1["id"], b.id)
    assert old["status"] == "pending" and dash1["outstanding_paise"] == 60000
    anshul_old = next(r for r in dash1["records"] if r["player_is_guest"])
    assert anshul_old["status"] == "carried_forward"
