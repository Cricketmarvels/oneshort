"""GET /search — instant, typed results for players, teams and grounds (see service.py for the algorithm).

Natural-language requests ("play on Saturday morning") stay on POST /search/smart (assistant module);
the app calls this endpoint while typing and that one on submit.
"""

from typing import Annotated, Literal

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.modules.search.service import ALL_TYPES, SearchService, SearchType

router = APIRouter(prefix="/search", tags=["Search"], responses=ERROR_RESPONSES)


class PlayerHit(BaseModel):
    id: str
    name: str
    role: str | None
    area: str | None
    city: str | None
    image: str | None
    verified_matches: int
    has_cricheroes: bool
    cricheroes_profile_url: str | None
    distance_km: float | None


class TeamHit(BaseModel):
    id: str
    name: str
    area: str | None
    city: str | None
    logo: str | None
    member_count: int
    has_cricheroes: bool
    looking_for_opponents: bool
    distance_km: float | None


class GroundHit(BaseModel):
    id: str
    name: str
    address: str | None
    area: str | None
    city: str | None
    lat: float | None
    lng: float | None
    distance_km: float | None


class UnifiedSearchOut(BaseModel):
    query: str
    players: list[PlayerHit]
    teams: list[TeamHit]
    grounds: list[GroundHit]


_TYPE_NAMES: dict[str, SearchType] = {"players": "player", "teams": "team", "grounds": "ground"}


@router.get("", response_model=Envelope[UnifiedSearchOut], summary="Search players, teams and grounds by name")
async def unified_search(
    user: UserDep,
    c: ContainerDep,
    q: Annotated[str, Query(min_length=1, max_length=60, description="Name or the start of one")],
    types: Annotated[
        str | None, Query(description="Comma-separated subset of players,teams,grounds (default all)", max_length=40)
    ] = None,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 8,
) -> Envelope[UnifiedSearchOut]:
    wanted: tuple[SearchType, ...] = ALL_TYPES
    if types:
        picked = tuple(_TYPE_NAMES[t] for t in types.split(",") if t in _TYPE_NAMES)
        wanted = picked or ALL_TYPES
    res = await SearchService(c).search(user, q, wanted, lat, lng, limit)
    players: list[PlayerHit] = []
    teams: list[TeamHit] = []
    grounds: list[GroundHit] = []
    for h in res.get("player", []):
        d, m = h.doc, h.doc.get("meta") or {}
        players.append(
            PlayerHit(
                id=str(d["entity_id"]),
                name=d["name"],
                role=m.get("role"),
                area=d.get("area"),
                city=d.get("city"),
                image=d.get("image"),
                verified_matches=int(m.get("verified_matches") or 0),
                has_cricheroes=bool(m.get("has_cricheroes")),
                cricheroes_profile_url=m.get("cricheroes_profile_url"),
                distance_km=h.distance_km,
            )
        )
    for h in res.get("team", []):
        d, m = h.doc, h.doc.get("meta") or {}
        teams.append(
            TeamHit(
                id=str(d["entity_id"]),
                name=d["name"],
                area=d.get("area"),
                city=d.get("city"),
                logo=d.get("image"),
                member_count=int(m.get("member_count") or 0),
                has_cricheroes=bool(m.get("has_cricheroes")),
                looking_for_opponents=bool(m.get("looking_for_opponents")),
                distance_km=h.distance_km,
            )
        )
    for h in res.get("ground", []):
        d, m = h.doc, h.doc.get("meta") or {}
        loc = (d.get("loc") or {}).get("coordinates")
        grounds.append(
            GroundHit(
                id=str(d["entity_id"]),
                name=d["name"],
                address=m.get("address"),
                area=d.get("area"),
                city=d.get("city"),
                lat=loc[1] if loc else None,
                lng=loc[0] if loc else None,
                distance_km=h.distance_km,
            )
        )
    return ok(UnifiedSearchOut(query=q, players=players, teams=teams, grounds=grounds))


SearchKind = Literal["players", "teams", "grounds"]
