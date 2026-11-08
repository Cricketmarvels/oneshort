"""Badminton & Pickleball: player profiles, nearby player discovery, play requests and court discovery.

Additive module — cricket collections and endpoints are untouched. Each sport is isolated:
a profile, a search and a request always carry exactly one sport, so a Badminton player
never sees Pickleball players unless they switch sports.

Privacy: exact coordinates are stored for distance only and are never returned; distances are
rounded to the nearest 0.5 km (`approx_km`), as everywhere else in PlayR.
Courts: there is no booking or availability provider yet, so courts expose facts only
(name, area, sports, court count, amenities) and every seeded court is flagged `is_demo`.
"""

import re
from datetime import datetime
from typing import Annotated, Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Path, Query
from pydantic import BaseModel, Field

from app.api.dependencies import ContainerDep, CurrentUser, UserDep
from app.common.enums import NotificationType
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import GeoPointIn, StrictModel, approx_km, parse_object_id, utcnow
from app.core.exceptions import Conflict, Forbidden, NotFound, ValidationFailed

router = APIRouter(prefix="/racket", tags=["Racket sports"], responses=ERROR_RESPONSES)

Sport = Literal["badminton", "pickleball"]
Level = Literal["beginner", "intermediate", "advanced", "professional"]
TimeOfDay = Literal["morning", "afternoon", "evening", "night"]
Availability = Literal["today", "weekdays", "weekends"]
Format = Literal["singles", "doubles", "mixed"]
Gender = Literal["male", "female", "other", "undisclosed"]
RequestStatus = Literal["pending", "accepted", "rejected", "cancelled"]
SPORT_LABEL = {"badminton": "Badminton", "pickleball": "Pickleball"}
RADII = (5, 10, 20, 50)


# ---------------------------------------------------------------- schemas
class RacketProfileIn(StrictModel):
    level: Level
    preferred_times: list[TimeOfDay] = Field(default_factory=list, max_length=4)
    availability: list[Availability] = Field(default_factory=list, max_length=3)
    formats: list[Format] = Field(default_factory=list, max_length=3)
    gender: Gender = "undisclosed"
    home_location: GeoPointIn
    locality: str | None = Field(default=None, max_length=60)
    bio: str | None = Field(default=None, max_length=200)
    discoverable: bool = True


class PublicPlayer(BaseModel):
    id: str
    full_name: str
    profile_image: str | None
    city: str | None


class RacketProfileOut(BaseModel):
    sport: Sport
    level: Level
    preferred_times: list[TimeOfDay]
    availability: list[Availability]
    formats: list[Format]
    gender: Gender
    locality: str | None
    bio: str | None
    discoverable: bool
    matches_played: int
    rating: float | None = Field(description="No racket-sport rating model yet: always null until one exists")


class NearbyRacketPlayerOut(BaseModel):
    user: PublicPlayer
    sport: Sport
    level: Level
    preferred_times: list[TimeOfDay]
    availability: list[Availability]
    formats: list[Format]
    locality: str | None
    distance_km: float
    available_today: bool
    matches_played: int
    rating: float | None
    request_status: RequestStatus | None = Field(description="Your latest request with this player in this sport")


class PlayRequestIn(StrictModel):
    to_user_id: str
    message: str | None = Field(default=None, max_length=200)
    proposed_at: datetime | None = None
    court_id: str | None = None


class CourtBrief(BaseModel):
    id: str
    name: str
    area: str


class PlayRequestOut(BaseModel):
    id: str
    sport: Sport
    status: RequestStatus
    direction: Literal["sent", "received"]
    other: PublicPlayer
    message: str | None
    proposed_at: datetime | None
    court: CourtBrief | None
    created_at: datetime
    responded_at: datetime | None


class CourtOut(BaseModel):
    id: str
    name: str
    address: str
    area: str
    city: str
    sports: list[Sport]
    courts: dict[str, int] = Field(description="Number of courts per sport")
    indoor: bool
    amenities: list[str]
    phone: str | None
    distance_km: float | None
    is_demo: bool = Field(description="Seeded sample facility, not verified with the venue")
    booking_available: bool = Field(description="False until a facility shares live slots with PlayR")


# ---------------------------------------------------------------- helpers
def _public(u: dict[str, Any]) -> PublicPlayer:
    return PublicPlayer(
        id=str(u["_id"]), full_name=u["full_name"], profile_image=u.get("profile_image"), city=u.get("city")
    )


async def _matches_played(c: ContainerDep, uid: ObjectId, sport: str) -> int:
    return await c.mongo["play_requests"].count_documents(
        {"sport": sport, "status": "accepted", "$or": [{"from_user_id": uid}, {"to_user_id": uid}]}
    )


def _today_key() -> str:
    return "weekends" if utcnow().weekday() >= 5 else "weekdays"


def _available_today(p: dict[str, Any]) -> bool:
    av = p.get("availability") or []
    return "today" in av or _today_key() in av


def _profile_out(p: dict[str, Any], played: int) -> RacketProfileOut:
    return RacketProfileOut(
        sport=p["sport"],
        level=p["level"],
        preferred_times=p.get("preferred_times", []),
        availability=p.get("availability", []),
        formats=p.get("formats", []),
        gender=p.get("gender", "undisclosed"),
        locality=p.get("locality"),
        bio=p.get("bio"),
        discoverable=p.get("discoverable", True),
        matches_played=played,
        rating=None,
    )


def _court_out(d: dict[str, Any], distance_m: float | None = None) -> CourtOut:
    return CourtOut(
        id=str(d["_id"]),
        name=d["name"],
        address=d["address"],
        area=d["area"],
        city=d["city"],
        sports=d["sports"],
        courts={k: int(v) for k, v in (d.get("courts") or {}).items()},
        indoor=bool(d.get("indoor", True)),
        amenities=d.get("amenities", []),
        phone=d.get("phone"),
        distance_km=approx_km(distance_m) if distance_m is not None else None,
        is_demo=bool(d.get("is_demo", False)),
        booking_available=False,
    )


async def _request_out(c: ContainerDep, r: dict[str, Any], me: ObjectId) -> PlayRequestOut:
    sent = r["from_user_id"] == me
    other_id = r["to_user_id"] if sent else r["from_user_id"]
    other = await c.mongo["users"].find_one({"_id": other_id}, {"full_name": 1, "profile_image": 1, "city": 1})
    court = (
        await c.mongo["courts"].find_one({"_id": r["court_id"]}, {"name": 1, "area": 1}) if r.get("court_id") else None
    )
    return PlayRequestOut(
        id=str(r["_id"]),
        sport=r["sport"],
        status=r["status"],
        direction="sent" if sent else "received",
        other=_public(other or {"_id": other_id, "full_name": "PlayR player"}),
        message=r.get("message"),
        proposed_at=r.get("proposed_at"),
        court=CourtBrief(id=str(court["_id"]), name=court["name"], area=court["area"]) if court else None,
        created_at=r["created_at"],
        responded_at=r.get("responded_at"),
    )


# ---------------------------------------------------------------- profile
@router.get(
    "/{sport}/profile/me", response_model=Envelope[RacketProfileOut | None], summary="My profile for one racket sport"
)
async def my_profile(sport: Sport, user: UserDep, c: ContainerDep) -> Envelope[RacketProfileOut | None]:
    p = await c.mongo["racket_profiles"].find_one({"user_id": user.id, "sport": sport})
    return ok(_profile_out(p, await _matches_played(c, user.id, sport)) if p else None)


@router.put(
    "/{sport}/profile/me", response_model=Envelope[RacketProfileOut], summary="Create or update my racket-sport profile"
)
async def put_profile(
    sport: Sport, data: RacketProfileIn, user: UserDep, c: ContainerDep
) -> Envelope[RacketProfileOut]:
    now = utcnow()
    fields = data.model_dump(mode="json", exclude={"home_location"})
    fields["location"] = data.home_location.to_geojson()
    p = await c.mongo["racket_profiles"].find_one_and_update(
        {"user_id": user.id, "sport": sport},
        {
            "$set": {**fields, "updated_at": now},
            "$setOnInsert": {"user_id": user.id, "sport": sport, "created_at": now},
        },
        upsert=True,
        return_document=True,
    )
    assert p is not None  # upsert with return_document always returns the document
    return ok(_profile_out(p, await _matches_played(c, user.id, sport)))


# ---------------------------------------------------------------- discovery
@router.get(
    "/{sport}/players/nearby",
    response_model=Envelope[list[NearbyRacketPlayerOut]],
    summary="Find players nearby for one sport",
)
async def nearby_players(
    sport: Sport,
    user: UserDep,
    c: ContainerDep,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lng: Annotated[float, Query(ge=-180, le=180)],
    radius_km: Annotated[int, Query(ge=1, le=50)] = 10,
    level: Level | None = None,
    time: TimeOfDay | None = None,
    availability: Availability | None = None,
    format: Format | None = None,
    gender: Gender | None = None,
    q: Annotated[str | None, Query(max_length=60)] = None,
) -> Envelope[list[NearbyRacketPlayerOut]]:
    query: dict[str, Any] = {"sport": sport, "discoverable": True, "user_id": {"$ne": user.id}}
    if level:
        query["level"] = level
    if time:
        query["preferred_times"] = time
    if format:
        query["formats"] = format
    if gender:
        query["gender"] = gender
    if availability == "today":
        query["availability"] = {"$in": ["today", _today_key()]}
    elif availability:
        query["availability"] = availability
    rows = [
        r
        async for r in await c.mongo["racket_profiles"].aggregate(
            [
                {
                    "$geoNear": {
                        "near": {"type": "Point", "coordinates": [lng, lat]},
                        "key": "location",
                        "distanceField": "d",
                        "spherical": True,
                        "maxDistance": radius_km * 1000,
                        "query": query,
                    }
                },
                {"$limit": 100},
            ]
        )
    ]
    users = {
        u["_id"]: u
        async for u in c.mongo["users"].find(
            {"_id": {"$in": [r["user_id"] for r in rows]}, "account_status": {"$ne": "deleted"}},
            {"full_name": 1, "profile_image": 1, "city": 1},
        )
    }
    rx = re.compile(re.escape(q), re.I) if q else None
    mine = {
        r["to_user_id"]: r["status"]
        async for r in c.mongo["play_requests"]
        .find({"sport": sport, "from_user_id": user.id}, {"to_user_id": 1, "status": 1})
        .sort("created_at", 1)
    }
    out: list[NearbyRacketPlayerOut] = []
    for r in rows:
        u = users.get(r["user_id"])
        if not u or (rx and not rx.search(u["full_name"])):
            continue
        out.append(
            NearbyRacketPlayerOut(
                user=_public(u),
                sport=sport,
                level=r["level"],
                preferred_times=r.get("preferred_times", []),
                availability=r.get("availability", []),
                formats=r.get("formats", []),
                locality=r.get("locality"),
                distance_km=approx_km(r["d"]),
                available_today=_available_today(r),
                matches_played=await _matches_played(c, r["user_id"], sport),
                rating=None,
                request_status=mine.get(r["user_id"]),
            )
        )
    return ok(out)


@router.get(
    "/{sport}/players/{user_id}", response_model=Envelope[NearbyRacketPlayerOut], summary="One player's racket profile"
)
async def player_profile(
    sport: Sport,
    user_id: str,
    user: UserDep,
    c: ContainerDep,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
) -> Envelope[NearbyRacketPlayerOut]:
    uid = parse_object_id(user_id, field="player", not_found=True)
    match: dict[str, Any] = {"sport": sport, "user_id": uid, "discoverable": True}
    if lat is not None and lng is not None:
        rows = [
            r
            async for r in await c.mongo["racket_profiles"].aggregate(
                [
                    {
                        "$geoNear": {
                            "near": {"type": "Point", "coordinates": [lng, lat]},
                            "key": "location",
                            "distanceField": "d",
                            "spherical": True,
                            "query": match,
                        }
                    },
                    {"$limit": 1},
                ]
            )
        ]
        p = rows[0] if rows else None
    else:
        p = await c.mongo["racket_profiles"].find_one(match)
    u = await c.mongo["users"].find_one(
        {"_id": uid, "account_status": {"$ne": "deleted"}}, {"full_name": 1, "profile_image": 1, "city": 1}
    )
    if not p or not u:
        raise NotFound("Player not found")
    last = await c.mongo["play_requests"].find_one(
        {"sport": sport, "from_user_id": user.id, "to_user_id": uid}, sort=[("created_at", -1)]
    )
    return ok(
        NearbyRacketPlayerOut(
            user=_public(u),
            sport=sport,
            level=p["level"],
            preferred_times=p.get("preferred_times", []),
            availability=p.get("availability", []),
            formats=p.get("formats", []),
            locality=p.get("locality"),
            distance_km=approx_km(p["d"]) if "d" in p else 0.0,
            available_today=_available_today(p),
            matches_played=await _matches_played(c, uid, sport),
            rating=None,
            request_status=last["status"] if last else None,
        )
    )


# ---------------------------------------------------------------- play requests
@router.post(
    "/{sport}/requests", status_code=201, response_model=Envelope[PlayRequestOut], summary="Send a play request"
)
async def send_request(sport: Sport, data: PlayRequestIn, user: UserDep, c: ContainerDep) -> Envelope[PlayRequestOut]:
    to = parse_object_id(data.to_user_id, field="to_user_id")
    if to == user.id:
        raise ValidationFailed("You can't send a play request to yourself", code="SELF_REQUEST")
    if not await c.mongo["racket_profiles"].find_one({"user_id": to, "sport": sport, "discoverable": True}, {"_id": 1}):
        raise NotFound(f"That player isn't playing {SPORT_LABEL[sport]} on PlayR")
    if await c.mongo["play_requests"].find_one(
        {"sport": sport, "from_user_id": user.id, "to_user_id": to, "status": "pending"}, {"_id": 1}
    ):
        raise Conflict("You already have a pending request with this player", code="DUPLICATE_REQUEST")
    if data.proposed_at and data.proposed_at <= utcnow():
        raise ValidationFailed("Pick a time in the future", code="PAST_TIME")
    court_id = parse_object_id(data.court_id, field="court_id") if data.court_id else None
    if court_id and not await c.mongo["courts"].find_one({"_id": court_id, "sports": sport}, {"_id": 1}):
        raise NotFound("Court not found for this sport")
    doc = {
        "sport": sport,
        "from_user_id": user.id,
        "to_user_id": to,
        "status": "pending",
        "message": data.message,
        "proposed_at": data.proposed_at,
        "court_id": court_id,
        "created_at": utcnow(),
        "responded_at": None,
    }
    doc["_id"] = (await c.mongo["play_requests"].insert_one(doc)).inserted_id
    await c.notifications.notify(
        [to],
        NotificationType.PLAYER_INVITATION,
        f"{user.full_name} wants to play {SPORT_LABEL[sport]}",
        data.message or "Open PlayR to accept or decline.",
        {"play_request_id": doc["_id"], "sport": sport},
    )
    return ok(await _request_out(c, doc, user.id))


@router.get("/requests", response_model=Envelope[list[PlayRequestOut]], summary="My play requests")
async def my_requests(
    user: UserDep,
    c: ContainerDep,
    sport: Sport | None = None,
    box: Literal["all", "received", "sent"] = "all",
    status: RequestStatus | None = None,
) -> Envelope[list[PlayRequestOut]]:
    who: list[dict[str, Any]] = ([{"to_user_id": user.id}] if box != "sent" else []) + (
        [{"from_user_id": user.id}] if box != "received" else []
    )
    q: dict[str, Any] = {"$or": who}
    if sport:
        q["sport"] = sport
    if status:
        q["status"] = status
    rows = [r async for r in c.mongo["play_requests"].find(q).sort("created_at", -1).limit(100)]
    return ok([await _request_out(c, r, user.id) for r in rows])


async def _respond(
    c: ContainerDep, user: CurrentUser, request_id: str, action: Literal["accept", "reject", "cancel"]
) -> PlayRequestOut:
    rid = parse_object_id(request_id, field="request", not_found=True)
    r = await c.mongo["play_requests"].find_one({"_id": rid})
    if not r:
        raise NotFound("Request not found")
    if action == "cancel" and r["from_user_id"] != user.id or action != "cancel" and r["to_user_id"] != user.id:
        raise Forbidden("You can't do that with this request")
    if r["status"] != "pending":
        raise Conflict(f"This request is already {r['status']}", code="NOT_PENDING")
    status = {"accept": "accepted", "reject": "rejected", "cancel": "cancelled"}[action]
    r = await c.mongo["play_requests"].find_one_and_update(
        {"_id": rid, "status": "pending"}, {"$set": {"status": status, "responded_at": utcnow()}}, return_document=True
    )
    if not r:
        raise Conflict("This request was just updated — refresh", code="NOT_PENDING")
    if action != "cancel":
        await c.notifications.notify(
            [r["from_user_id"]],
            NotificationType.INVITATION_ACCEPTED if action == "accept" else NotificationType.INVITATION_REJECTED,
            f"{user.full_name} {'accepted' if action == 'accept' else 'declined'} "
            f"your {SPORT_LABEL[r['sport']]} request",
            "Agree the time and court together." if action == "accept" else "Try another player nearby.",
            {"play_request_id": rid, "sport": r["sport"]},
        )
    return await _request_out(c, r, user.id)


@router.post(
    "/requests/{request_id}/{action}",
    response_model=Envelope[PlayRequestOut],
    summary="Accept, reject or cancel a play request",
)
async def respond(
    request_id: str, action: Annotated[Literal["accept", "reject", "cancel"], Path()], user: UserDep, c: ContainerDep
) -> Envelope[PlayRequestOut]:
    return ok(await _respond(c, user, request_id, action))


# ---------------------------------------------------------------- courts
@router.get("/{sport}/courts", response_model=Envelope[list[CourtOut]], summary="Find courts nearby for one sport")
async def courts(
    sport: Sport,
    _: UserDep,
    c: ContainerDep,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
    radius_km: Annotated[int, Query(ge=1, le=50)] = 20,
    q: Annotated[str | None, Query(max_length=60)] = None,
    indoor: bool | None = None,
) -> Envelope[list[CourtOut]]:
    match: dict[str, Any] = {"sports": sport}
    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        match["$or"] = [{"name": rx}, {"area": rx}, {"address": rx}]
    if indoor is not None:
        match["indoor"] = indoor
    if lat is not None and lng is not None:
        rows = [
            r
            async for r in await c.mongo["courts"].aggregate(
                [
                    {
                        "$geoNear": {
                            "near": {"type": "Point", "coordinates": [lng, lat]},
                            "key": "location",
                            "distanceField": "d",
                            "spherical": True,
                            "maxDistance": radius_km * 1000,
                            "query": match,
                        }
                    },
                    {"$limit": 50},
                ]
            )
        ]
        return ok([_court_out(r, r["d"]) for r in rows])
    return ok([_court_out(r) async for r in c.mongo["courts"].find(match).limit(50)])


@router.get("/courts/{court_id}", response_model=Envelope[CourtOut], summary="One court")
async def court(court_id: str, _: UserDep, c: ContainerDep) -> Envelope[CourtOut]:
    d = await c.mongo["courts"].find_one({"_id": parse_object_id(court_id, field="court", not_found=True)})
    if not d:
        raise NotFound("Court not found")
    return ok(_court_out(d))
