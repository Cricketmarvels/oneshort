"""Dues kept outside OneShort (e.g. a WhatsApp list) added to a match fee: owed amounts on top, advances off."""

import httpx

from tests.api.test_settlements import _squad
from tests.conftest import future, make_match

API = "/api/v1"


async def test_outside_dues_and_advances_are_added_to_the_split(client: httpx.AsyncClient) -> None:
    captain, match, (a, b, c) = await _squad(client, 91, 3)
    mid = match["id"]
    await client.post(
        f"{API}/matches/{mid}/expenses",
        headers=captain.h,
        json={"label": "Ground", "category": "ground", "amount_paise": 250000},
    )
    body = {
        "upi_id": "shubhang.dixit@ybl",
        "extra_players": [{"name": "Arun"}],
        "manual_dues": [
            {"player_id": a.id, "amount_paise": 60000, "note": "Previous match dues"},
            {"player_id": b.id, "amount_paise": -57700},  # paid in advance
            {"player_id": c.id, "amount_paise": -900000},  # advance bigger than the share
            {"name": "arun", "amount_paise": 50000},  # a guest added in the same request
        ],
    }
    r = await client.post(f"{API}/matches/{mid}/settlements", headers=captain.h, json=body)
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    assert d["individual_contribution_paise"] == 50000  # ₹2,500 between 5
    lines = {line["player"]["full_name"]: line for line in d["lines"]}
    assert lines[a.name]["amount_paise"] == 110000 and lines[a.name]["prior_note"] == "Previous match dues"
    assert lines[b.name]["amount_paise"] == 0 and lines[b.name]["prior_paise"] == -57700  # never below zero
    assert lines[b.name]["prior_note"] == "Advance"
    assert lines[c.name]["amount_paise"] == 0
    assert lines["Arun"]["amount_paise"] == 100000 and lines["Arun"]["prior_note"] == "Previous dues"
    assert d["prior_paise"] == 60000 - 57700 - 900000 + 50000

    text = (await client.get(f"{API}/settlements/{d['id']}/share", headers=captain.h)).json()["data"]["text"]
    assert "📌 *Earlier unpaid fees added (₹1,100)*" in text
    assert f"• {a.name}: ₹600 · Previous match dues" in text and "• Arun: ₹500 · Previous dues" in text
    assert f"{a.name}: *₹1,100* (₹500 + ₹600 previous match dues)" in text
    assert "💚 *Advance adjusted*" in text and f"• {b.name}: -₹577 paid in advance (covers this match)" in text

    # Someone not in the split can't be given a due.
    bad = {**body, "manual_dues": [{"name": "Stranger", "amount_paise": 1000}]}
    r = await client.post(f"{API}/matches/{mid}/settlements", headers=captain.h, json=bad)
    assert r.status_code == 422 and r.json()["error"]["code"] == "NOT_IN_SPLIT"

    # Published: the earlier balance is on the record, so reminders explain the amount.
    r = await client.post(f"{API}/matches/{mid}/settlements", headers=captain.h, json=body)
    st = (await client.post(f"{API}/settlements/{r.json()['data']['id']}/publish", headers=captain.h)).json()["data"]
    dash = (await client.get(f"{API}/settlements/{st['id']}/payments", headers=captain.h)).json()["data"]
    rec = {x["player"]["id"]: x for x in dash["records"]}
    assert rec[a.id]["prior_paise"] == 60000 and rec[a.id]["status"] == "pending"
    assert rec[b.id]["status"] == "paid"  # the advance covered it
    remind = (await client.post(f"{API}/settlements/{st['id']}/payments/{a.id}/remind", headers=captain.h)).json()
    assert "₹500 for this match + ₹600 previous match dues" in remind["data"]["text"]


async def test_people_not_playing_keep_their_dues_and_roll_to_the_next_match(client: httpx.AsyncClient) -> None:
    """A pasted WhatsApp list has people who aren't in this match (Ayush, Sinha, Mohit...). They are kept on the
    split, shown in the group message under their own heading, never charged here, and offered to the next
    match of the same team."""
    captain, match, (a, _b, _c) = await _squad(client, 93, 3)
    mid = match["id"]
    await client.post(
        f"{API}/matches/{mid}/expenses",
        headers=captain.h,
        json={"label": "Ground", "category": "ground", "amount_paise": 150000},
    )
    # Nothing to roll forward yet.
    r = await client.get(f"{API}/matches/{mid}/outside-dues", headers=captain.h)
    assert r.status_code == 200 and r.json()["data"] == []
    body = {
        "manual_dues": [{"player_id": a.id, "amount_paise": 60000}],
        "other_dues": [
            {"name": "Ayush Boss", "amount_paise": 95000},
            {"name": "Ajay Sinha", "amount_paise": 60000, "note": "Previous match dues"},
            {"name": "ajay sinha", "amount_paise": 40000},  # same person twice: merged
            {"name": "Mohit", "amount_paise": -20000},  # holds an advance
            {"name": "Nobody", "amount_paise": 0},  # dropped
        ],
    }
    r = await client.post(f"{API}/matches/{mid}/settlements", headers=captain.h, json=body)
    assert r.status_code == 201, r.text
    d = r.json()["data"]
    assert [(o["name"], o["amount_paise"], o["note"]) for o in d["other_dues"]] == [
        ("Ayush Boss", 95000, "Previous dues"),
        ("Ajay Sinha", 100000, "Previous match dues"),
        ("Mohit", -20000, "Advance"),
    ]
    assert len(d["lines"]) == 4  # captain + 3 players: nobody from the list was added
    assert d["total_assigned_paise"] == 150000
    text = (await client.get(f"{API}/settlements/{d['id']}/share", headers=captain.h)).json()["data"]["text"]
    assert "📒 *Still pending, not playing this match (₹1,950)*" in text
    assert "• Ayush Boss: ₹950 · Previous dues" in text and "• Ajay Sinha: ₹1,000 · Previous match dues" in text
    assert "💚 *Advance held, not playing this match*" in text and "• Mohit: ₹200 in advance" in text
    assert f"• {a.name}: ₹600 · Previous dues" in text  # the playing player's due is still on their fee

    # The next match of the same team starts from this list; this match (which has a split) does not.
    assert (await client.get(f"{API}/matches/{mid}/outside-dues", headers=captain.h)).json()["data"] == []
    match2 = await make_match(client, captain, match["team_id"], start=future(94), capacity=3)
    r = await client.get(f"{API}/matches/{match2['id']}/outside-dues", headers=captain.h)
    assert r.status_code == 200
    assert [o["name"] for o in r.json()["data"]] == ["Ayush Boss", "Ajay Sinha", "Mohit"]
