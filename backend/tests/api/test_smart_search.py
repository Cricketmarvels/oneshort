from datetime import UTC, datetime, timedelta

import httpx

from app.core.container import Container
from app.infrastructure.integrations.ai import SearchPick, SearchRanking
from app.modules.assistant.schemas import Intent
from tests.api.test_competition import SECTOR_18, player, team
from tests.conftest import add_slot, make_match

API = "/api/v1"
IST = timedelta(hours=5, minutes=30)


def next_weekday_ist(wd: int, hour: int) -> datetime:
    now_ist = datetime.now(UTC) + IST
    days = (wd - now_ist.weekday()) % 7 or 7
    d = (now_ist + timedelta(days=days)).date()
    return datetime(d.year, d.month, d.day, hour, tzinfo=UTC) - IST


async def test_play_on_saturday_morning_finds_real_open_game(client: httpx.AsyncClient) -> None:
    cap = await player(client, "Captain SS", "all_rounder", SECTOR_18)
    me = await player(client, "Seeker SS", "batsman", SECTOR_18)
    tid = await team(client, cap, "Saturday Smashers SS", SECTOR_18, [])
    sat = await make_match(client, cap, tid, start=next_weekday_ist(5, 7), at=SECTOR_18, capacity=11)
    sun = await make_match(client, cap, tid, start=next_weekday_ist(6, 7), at=SECTOR_18, capacity=11)
    body = {
        "query": "I am looking to play on Saturday morning",
        "lat": SECTOR_18[0],
        "lng": SECTOR_18[1],
        "radius_km": 10,
    }
    r = await client.post(f"{API}/search/smart", headers=me.h, json=body)
    assert r.status_code == 200, r.text
    d = r.json()["data"]
    assert d["engine"] == "rules" and d["intent"]["kind"] == "play_match" and d["window_label"].startswith("Sat")
    ids = [x["id"] for x in d["results"] if x["kind"] == "match"]
    assert sat["id"] in ids and sun["id"] not in ids
    hit = next(x for x in d["results"] if x["id"] == sat["id"])
    assert "open spot" in hit["reason"] and hit["distance_km"] is not None and "lat" not in str(hit)


async def test_need_a_bowler_saturday_uses_availability(client: httpx.AsyncClient) -> None:
    me = await player(client, "Captain BW", "batsman", SECTOR_18)
    free = await player(client, "Free Bowler BW", "bowler", SECTOR_18)
    busy = await player(client, "Busy Bowler BW", "bowler", SECTOR_18)
    await add_slot(client, free, next_weekday_ist(5, 6), hours=6, at=SECTOR_18)
    del busy
    r = await client.post(
        f"{API}/search/smart",
        headers=me.h,
        json={"query": "need a bowler on saturday morning", "lat": SECTOR_18[0], "lng": SECTOR_18[1]},
    )
    d = r.json()["data"]
    names = [x["title"] for x in d["results"]]
    assert d["intent"]["kind"] == "find_players" and "Free Bowler BW" in names and "Busy Bowler BW" not in names


class FakeAI:
    enabled = True
    model = "fake"

    def __init__(self) -> None:
        self.seen: list[str] = []

    async def triage_report(self, data: object) -> None:
        return None

    async def interpret_search(self, query: str, today: str, radius_km: int, output: type) -> Intent:
        return Intent(
            kind="play_match", weekdays=["sat"], times_of_day=["morning"], summary="A game on Saturday morning"
        )

    async def rank_search(self, query: str, request: str, candidates: str) -> SearchRanking:
        self.seen.append(candidates)
        return SearchRanking(
            picks=[
                SearchPick(key="c99", reason="invented"),
                SearchPick(key="c1", reason="Best fit: Saturday 7am nearby"),
            ],
            note="Two more games next week",
        )


async def test_claude_path_validates_picks_and_hides_identities(
    client: httpx.AsyncClient, container: Container
) -> None:
    cap = await player(client, "Captain AI", "all_rounder", SECTOR_18)
    me = await player(client, "Seeker AI", "batsman", SECTOR_18)
    tid = await team(client, cap, "Morning Mavericks AI", SECTOR_18, [])
    await make_match(client, cap, tid, start=next_weekday_ist(5, 8), at=SECTOR_18)
    real, fake = container.ai, FakeAI()
    container.ai = fake  # type: ignore[assignment]
    try:
        r = await client.post(
            f"{API}/search/smart",
            headers=me.h,
            json={"query": "saturday morning game please", "lat": SECTOR_18[0], "lng": SECTOR_18[1]},
        )
    finally:
        container.ai = real
    d = r.json()["data"]
    assert d["engine"] == "claude" and d["note"] == "Two more games next week"
    assert all(x["reason"] != "invented" for x in d["results"])  # unknown key c99 dropped
    assert d["results"][0]["reason"] == "Best fit: Saturday 7am nearby"
    assert "Captain AI" not in fake.seen[0] and "lat" not in fake.seen[0]  # no personal names or coordinates sent
