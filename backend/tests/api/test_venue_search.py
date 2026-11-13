"""Ground search: OneShort's own venues, map suggestions merged in, and picking one that isn't ours yet.

The provider is faked here. The real adapters (Photon, Google Places) are network calls; what matters
is that a search never writes, a pick writes once, and a provider failure can't break the ground list.
"""

import json
import uuid
from collections.abc import Mapping
from typing import Any

import httpx
import pytest
from bson import ObjectId

from app.core.container import Container
from app.infrastructure.integrations.places import GooglePlaces, OlaPlaces, Place, split_address
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
    billed = False

    def __init__(self, *places: Place) -> None:
        self.places = list(places)
        self.calls = 0

    async def search(self, q: str, lat: float | None, lng: float | None, country: str) -> list[Place]:
        self.calls += 1
        return [p for p in self.places if q.lower() in p.name.lower()]


class BrokenPlaces:
    name = "osm"
    billed = False

    async def search(self, q: str, lat: float | None, lng: float | None, country: str) -> list[Place]:
        raise httpx.ConnectTimeout("provider down")


@pytest.fixture
async def ground(container: Container) -> str:
    """A ground OneShort already knows. The name is unique so one test's rows can't answer another's search."""
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
    assert all(r["source"] == "oneshort" and r["id"] for r in rows)
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
    assert first["id"] and first["source"] == "oneshort" and first["name"] == "Howzzat Cricket Arena"
    again = (await client.post(f"{API}/venues/resolve", headers=other.h, json=body)).json()["data"]
    assert again["id"] == first["id"]  # one ground, however many captains pick it
    assert await container.mongo["venues"].count_documents({"place_id": "osm:N123"}) == 1

    # It is now a OneShort ground: found without the provider, and usable as a match venue.
    monkeypatch.setattr(container, "places", FakePlaces())
    rows = (await client.get(f"{API}/venues?q=Howzzat", headers=me.h)).json()["data"]
    assert [(r["id"], r["source"]) for r in rows] == [(first["id"], "oneshort")]


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


# ------------------------------------------------------------------ Google Places adapter
GOOGLE_REPLY = {
    "places": [
        {
            "id": "ChIJhowzzat",
            "displayName": {"text": "Howzzat Cricket Arena"},
            "formattedAddress": "C-56, Sector 62, Noida, Uttar Pradesh 201301, India",
            "location": {"latitude": 28.627, "longitude": 77.381},
            "addressComponents": [
                {"longText": "Sector 62", "types": ["sublocality_level_1", "sublocality"]},
                {"longText": "Noida", "types": ["locality"]},
            ],
        }
    ]
}


def _google(reply: Mapping[str, Any], seen: dict[str, Any]) -> GooglePlaces:
    """A Google adapter whose HTTP call is answered locally, so the request shape can be asserted."""

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["mask"] = request.headers.get("X-Goog-FieldMask")
        seen["key"] = request.headers.get("X-Goog-Api-Key")
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=dict(reply))

    return GooglePlaces("test-key", transport=httpx.MockTransport(handler))


async def test_google_sends_the_parameters_text_search_actually_accepts() -> None:
    seen: dict[str, Any] = {}
    found = await _google(GOOGLE_REPLY, seen).search("Howzzat", 28.5794, 77.3374, "in")

    assert seen["url"] == "https://places.googleapis.com/v1/places:searchText"
    body = seen["body"]
    assert isinstance(body, dict)
    assert body["textQuery"] == "Howzzat" and body["pageSize"] == 10
    # searchText takes regionCode; includedRegionCodes is rejected and maxResultCount is deprecated.
    assert body["regionCode"] == "in"
    assert "includedRegionCodes" not in body and "maxResultCount" not in body
    assert body["locationBias"]["circle"]["center"] == {"latitude": 28.5794, "longitude": 77.3374}
    assert seen["mask"] and "places.location" in str(seen["mask"])  # the mask decides the billing tier

    assert len(found) == 1
    p = found[0]
    assert (p.name, p.area, p.city) == ("Howzzat Cricket Arena", "Sector 62", "Noida")
    assert (p.source, p.place_id) == ("google", "google:ChIJhowzzat")
    assert (round(p.lat, 3), round(p.lng, 3)) == (28.627, 77.381)


async def test_a_paid_provider_stops_at_the_daily_budget(
    client: httpx.AsyncClient, container: Container, monkeypatch: pytest.MonkeyPatch
) -> None:
    me = await player(client, "Venue Budget", "batsman", SECTOR_18)
    paid = FakePlaces(HOWZZAT)
    paid.billed = True
    monkeypatch.setattr(container, "places", paid)
    monkeypatch.setattr(
        container, "settings", container.settings.model_copy(update={"places_daily_budget": 2, "places_cache_hours": 0})
    )

    names = [f"Howzzat {i}" for i in range(4)]  # distinct queries: the cache can't hide the budget
    for n in names:
        assert (await client.get(f"{API}/venues", params={"q": n}, headers=me.h)).status_code == 200
    assert paid.calls == 2  # the third and fourth searches fall back to our own grounds, quietly


# ------------------------------------------------------------------ Ola Maps adapter
OLA_WITH_COORDS = {
    "status": "OK",
    "predictions": [
        {
            "place_id": "ola-platform:123",
            "description": "Howzzat Box Cricket, Sector 62, Noida, Uttar Pradesh 201301, India",
            "structured_formatting": {
                "main_text": "Howzzat Box Cricket",
                "secondary_text": "Sector 62, Noida, Uttar Pradesh 201301, India",
            },
            "geometry": {"location": {"lat": 28.627, "lng": 77.381}},
        }
    ],
}
OLA_WITHOUT_COORDS = {
    "status": "OK",
    "predictions": [{"place_id": "ola-platform:456", "description": "Dugout Turf, Sector 76, Noida, India"}],
}
OLA_DETAILS = {
    "status": "OK",
    "result": {"name": "Dugout Turf", "geometry": {"location": {"lat": 28.5655, "lng": 77.386}}},
}


def _ola(routes: dict[str, Mapping[str, Any]], seen: dict[str, Any]) -> OlaPlaces:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.setdefault("paths", []).append(request.url.path)
        seen["params"] = dict(request.url.params)
        for path, reply in routes.items():
            if request.url.path.endswith(path):
                return httpx.Response(200, json=dict(reply))
        return httpx.Response(404, json={})

    return OlaPlaces("test-key", transport=httpx.MockTransport(handler))


async def test_ola_reads_a_prediction_that_carries_its_own_coordinates() -> None:
    seen: dict[str, Any] = {}
    found = await _ola({"/autocomplete": OLA_WITH_COORDS}, seen).search("Howzzat", 28.5794, 77.3374, "in")

    assert seen["paths"] == ["/places/v1/autocomplete"]  # no details call was needed
    assert seen["params"]["input"] == "Howzzat" and seen["params"]["location"] == "28.5794,77.3374"
    assert len(found) == 1
    p = found[0]
    assert (p.name, p.area, p.city) == ("Howzzat Box Cricket", "Sector 62", "Noida")
    assert (p.source, p.place_id) == ("ola", "ola:ola-platform:123")
    assert (round(p.lat, 3), round(p.lng, 3)) == (28.627, 77.381)


async def test_ola_completes_a_prediction_that_has_no_coordinates() -> None:
    seen: dict[str, Any] = {}
    found = await _ola({"/autocomplete": OLA_WITHOUT_COORDS, "/details": OLA_DETAILS}, seen).search(
        "Dugout", None, None, "in"
    )

    assert seen["paths"] == ["/places/v1/autocomplete", "/places/v1/details"]
    assert "location" not in seen["params"]
    assert len(found) == 1
    p = found[0]
    assert (p.name, p.area, p.city) == ("Dugout Turf", "Sector 76", "Noida")
    assert (round(p.lat, 3), round(p.lng, 3)) == (28.566, 77.386)


async def test_ola_drops_a_suggestion_it_cannot_place_on_a_map() -> None:
    """A ground with no coordinates can't become a match venue, so it is left out rather than half-shown."""
    seen: dict[str, Any] = {}
    found = await _ola({"/autocomplete": OLA_WITHOUT_COORDS, "/details": {"status": "OK", "result": {}}}, seen).search(
        "Dugout", None, None, "in"
    )
    assert found == []


OLA_REAL_SHAPE = {
    "status": "ok",
    "predictions": [
        {
            "place_id": "ola-platform:5000047081232",
            "description": "Howzzatt Sports Cricket Ground, Service Rd, Friends Enclave Residency, "
            "Ambedkar City, Noida, Uttar Pradesh, 201307, India",
            "structured_formatting": {
                "main_text": "Howzzatt Sports Cricket Ground",
                "secondary_text": "Service Rd, Friends Enclave Residency, Ambedkar City, Noida, "
                "Uttar Pradesh, 201307, India",
            },
            "terms": [
                {"value": "Howzzatt Sports Cricket Ground"},
                {"value": "Service Rd"},
                {"value": "Friends Enclave Residency"},
                {"value": "Ambedkar City"},
                {"value": "Noida"},
                {"value": "Uttar Pradesh"},
                {"value": "201307"},
                {"value": "India"},
            ],
            "geometry": {"location": {"lat": 28.6049, "lng": 77.4209}},
            "distance_meters": 8641,
        }
    ],
}


async def test_ola_reads_the_shape_the_live_api_returns() -> None:
    """Captured from a real api.olamaps.io reply (Nov 2026): terms, structured_formatting and a distance."""
    seen: dict[str, Any] = {}
    found = await _ola({"/autocomplete": OLA_REAL_SHAPE}, seen).search("howzzat", 28.5794, 77.3374, "in")

    assert seen["paths"] == ["/places/v1/autocomplete"]
    assert len(found) == 1
    p = found[0]
    assert p.name == "Howzzatt Sports Cricket Ground"
    # The street is not the area and the state is not the city: "Ambedkar City, Noida", not "Service Rd, …".
    assert (p.area, p.city) == ("Ambedkar City", "Noida")
    assert p.distance_km == 8.6


def test_indian_addresses_split_into_an_area_and_a_city() -> None:
    assert split_address("Mahadevpura, Bengaluru, Karnataka 560048, India") == ("Mahadevpura", "Bengaluru")
    assert split_address("Sector 62, Noida, Uttar Pradesh 201301, India") == ("Sector 62", "Noida")
    assert split_address("Koramangala, Bengaluru, Karnataka, India") == ("Koramangala", "Bengaluru")
    assert split_address("Service Rd, Ambedkar City, Noida, Uttar Pradesh, 201307, India") == (
        "Ambedkar City",
        "Noida",
    )
    assert split_address("Noida") == ("Noida", "Noida")
    assert split_address("") == ("—", "—")
