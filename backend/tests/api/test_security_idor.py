"""Security: an outsider must not read or change other people's records by guessing IDs (IDOR)."""

import httpx

from tests.api.test_competition import SECTOR_18, player, team
from tests.conftest import add_slot, future, make_match

API = "/api/v1"


async def test_outsider_cannot_touch_others_records(client: httpx.AsyncClient) -> None:
    cap = await player(client, "Captain SEC", "all_rounder", SECTOR_18)
    p = await player(client, "Player SEC", "bowler", SECTOR_18)
    o = await player(client, "Outsider SEC", "batsman", SECTOR_18)
    tid = await team(client, cap, "Team SEC", SECTOR_18, [p])
    await add_slot(client, p, future(4, 7), at=SECTOR_18)
    mid = (await make_match(client, cap, tid, start=future(4, 7), at=SECTOR_18, capacity=11))["id"]
    r = await client.post(f"{API}/matches/{mid}/invitations", headers=cap.h, json={"invites": [{"player_id": p.id}]})
    inv = r.json()["data"][0]["invitation_id"]
    assert (await client.post(f"{API}/invitations/{inv}/accept", headers=p.h)).status_code == 200
    slot = (await client.get(f"{API}/availability/me", headers=p.h)).json()["data"][0]["id"]
    notes = (await client.get(f"{API}/notifications", headers=p.h)).json()["data"]
    note = notes[0]["id"] if notes else None

    probes: list[tuple[str, str, str, dict | None]] = [  # type: ignore[type-arg]
        ("read someone else's chat", "GET", f"/invitations/{inv}/chat", None),
        ("post into someone else's chat", "POST", f"/invitations/{inv}/chat", {"body": "hi"}),
        ("accept someone else's invitation", "POST", f"/invitations/{inv}/accept", None),
        ("confirm as non-captain", "POST", f"/invitations/{inv}/confirm", None),
        ("cancel someone else's invitation", "POST", f"/invitations/{inv}/cancel", {"reason": None}),
        ("list a match's invitations", "GET", f"/matches/{mid}/invitations", None),
        ("change a match's status", "POST", f"/matches/{mid}/transition", {"to": "squad_confirmed"}),
        ("edit someone else's match", "PUT", f"/matches/{mid}", {"title": "Hijacked"}),
        ("cancel someone else's match", "POST", f"/matches/{mid}/cancel", {"reason": "x"}),
        ("remove a team member", "DELETE", f"/teams/{tid}/members/{p.id}", None),
        ("promote a team member", "PUT", f"/teams/{tid}/members/{p.id}", {"member_role": "admin"}),
        ("edit someone else's team", "PUT", f"/teams/{tid}", {"team_name": "Hijacked"}),
        ("edit someone else's availability", "PUT", f"/availability/{slot}", {"status": "unavailable"}),
        ("delete someone else's availability", "DELETE", f"/availability/{slot}", None),
        (
            "create a fee split for someone else's match",
            "POST",
            f"/matches/{mid}/settlements",
            {"total_amount_paise": 100000},
        ),
        ("create invite link for someone else's match", "POST", f"/matches/{mid}/invite-link", None),
    ]
    if note:
        probes.append(("mark someone else's notification read", "POST", f"/notifications/{note}/read", None))

    leaks = []
    for label, method, path, body in probes:
        res = await client.request(method, f"{API}{path}", headers=o.h, json=body)
        if res.status_code < 400:
            leaks.append(f"{label}: {method} {path} -> {res.status_code}")

    pub = (await client.get(f"{API}/players/{p.id}", headers=o.h)).json()["data"]
    for secret in ("mobile_number", "email", "home_location", "password_hash"):
        if secret in pub:
            leaks.append(f"public player profile exposes {secret}")
    me = (await client.get(f"{API}/matches/{mid}", headers=o.h)).json()["data"]
    if me["venue"].get("lat") is not None and me["viewer_relation"] == "public" and me["venue"].get("restricted"):
        leaks.append("restricted venue coordinates exposed to outsider")
    assert (await client.get(f"{API}/matches/{mid}", headers=cap.h)).json()["data"]["title"] != "Hijacked"
    assert not leaks, "IDOR gaps:\n" + "\n".join(leaks)
