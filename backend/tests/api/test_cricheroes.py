"""CricHeroes link + import: permissions, the package-compatible import format, sanitising and sync."""

from typing import Any

import httpx

from app.core.container import Container
from app.core.exceptions import IntegrationUnavailable
from tests.conftest import make_player, make_team

API = "/api/v1"
SECTOR_18 = (28.5708, 77.3261)  # Noida
SECTOR_50 = (28.5713, 77.3646)

# Shape produced by the community `cricheroes` package (Team.dump_all -> out.json).
PACKAGE_DUMP: dict[str, Any] = {
    "team_name": "CP Sm@shers",
    "team_logo": "https://media.cricheroes.in/team_logo/1652262822833_GUQ87lVTqDfC.jpg",
    "players": [
        {
            "name": "Noida Captain",
            "sub_title": "All-rounder",
            "profile_url": "/player-profile/1/x",
            "profile_pic_url": "p",
        },
        {"name": "Aman Verma", "sub_title": "Batsman", "profile_url": "https://evil.example/p", "profile_pic_url": "p"},
    ],
    "matches": [
        {
            "tournament": "Noida Premier League",
            "info": "Noida Stadium, Noida, 07-Apr-23, 20 Ov.",
            "score": ["CP Sm@shers 160/4 (20.0 Ov)", "Rivals 150/9 (20.0 Ov)"],
            "result": "CP Sm@shers won by 10 runs",
            "url": "/scorecard/123/x",
            "date": "07-Apr-23",
            "venue": "Noida Stadium",
        }
    ],
    "stats": [{"label": "Matches", "value": "42"}, {"label": "Win %", "value": "61%"}],
    "leaderboard": {
        "batting": [{"player_name": "Aman Verma", "stat": "812 runs", "profile": "batting"}],
        "bowling": [{"player_name": "Noida Captain", "stat": "31 wickets", "profile": "bowling"}],
        "fielding": [],
    },
}


async def test_link_import_view_and_remove(client: httpx.AsyncClient) -> None:
    captain = await make_player(client, "Noida Captain", "all_rounder", SECTOR_18)
    team_id = await make_team(client, captain, "Sector 18 Kings", at=SECTOR_18)
    outsider = await make_player(client, "Someone Else", "batsman", SECTOR_50)
    base = f"{API}/teams/{team_id}/cricheroes"

    empty = (await client.get(base, headers=captain.h)).json()["data"]
    assert empty["link"] is None and empty["snapshot"] is None and empty["can_manage"] is True
    assert empty["auto_sync_available"] is False and "terms" in empty["auto_sync_note"]

    # Only managers can link/import.
    url = "https://cricheroes.in/team-profile/2580003/CP-Sm@shers/members"
    assert (await client.put(f"{base}/link", headers=outsider.h, json={"url": url})).status_code == 403
    bad = await client.put(f"{base}/link", headers=captain.h, json={"url": "https://evil.example/team-profile/1/x"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_CRICHEROES_URL"
    r = await client.put(f"{base}/link", headers=captain.h, json={"url": url})
    assert r.status_code == 200
    assert r.json()["data"]["link"]["url"] == "https://cricheroes.com/team-profile/2580003/CP-Sm@shers"
    assert r.json()["data"]["link"]["external_team_id"] == 2580003

    assert (
        await client.post(f"{base}/import", headers=outsider.h, json={"method": "file", "data": PACKAGE_DUMP})
    ).status_code == 403
    r = await client.post(f"{base}/import", headers=captain.h, json={"method": "file", "data": PACKAGE_DUMP})
    assert r.status_code == 200, r.text
    snap = r.json()["data"]["snapshot"]
    assert snap["team_name"] == "CP Sm@shers" and snap["method"] == "file"
    assert snap["imported_by"]["full_name"] == "Noida Captain"
    by_name = {p["name"]: p for p in snap["players"]}
    # Name match links the CricHeroes player to the platform member; unsafe links are dropped.
    assert by_name["Noida Captain"]["member_user_id"] == captain.id
    assert by_name["Noida Captain"]["profile_url"] == "https://cricheroes.com/player-profile/1/x"
    assert by_name["Aman Verma"]["member_user_id"] is None and by_name["Aman Verma"]["profile_url"] is None
    assert snap["matches"][0]["played_on"] == "2023-04-07"
    assert snap["matches"][0]["url"] == "https://cricheroes.com/scorecard/123/x"
    assert snap["stats"][1] == {"label": "Win %", "value": "61%"}
    assert snap["leaderboard"]["batting"][0]["stat"] == "812 runs"

    # Any signed-in user can view; they can't manage.
    seen = (await client.get(base, headers=outsider.h)).json()["data"]
    assert seen["snapshot"]["team_name"] == "CP Sm@shers" and seen["can_manage"] is False

    # Manual entry replaces the snapshot.
    manual = {"method": "manual", "data": {"players": [{"name": "Only Player"}], "stats": []}}
    snap2 = (await client.post(f"{base}/import", headers=captain.h, json=manual)).json()["data"]["snapshot"]
    assert snap2["method"] == "manual" and [p["name"] for p in snap2["players"]] == ["Only Player"]

    empty_import = await client.post(f"{base}/import", headers=captain.h, json={"data": {"team_name": "x"}})
    assert empty_import.status_code == 422

    assert (await client.delete(base, headers=outsider.h)).status_code == 403
    assert (await client.delete(base, headers=captain.h)).status_code == 204
    assert (await client.get(base, headers=captain.h)).json()["data"]["link"] is None


async def test_import_limits_and_injection_guard(client: httpx.AsyncClient) -> None:
    captain = await make_player(client, "Limit Captain", "batsman", SECTOR_18)
    team_id = await make_team(client, captain, "Limit XI", at=SECTOR_18)
    base = f"{API}/teams/{team_id}/cricheroes"
    too_many = {"data": {"players": [{"name": f"P{i}"} for i in range(201)]}}
    assert (await client.post(f"{base}/import", headers=captain.h, json=too_many)).status_code == 422
    injected = {"data": {"players": [{"name": "X", "$where": "1"}]}}
    assert (await client.post(f"{base}/import", headers=captain.h, json=injected)).status_code in (400, 422)


class FakeSource:
    name = "fake"
    available = True
    unavailable_reason = None

    async def fetch_team(self, external_team_id: int, slug: str) -> dict[str, Any]:
        assert (external_team_id, slug) == (2580003, "CP-Sm@shers")
        return PACKAGE_DUMP


async def test_sync_disabled_by_default_and_uses_configured_source(
    client: httpx.AsyncClient, container: Container
) -> None:
    captain = await make_player(client, "Sync Captain", "batsman", SECTOR_18)
    team_id = await make_team(client, captain, "Sync XI", at=SECTOR_18)
    base = f"{API}/teams/{team_id}/cricheroes"

    r = await client.post(f"{base}/sync", headers=captain.h)
    assert r.status_code == 422 and r.json()["error"]["code"] == "CRICHEROES_NOT_LINKED"
    await client.put(f"{base}/link", headers=captain.h, json={"url": "2580003/CP-Sm@shers"})
    r = await client.post(f"{base}/sync", headers=captain.h)
    assert r.status_code == 503 and r.json()["error"]["code"] == "CRICHEROES_SYNC_UNAVAILABLE"
    assert isinstance(IntegrationUnavailable("x"), Exception)

    original = container.cricheroes
    container.cricheroes = FakeSource()
    try:
        r = await client.post(f"{base}/sync", headers=captain.h)
        assert r.status_code == 200, r.text
        data = r.json()["data"]
        assert data["snapshot"]["method"] == "sync" and data["auto_sync_available"] is True
    finally:
        container.cricheroes = original
