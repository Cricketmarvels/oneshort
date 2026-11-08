"""Seeded cricket grounds for venue search (a geocoding provider can be added behind this)."""

import re
from typing import Annotated, Any

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import approx_km

router = APIRouter(prefix="/venues", tags=["Venues"], responses=ERROR_RESPONSES)


class VenueSearchOut(BaseModel):
    id: str
    name: str
    address: str
    area: str
    city: str
    lat: float
    lng: float
    distance_km: float | None = None


@router.get("", response_model=Envelope[list[VenueSearchOut]], summary="Search cricket grounds")
async def search_venues(
    _: UserDep,
    c: ContainerDep,
    q: Annotated[str | None, Query(max_length=60)] = None,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
) -> Envelope[list[VenueSearchOut]]:
    match: dict[str, Any] = {}
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        match = {"$or": [{"name": rx}, {"area": rx}, {"city": rx}]}
    if lat is not None and lng is not None:
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
    return ok(
        [
            VenueSearchOut(
                id=str(r["_id"]),
                name=r["name"],
                address=r["address"],
                area=r["area"],
                city=r["city"],
                lat=r["location"]["coordinates"][1],
                lng=r["location"]["coordinates"][0],
                distance_km=approx_km(r["d"]) if "d" in r else None,
            )
            for r in rows
        ]
    )
