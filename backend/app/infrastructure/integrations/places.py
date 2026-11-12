"""Place search behind ``GET /venues``: finds grounds that aren't in GoFindr's own database yet.

Captains look for a ground by the name on the gate ("Howzzat Arena"), which only exists in a map
provider's data until somebody plays there. The adapter below is chosen with ``PLACES_PROVIDER``:

* ``osm`` (default) — Photon, Komoot's geocoder over OpenStreetMap. Free, no key, no account.
  Coverage of Indian stadiums and larger turf arenas is good; small private grounds can be missing.
* ``google`` — Places API (New) Text Search (``places:searchText``). The data behind Google Maps, so
  coverage of Indian turf grounds is far better, but it needs a Google Cloud project with billing and
  is charged per request. Set ``PLACES_PROVIDER=google`` and ``PLACES_API_KEY=…`` to switch; nothing
  else changes. The field mask is deliberately minimal — it is what decides the billing tier, and
  ``displayName`` puts this call in Text Search Pro (5,000 free per month, then about $32 per 1,000 as
  of Nov 2026). ``PLACES_DAILY_BUDGET`` caps calls so a loop or a busy day can't run up a bill.
  Cheaper if the volume ever justifies the extra round trip: Autocomplete (about $2.83 per 1,000)
  for the list, then Place Details with an Essentials-only mask once, when a captain picks a ground.
* ``ola`` — Ola Maps (Krutrim), built for India. A free key, no card and no billing account: 100,000
  events a month cost nothing (``maps.olakrutrim.com``, Nov 2026). Coverage of Indian turf grounds and
  local businesses is far better than OpenStreetMap's. Set ``PLACES_PROVIDER=ola`` and ``PLACES_API_KEY``.
* ``none`` — no external calls at all. Search then returns only grounds GoFindr already knows.

Results are suggestions, not records: a place becomes a GoFindr venue only when a captain picks it
(``POST /venues/resolve``), so typing never writes to the database. Provider failures and timeouts
are swallowed — the seeded and captain-added grounds still answer the search.
"""

import asyncio
from typing import Any, Literal, Protocol

import httpx
from pydantic import BaseModel

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("places")
TIMEOUT = 4.0  # a slow geocoder must not hold up the ground list
# Polite, generic identification. Never put a user's details in here: these requests leave our network.
UA = "GoFindr/1.0 (+https://gofindr.in)"


class Place(BaseModel):
    """One suggestion from a map provider. It has no GoFindr id until a captain picks it."""

    source: Literal["osm", "google", "ola"]
    place_id: str
    name: str
    address: str
    area: str
    city: str
    lat: float
    lng: float


class PlacesProvider(Protocol):
    name: str
    billed: bool  # True if each call costs money, so the daily budget applies

    async def search(self, q: str, lat: float | None, lng: float | None, country: str) -> list[Place]: ...


class DisabledPlaces:
    name = "none"
    billed = False

    async def search(self, q: str, lat: float | None, lng: float | None, country: str) -> list[Place]:
        return []


def split_address(text: str) -> tuple[str, str]:
    """Pull an (area, city) pair out of a one-line Indian address.

    "Mahadevpura, Bengaluru, Karnataka 560048, India" -> ("Mahadevpura", "Bengaluru"). The country and the
    state-plus-pincode tail are dropped; what's left is specific enough for a captain to recognise.
    """
    parts = [p.strip() for p in text.split(",") if p.strip()]
    if parts and parts[-1].lower() in {"india", "bharat"}:
        parts = parts[:-1]
    if len(parts) > 1 and any(ch.isdigit() for ch in parts[-1]):  # "Karnataka 560048"
        parts = parts[:-1]
    if not parts:
        return ("—", "—")
    area = parts[0]
    city = parts[1] if len(parts) > 1 else parts[0]
    return (area, city)


def _first(d: dict[str, Any], *keys: str) -> str:
    for k in keys:
        v = d.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return ""


class OsmPlaces:
    """Photon (photon.komoot.io): OpenStreetMap search built for type-ahead. Free, no API key."""

    name = "osm"
    billed = False

    async def search(self, q: str, lat: float | None, lng: float | None, country: str) -> list[Place]:
        params: dict[str, Any] = {"q": q, "limit": 10, "lang": "en"}
        if lat is not None and lng is not None:
            params |= {"lat": lat, "lon": lng}  # biases ranking towards the captain, doesn't exclude anything
        async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": UA}) as client:
            resp = await client.get("https://photon.komoot.io/api", params=params)
        resp.raise_for_status()
        out: list[Place] = []
        for f in resp.json().get("features", []):
            p = f.get("properties") or {}
            coords = (f.get("geometry") or {}).get("coordinates") or []
            name = _first(p, "name")
            if not name or len(coords) != 2:
                continue
            if country and str(p.get("countrycode", "")).lower() not in ("", country.lower()):
                continue
            city = _first(p, "city", "town", "village", "county", "state")
            area = _first(p, "district", "suburb", "locality", "neighbourhood", "street") or city
            house = _first(p, "housenumber")
            street = _first(p, "street")
            address = ", ".join(x for x in [f"{house} {street}".strip() if street else "", area, city] if x)
            out.append(
                Place(
                    source="osm",
                    place_id=f"osm:{p.get('osm_type', 'N')}{p.get('osm_id', name)}",
                    name=name,
                    address=address or name,
                    area=area or city or "—",
                    city=city or area or "—",
                    lat=float(coords[1]),
                    lng=float(coords[0]),
                )
            )
        return out


class GooglePlaces:
    """Places API (New) Text Search. Billed per request — see the module docstring before enabling."""

    name = "google"
    billed = True
    # Every extra field can raise the billing tier, so this mask is the minimum the ground list needs.
    FIELDS = "places.id,places.displayName,places.formattedAddress,places.location,places.addressComponents"

    def __init__(self, api_key: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = api_key
        self._transport = transport  # tests inject a stub; production leaves it None

    async def search(self, q: str, lat: float | None, lng: float | None, country: str) -> list[Place]:
        # searchText takes regionCode (a single ccTLD) and pageSize; includedRegionCodes and
        # maxResultCount belong to other methods and are rejected or deprecated here.
        body: dict[str, Any] = {"textQuery": q, "pageSize": 10, "languageCode": "en"}
        if country:
            body["regionCode"] = country.lower()
        if lat is not None and lng is not None:
            body["locationBias"] = {"circle": {"center": {"latitude": lat, "longitude": lng}, "radius": 50_000.0}}
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=self._transport) as client:
            resp = await client.post(
                "https://places.googleapis.com/v1/places:searchText",
                headers={"X-Goog-Api-Key": self._key, "X-Goog-FieldMask": self.FIELDS, "User-Agent": UA},
                json=body,
            )
        resp.raise_for_status()
        out: list[Place] = []
        for r in resp.json().get("places", []):
            name = ((r.get("displayName") or {}).get("text") or "").strip()
            loc = r.get("location") or {}
            if not name or "latitude" not in loc:
                continue
            comp = {c["types"][0]: c.get("longText", "") for c in r.get("addressComponents", []) if c.get("types")}
            city = comp.get("locality") or comp.get("administrative_area_level_2") or ""
            area = comp.get("sublocality_level_1") or comp.get("sublocality") or comp.get("neighborhood") or city
            out.append(
                Place(
                    source="google",
                    place_id=f"google:{r.get('id', name)}",
                    name=name,
                    address=(r.get("formattedAddress") or name).strip(),
                    area=area or city or "—",
                    city=city or area or "—",
                    lat=float(loc["latitude"]),
                    lng=float(loc["longitude"]),
                )
            )
        return out


class OlaPlaces:
    """Ola Maps Places autocomplete. Free for the first 100,000 events a month, no billing account.

    Ola publishes the endpoint but not the response schema, so the parsing below accepts the shapes their
    SDK documents and the ones a Google-style API usually returns, and ignores anything it can't read.
    A prediction that arrives without coordinates is completed with one Place Details call (concurrently,
    at most ``DETAIL_LOOKUPS`` of them), because a ground with no location can't become a match venue.
    If that ever dominates the quota, move the lookup to the moment a captain picks a ground.
    """

    name = "ola"
    billed = False  # free inside the monthly allowance; PLACES_DAILY_BUDGET still applies if set
    BASE = "https://api.olamaps.io/places/v1"
    DETAIL_LOOKUPS = 5

    def __init__(self, api_key: str, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._key = api_key
        self._transport = transport

    @staticmethod
    def _coords(d: dict[str, Any]) -> tuple[float, float] | None:
        geo = d.get("geometry") or {}
        for candidate in (geo.get("location"), geo, d.get("location"), d.get("position")):
            if not isinstance(candidate, dict):
                continue
            lat = candidate.get("lat", candidate.get("latitude"))
            lng = candidate.get("lng", candidate.get("longitude", candidate.get("lon")))
            if isinstance(lat, int | float) and isinstance(lng, int | float):
                return (float(lat), float(lng))
        return None

    def _place(self, pred: dict[str, Any], coords: tuple[float, float]) -> Place | None:
        fmt = pred.get("structured_formatting") or {}
        description = _first(pred, "description", "formatted_address") or ""
        name = _first(fmt, "main_text") or _first(pred, "name") or description.split(",")[0].strip()
        if not name:
            return None
        # "Dugout Turf, Sector 76, Noida" — the address is whatever follows the name.
        rest = _first(fmt, "secondary_text")
        if not rest:
            head, _, tail = description.partition(",")
            rest = tail.strip() if head.strip() == name and tail.strip() else description
        area, city = split_address(rest)
        place_id = _first(pred, "place_id", "id") or name
        return Place(
            source="ola",
            place_id=f"ola:{place_id}",
            name=name,
            address=description or name,
            area=area,
            city=city,
            lat=coords[0],
            lng=coords[1],
        )

    async def _detail_coords(self, client: httpx.AsyncClient, place_id: str) -> tuple[float, float] | None:
        try:
            resp = await client.get(f"{self.BASE}/details", params={"place_id": place_id, "api_key": self._key})
            resp.raise_for_status()
            result = resp.json().get("result") or {}
        except Exception as exc:  # one unresolvable suggestion must not lose the others
            log.warning("places.ola_details_failed", extra={"error": type(exc).__name__})
            return None
        return self._coords(result if isinstance(result, dict) else {})

    async def search(self, q: str, lat: float | None, lng: float | None, country: str) -> list[Place]:
        params: dict[str, Any] = {"input": q, "api_key": self._key}
        if lat is not None and lng is not None:
            params["location"] = f"{lat},{lng}"  # biases results towards the captain
        async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": UA}, transport=self._transport) as c:
            resp = await c.get(f"{self.BASE}/autocomplete", params=params)
            resp.raise_for_status()
            body = resp.json()
            preds = body.get("predictions") or body.get("results") or []
            preds = [p for p in preds if isinstance(p, dict)][:10]

            missing = [p for p in preds if self._coords(p) is None and _first(p, "place_id", "id")]
            looked_up: dict[str, tuple[float, float] | None] = {}
            if missing:
                ids = [_first(p, "place_id", "id") for p in missing[: self.DETAIL_LOOKUPS]]
                found = await asyncio.gather(*(self._detail_coords(c, i) for i in ids))
                looked_up = dict(zip(ids, found, strict=True))

        out: list[Place] = []
        for pred in preds:
            coords = self._coords(pred) or looked_up.get(_first(pred, "place_id", "id"))
            if not coords:
                continue  # a ground we can't place on a map can't be a match venue
            place = self._place(pred, coords)
            if place:
                out.append(place)
        return out


def build_places_provider(settings: Settings) -> PlacesProvider:
    if settings.places_provider == "google":
        if not settings.places_api_key:
            log.warning("places.google_key_missing", extra={"fallback": "osm"})
            return OsmPlaces()
        return GooglePlaces(settings.places_api_key)
    if settings.places_provider == "ola":
        if not settings.places_api_key:
            log.warning("places.ola_key_missing", extra={"fallback": "osm"})
            return OsmPlaces()
        return OlaPlaces(settings.places_api_key)
    if settings.places_provider == "osm":
        return OsmPlaces()
    return DisabledPlaces()
