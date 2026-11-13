"""Cricket ground search: OneShort's own venues first, then suggestions from a map provider.

OneShort knows a ground once somebody has played there. Everything else a captain might search for
("Howzzat Arena") lives in a map provider until then, so a search with ``q`` also asks the provider
configured by ``PLACES_PROVIDER`` (app/infrastructure/integrations/places.py) and merges what comes
back, marked ``source``. Suggestions carry no id and are never written by a search; picking one
calls ``POST /venues/resolve``, which stores it once and returns a real venue.
"""

import re
import unicodedata
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from pymongo import ReturnDocument

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import approx_km, utcnow
from app.core.logging import get_logger
from app.infrastructure.integrations.places import Place

log = get_logger("venues")
router = APIRouter(prefix="/venues", tags=["Venues"], responses=ERROR_RESPONSES)
MIN_QUERY = 3  # shorter than this matches half a city, and wastes a provider call
NEAR_DEGREES = 0.003  # ~300 m: the same ground pinned slightly differently


class VenueSearchOut(BaseModel):
    id: str | None = Field(default=None, description="OneShort venue id; null for a map suggestion not yet saved")
    name: str
    address: str
    area: str
    city: str
    lat: float
    lng: float
    distance_km: float | None = None
    source: str = Field(default="oneshort", description="oneshort (a ground we know) | osm | google")
    place_id: str | None = Field(default=None, description="Provider key; pass it back to /venues/resolve")


class PlaceIn(BaseModel):
    """A suggestion the captain picked, echoed back from a search result."""

    name: str = Field(min_length=1, max_length=120)
    address: str = Field(default="", max_length=240)
    area: str = Field(min_length=1, max_length=120)
    city: str = Field(min_length=1, max_length=120)
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    source: str = Field(default="osm", max_length=20)
    place_id: str | None = Field(default=None, max_length=120)


def _key(name: str) -> str:
    """Fold a ground name for comparison: 'Sector 76 Nets' and 'sector-76  nets' are one ground."""
    flat = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", " ", flat.lower()).strip()


def _row(r: dict[str, Any]) -> VenueSearchOut:
    return VenueSearchOut(
        id=str(r["_id"]),
        name=r["name"],
        address=r["address"],
        area=r["area"],
        city=r["city"],
        lat=r["location"]["coordinates"][1],
        lng=r["location"]["coordinates"][0],
        distance_km=approx_km(r["d"]) if "d" in r else None,
        source="oneshort",
        place_id=r.get("place_id"),
    )


def _doc(p: PlaceIn | Place) -> dict[str, Any]:
    return {
        "name": p.name,
        "address": p.address or p.name,
        "area": p.area,
        "city": p.city,
        "location": {"type": "Point", "coordinates": [p.lng, p.lat]},
        "source": p.source,
        "place_id": p.place_id,
    }


async def _suggest(c: ContainerDep, q: str, lat: float | None, lng: float | None) -> list[Place]:
    """Provider suggestions, cached for a day.

    A provider that is slow, down or rate-limiting returns nothing — the ground list still works. A paid
    provider is also capped by ``PLACES_DAILY_BUDGET``: past it, search quietly falls back to our own grounds.
    """
    provider = c.places
    if provider.name == "none" or len(q) < MIN_QUERY:
        return []
    cache_key = f"{provider.name}:{_key(q)}:{round(lat or 0, 1)},{round(lng or 0, 1)}"
    hours = c.settings.places_cache_hours
    if hours:
        hit = await c.mongo["places_cache"].find_one({"_id": cache_key})
        if hit:
            return [Place(**p) for p in hit["places"]]
    budget = c.settings.places_daily_budget
    if provider.billed and budget:
        day = utcnow().strftime("%Y-%m-%d")
        spent = await c.mongo["places_budget"].find_one_and_update(
            {"_id": f"{provider.name}:{day}"},
            {"$inc": {"calls": 1}, "$set": {"expires_at": utcnow() + timedelta(days=2)}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        if spent and spent.get("calls", 0) > budget:
            log.warning("places.budget_exhausted", extra={"provider": provider.name, "budget": budget})
            return []
    try:
        found = await provider.search(q, lat, lng, c.settings.places_country)
    except Exception as exc:  # a map provider must never break the ground list
        log.warning("places.search_failed", extra={"provider": provider.name, "error": type(exc).__name__})
        return []
    # An empty answer isn't cached: it is usually a provider hiccup, and a day-long blank is worse than a retry.
    if hours and found:
        await c.mongo["places_cache"].update_one(
            {"_id": cache_key},
            {
                "$set": {
                    "places": [p.model_dump() for p in found],
                    "expires_at": utcnow() + timedelta(hours=hours),
                }
            },
            upsert=True,
        )
    return found


@router.get("", response_model=Envelope[list[VenueSearchOut]], summary="Search cricket grounds")
async def search_venues(
    _: UserDep,
    c: ContainerDep,
    q: Annotated[str | None, Query(max_length=60)] = None,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
) -> Envelope[list[VenueSearchOut]]:
    text = (q or "").strip()
    match: dict[str, Any] = {}
    if text:
        rx = {"$regex": re.escape(text), "$options": "i"}
        match = {"$or": [{"name": rx}, {"area": rx}, {"city": rx}]}
    # Without a search term the list is "near me"; with one it is "anywhere", so distance can't filter it out.
    if lat is not None and lng is not None and not text:
        pipeline: list[dict[str, Any]] = [
            {
                "$geoNear": {
                    "near": {"type": "Point", "coordinates": [lng, lat]},
                    "key": "location",
                    "distanceField": "d",
                    "spherical": True,
                    "maxDistance": 50_000,
                    "query": match,
                }
            },
            {"$limit": 20},
        ]
        rows = [r async for r in await c.mongo["venues"].aggregate(pipeline)]
    else:
        rows = [r async for r in c.mongo["venues"].find(match).limit(20)]

    out = [_row(r) for r in rows]
    if not text:
        return ok(out)

    known_ids = {r.get("place_id") for r in rows if r.get("place_id")}
    # One ground, one row: providers repeat a place across OSM nodes and ways, and we may already know it.
    known = {(_key(v.name), round(v.lat, 2), round(v.lng, 2)) for v in out}
    for p in await _suggest(c, text, lat, lng):
        if p.place_id in known_ids:
            continue
        if any(
            k == _key(p.name) and abs(la - round(p.lat, 2)) <= 0.01 and abs(lo - round(p.lng, 2)) <= 0.01
            for k, la, lo in known
        ):
            continue
        known.add((_key(p.name), round(p.lat, 2), round(p.lng, 2)))
        out.append(
            VenueSearchOut(
                name=p.name,
                address=p.address,
                area=p.area,
                city=p.city,
                lat=p.lat,
                lng=p.lng,
                source=p.source,
                place_id=p.place_id,
                distance_km=p.distance_km,  # only providers that measure it (Ola does)
            )
        )
    return ok(out[:30])


@router.post("/resolve", response_model=Envelope[VenueSearchOut], summary="Save a picked map place as a venue")
async def resolve_venue(_: UserDep, c: ContainerDep, body: PlaceIn) -> Envelope[VenueSearchOut]:
    """Turn a suggestion into a real OneShort ground, reusing it if this place is already known.

    Called when a captain picks a map result, so a ground enters the database once it is actually used —
    and the next captain searching the same area finds it without a provider call.
    """
    venues = c.mongo["venues"]
    found = None
    if body.place_id:
        found = await venues.find_one({"place_id": body.place_id})
    if not found:  # same name, same spot: an earlier captain typed or imported it
        found = await venues.find_one(
            {
                "name": {"$regex": f"^{re.escape(body.name)}$", "$options": "i"},
                "location.coordinates.0": {"$gte": body.lng - NEAR_DEGREES, "$lte": body.lng + NEAR_DEGREES},
                "location.coordinates.1": {"$gte": body.lat - NEAR_DEGREES, "$lte": body.lat + NEAR_DEGREES},
            }
        )
    if found:
        return ok(_row(found))
    doc = _doc(body) | {"created_at": utcnow()}
    try:
        res = await venues.insert_one(doc)
        doc["_id"] = res.inserted_id
    except Exception:  # unique place_id: two captains picked the same ground at once
        existing = await venues.find_one({"place_id": body.place_id})
        if not existing:
            raise
        doc = existing
    return ok(_row(doc))
