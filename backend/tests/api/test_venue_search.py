"""Ground search: GoFindr's own venues, map suggestions merged in, and picking one that isn't ours yet.

The provider is faked here. The real adapters (Photon, Google Places) are network calls; what matters
is that a search never writes, a pick writes once, and a provider failure can't break the ground list.
"""

import uuid

import httpx
import pytest
from bson import ObjectId

from app.core.container import Container
from app.infrastructure.integrations.places import Place
from tests.api.test_competition import SECTOR_18, player

API = "/api/v1"
HOWZZAT = Place(
    source="osm",
    place_id="osm:N123",
    name="Howzzat Cricket Arena",
    address="Sector 63, Noida",
    area="Sector 63",
    city="Noida",
    lat=28.6270,
    lng=77.3810,
)


class FakePlaces:
    name = "osm"

    def __init__(self, *places: Place) -> None:
        self.places = list(places)
        self.calls = 0

    async def search(self, q: str, lat: float | None, lng: float | None, country: str) -> list[Place]:
        self.calls += 1
        return [p for p in self.places if q.lower() in p.name.lower()]


class BrokenPlaces:
    name = "osm"

    async def search(self, q: str, lat: float | None, lng: float | None, country: str) -> list[Place]:
        raise httpx.ConnectTimeout("provider down")


@pytest.fixture
async def ground(container: Container) -> str:
    """A ground GoFindr already knows. The name is unique so one test's rows can't answer another's search."""
    r = await container.mongo["venues"].insert_one(
        {
            "name": f"Sector 18 Ground {uuid.uuid4().hex[:8]}",
            "address": "Stadium Rd",
            "area": "Sector 18",
            "city": "Noida",
            "location": {"type": "Point", "coordinates": [SECTOR_18[1], SECTOR_18[0]]},
        }
    )
    return str(r.inserted_id)


async def test_search_merges_map_suggestions_and_never_writes_them(
    client: httpx.AsyncClient, container: Container, ground: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = await player(client, "Venue Seeker", "batsman", SECTOR_18)
    fake = FakePlaces(HOWZZAT)
    monkeypatch.setattr(container, "places", fake)
    before = await container.mongo["venues"].count_documents({})

    rows = (await client.get(f"{API}/venues?q=Howzzat", headers=me.h)).json()["data"]
    assert [r["name"] for r in rows] == ["Howzzat Cricket Arena"]
    row = rows[0]
    assert row["id"] is None and row["source"] == "osm" and row["place_id"] == "osm:N123"
    assert await container.mongo["venues"].count_documents({}) == before  # typing stores nothing


async def test_our_own_grounds_come_first_and_without_a_provider_call(
    client: httpx.AsyncClient, container: Container, ground: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = await player(client, "Venue Local", "batsman", SECTOR_18)
    fake = FakePlaces(HOWZZAT)
    monkeypatch.setattr(container, "places", fake)

    rows = (await client.get(f"{API}/venues?lat={SECTOR_18[0]}&lng={SECTOR_18[1]}", headers=me.h)).json()["data"]
    assert fake.calls == 0  # no search term: this is "grounds near me", not a map lookup
    assert all(r["source"] == "gofindr" and r["id"] for r in rows)
    assert ground in [r["id"] for r in rows]


async def test_picking_a_map_ground_stores_it_once(
    client: httpx.AsyncClient, container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = await player(client, "Venue Picker", "batsman", SECTOR_18)
    other = await player(client, "Venue Picker Two", "bowler", SECTOR_18)
    monkeypatch.setattr(container, "places", FakePlaces(HOWZZAT))
    body = HOWZZAT.model_dump()

    first = (await client.post(f"{API}/venues/resolve", headers=me.h, json=body)).json()["data"]
    # Once a captain picks it, it is one of our grounds — not a suggestion any more.
    assert first["id"] and first["source"] == "gofindr" and first["name"] == "Howzzat Cricket Arena"
    again = (await client.post(f"{API}/venues/resolve", headers=other.h, json=body)).json()["data"]
    assert again["id"] == first["id"]  # one ground, however many captains pick it
    assert await container.mongo["venues"].count_documents({"place_id": "osm:N123"}) == 1

    # It is now a GoFindr ground: found without the provider, and usable as a match venue.
    monkeypatch.setattr(container, "places", FakePlaces())
    rows = (await client.get(f"{API}/venues?q=Howzzat", headers=me.h)).json()["data"]
    assert [(r["id"], r["source"]) for r in rows] == [(first["id"], "gofindr")]


async def test_a_dead_provider_still_returns_our_grounds(
    client: httpx.AsyncClient, container: Container, ground: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = await player(client, "Venue Resilient", "batsman", SECTOR_18)
    mine = await container.mongo["venues"].find_one({"_id": ObjectId(ground)})
    assert mine
    monkeypatch.setattr(container, "places", BrokenPlaces())
    r = await client.get(f"{API}/venues", params={"q": mine["name"]}, headers=me.h)
    assert r.status_code == 200
    assert [x["id"] for x in r.json()["data"]] == [ground]


async def test_a_two_letter_query_does_not_call_the_provider(
    client: httpx.AsyncClient, container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = await player(client, "Venue Typist", "batsman", SECTOR_18)
    fake = FakePlaces(HOWZZAT)
    monkeypatch.setattr(container, "places", fake)
    assert (await client.get(f"{API}/venues?q=Ho", headers=me.h)).status_code == 200
    assert fake.calls == 0
