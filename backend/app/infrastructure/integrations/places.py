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
* ``none`` — no external calls at all. Search then returns only grounds GoFindr already knows.

Results are suggestions, not records: a place becomes a GoFindr venue only when a captain picks it
(``POST /venues/resolve``), so typing never writes to the database. Provider failures and timeouts
are swallowed — the seeded and captain-added grounds still answer the search.
"""

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

    source: Literal["osm", "google"]
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


def build_places_provider(settings: Settings) -> PlacesProvider:
    if settings.places_provider == "google":
        if not settings.places_api_key:
            log.warning("places.google_key_missing", extra={"fallback": "osm"})
            return OsmPlaces()
        return GooglePlaces(settings.places_api_key)
    if settings.places_provider == "osm":
        return OsmPlaces()
    return DisabledPlaces()
