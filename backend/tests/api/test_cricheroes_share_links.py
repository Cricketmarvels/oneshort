"""CricHeroes share links (chshare.link) are expanded server-side to the canonical profile URL before saving."""

import httpx
import pytest

from app.modules.cricheroes import shortlinks
from app.modules.cricheroes.urls import embedded_profile_url, share_link_kind
from tests.conftest import grant_captain, register

API = "/api/v1"
PAGE = """<html><head><script>window.location="https://cricheroes.com/team-profile/1275057/SFCC-Noida-Knights"</script>
<meta name="x" content="https://cricheroes.com/player-profile/4794795/nitin-kumar/stats"></head></html>"""


@pytest.fixture
def fake_share(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []

    async def fetch(url: str) -> tuple[str, str]:
        calls.append(url)
        if url.endswith("/dead"):
            raise httpx.ConnectError("boom")
        if url.endswith("/empty"):
            return url, "<html>nothing here</html>"
        return url, PAGE

    monkeypatch.setattr(shortlinks, "fetch", fetch)
    return calls


def test_share_link_detection_and_extraction() -> None:
    assert share_link_kind("https://chshare.link/team/ss8dDP") == "team"
    assert share_link_kind("chshare.link/player/AbC123") == "player"
    assert share_link_kind("https://cricheroes.com/team-profile/1/x") is None
    assert share_link_kind("https://evil.example/team/ss8dDP") is None
    assert share_link_kind("https://chshare.link/other/ss8dDP") is None
    assert embedded_profile_url(PAGE, "team") == "https://cricheroes.com/team-profile/1275057/SFCC-Noida-Knights"
    assert embedded_profile_url(PAGE, "player") == "https://cricheroes.com/player-profile/4794795/nitin-kumar/stats"


async def test_player_share_link_is_expanded_before_saving(client: httpx.AsyncClient, fake_share: list[str]) -> None:
    u = await register(client, "Share Tester")
    r = await client.put(
        f"{API}/players/me",
        headers=u.h,
        json={"primary_role": "batsman", "cricheroes_profile_url": "https://chshare.link/player/AbC123"},
    )
    assert r.status_code == 200, r.text
    assert (
        r.json()["data"]["cricheroes_profile_url"] == "https://cricheroes.com/player-profile/4794795/nitin-kumar/stats"
    )
    assert fake_share == ["https://chshare.link/player/AbC123"]
    # wrong kind of share link is refused without fetching
    r = await client.put(
        f"{API}/players/me",
        headers=u.h,
        json={"primary_role": "batsman", "cricheroes_profile_url": "https://chshare.link/team/ss8dDP"},
    )
    assert r.status_code == 422  # refused by the schema validator, before any fetch
    assert len(fake_share) == 1


async def test_team_share_link_on_create_and_update(client: httpx.AsyncClient, fake_share: list[str]) -> None:
    u = await register(client, "Share Captain")
    body = {
        "team_name": "Share Kings",
        "location": {"lat": 28.57, "lng": 77.32},
        "area": "Sector 18",
        "city": "Noida",
        "cricheroes_team_url": "https://chshare.link/team/ss8dDP",
    }
    await grant_captain(u.id)
    r = await client.post(f"{API}/teams", headers=u.h, json=body)
    assert r.status_code == 201, r.text
    t = r.json()["data"]
    assert t["cricheroes_team_url"] == "https://cricheroes.com/team-profile/1275057/SFCC-Noida-Knights/stats"
    r = await client.put(
        f"{API}/teams/{t['id']}", headers=u.h, json={"cricheroes_team_url": "chshare.link/team/ss8dDP"}
    )
    assert r.status_code == 200, r.text
    assert r.json()["data"]["cricheroes_team_url"].startswith("https://cricheroes.com/team-profile/1275057/")


async def test_unreachable_or_empty_share_pages_fail_clearly(client: httpx.AsyncClient, fake_share: list[str]) -> None:
    u = await register(client, "Share Unlucky")
    for code, msg in (("dead", "CRICHEROES_SHARE_UNAVAILABLE"), ("empty", "INVALID_CRICHEROES_URL")):
        r = await client.put(
            f"{API}/players/me",
            headers=u.h,
            json={"primary_role": "bowler", "cricheroes_profile_url": f"https://chshare.link/player/{code}"},
        )
        assert r.status_code == 422, r.text
        assert r.json()["error"]["code"] == msg
