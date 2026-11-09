"""PlayR home: one call for the personalised command centre."""

from datetime import timedelta
from typing import Any

from pydantic import BaseModel

from app.api.dependencies import CurrentUser
from app.common.response import PageParams
from app.common.types import GeoPointIn, utcnow
from app.core.container import Container
from app.core.exceptions import ValidationFailed
from app.modules.communities.schemas import PostOut
from app.modules.communities.service import CommunityService
from app.modules.competition.challenges import ChallengeService
from app.modules.competition.common import managed_team_ids, player_rating_brief
from app.modules.competition.fixtures import FixtureService
from app.modules.competition.leaderboards import LeaderboardService
from app.modules.competition.schemas import (
    ChallengeOut,
    FixtureOut,
    PlayerLeaderboardEntry,
    RatingBrief,
    TeamDiscoverEntry,
)
from app.modules.users.schemas import PublicUserOut, public_user


class SpotlightOut(BaseModel):
    user: PublicUserOut
    locality: str | None
    gain: float
    matches: int
    headline: str
    is_demo: bool


class CommunityActivity(BaseModel):
    community_id: str
    community_name: str
    post: PostOut


class HomeOut(BaseModel):
    greeting_name: str
    city: str | None
    locality: str | None
    has_location: bool
    rating: RatingBrief | None
    verified_matches: int
    rank_city: int | None
    rank_10km: int | None
    rank_10km_total: int | None
    upcoming: list[FixtureOut]
    awaiting_result: list[FixtureOut]
    nearby_top_players: list[PlayerLeaderboardEntry]
    active_challenges: list[ChallengeOut]
    teams_looking: list[TeamDiscoverEntry]
    community_activity: list[CommunityActivity]
    spotlight: SpotlightOut | None
    managed_team_ids: list[str]


async def build_home(c: Container, user: CurrentUser, at: GeoPointIn | None) -> HomeOut:
    lb = LeaderboardService(c)
    prof = await c.mongo["player_profiles"].find_one({"user_id": user.id}) or {}
    rating = await c.mongo["player_ratings"].find_one({"user_id": user.id})
    if at is None and prof.get("home_location"):
        lng, lat = prof["home_location"]["coordinates"]
        at = GeoPointIn(lat=lat, lng=lng)

    nearby: list[PlayerLeaderboardEntry] = []
    rank_10 = total_10 = None
    teams_looking: list[TeamDiscoverEntry] = []
    if at:
        try:
            near = await lb.players(user, "10km", "overall", None, at, None, None, PageParams(page=1, page_size=5))
            nearby = near.data
            rank_10 = near.me.rank if near.me else None
            total_10 = near.meta.total
            managed = await _managed(c, user)
            teams_looking = await lb.discover_teams(
                user, at, 20, managed[0] if managed else None, None, None, None, None, 6
            )
        except ValidationFailed:
            pass

    fx = FixtureService(c)
    upcoming = (await fx.mine(user, "upcoming"))[:5]
    awaiting = [f for f in await fx.mine(user, "awaiting") if f.actions][:5]
    challenges = (await ChallengeService(c).list(user, "all", "active", None))[:5]

    activity: list[CommunityActivity] = []
    mems = [
        m["community_id"] async for m in c.mongo["community_members"].find({"user_id": user.id, "status": "active"})
    ]
    if mems:
        cs = CommunityService(c)
        names = {x["_id"]: x["name"] async for x in c.mongo["communities"].find({"_id": {"$in": mems}})}
        posts = [
            p
            async for p in c.mongo["community_posts"]
            .find({"community_id": {"$in": mems}, "removed": False})
            .sort("_id", -1)
            .limit(5)
        ]
        for p in posts:
            me = await c.mongo["community_members"].find_one({"community_id": p["community_id"], "user_id": user.id})
            out = await cs._post_out([p], user, me)  # noqa: SLF001
            if out:
                activity.append(
                    CommunityActivity(
                        community_id=str(p["community_id"]),
                        community_name=names.get(p["community_id"], ""),
                        post=out[0],
                    )
                )

    return HomeOut(
        greeting_name=user.full_name.split(" ")[0] if user.full_name else "there",
        city=user.doc.get("city"),
        locality=prof.get("locality"),
        has_location=at is not None,
        rating=player_rating_brief(rating),
        verified_matches=(rating or {}).get("matches", 0),
        rank_city=await lb.city_rank(user.id, user.doc.get("city")),
        rank_10km=rank_10,
        rank_10km_total=total_10,
        upcoming=upcoming,
        awaiting_result=awaiting,
        nearby_top_players=nearby,
        active_challenges=challenges,
        teams_looking=teams_looking,
        community_activity=activity,
        spotlight=await _spotlight(c, user, at),
        managed_team_ids=[str(t) for t in await _managed(c, user)],
    )


async def _managed(c: Container, user: CurrentUser) -> list[Any]:
    return sorted(await managed_team_ids(c, user.id))


SPOTLIGHT_CANDIDATES = 5000


async def _spotlight(c: Container, user: CurrentUser, at: GeoPointIn | None) -> SpotlightOut | None:
    """Player of the Week: biggest verified rating gain in the last 7 days, within 50 km
    (or the player's city). None when nobody qualifies — never invented."""
    if at:
        pipe: list[dict[str, Any]] = [
            {
                "$geoNear": {
                    "near": {"type": "Point", "coordinates": [at.lng, at.lat]},
                    "distanceField": "d",
                    "maxDistance": 50_000,
                    "spherical": True,
                }
            },
            {"$limit": SPOTLIGHT_CANDIDATES},  # nearest first; keeps Home fast in dense cities
            {"$project": {"user_id": 1}},
        ]
        ids = [p["user_id"] async for p in await c.mongo["player_profiles"].aggregate(pipe)]
    elif user.doc.get("city"):
        ids = [
            u["_id"]
            async for u in c.mongo["users"].find({"city": user.doc["city"]}, {"_id": 1}).limit(SPOTLIGHT_CANDIDATES)
        ]
    else:
        return None
    since = utcnow() - timedelta(days=7)
    pipe2: list[dict[str, Any]] = [
        {"$match": {"user_id": {"$in": ids}, "at": {"$gte": since}}},
        {
            "$group": {
                "_id": "$user_id",
                "gain": {"$sum": {"$subtract": ["$after.overall", "$before.overall"]}},
                "n": {"$sum": 1},
                "demo": {"$max": "$is_demo"},
            }
        },
        {"$match": {"gain": {"$gt": 0}}},
        {"$sort": {"gain": -1}},
        {"$limit": 1},
    ]
    best = [g async for g in await c.mongo["player_rating_history"].aggregate(pipe2)]
    if not best:
        return None
    g = best[0]
    u = await c.mongo["users"].find_one({"_id": g["_id"]})
    if not u:
        return None
    prof = await c.mongo["player_profiles"].find_one({"user_id": g["_id"]}) or {}
    last = await c.mongo["player_rating_history"].find_one({"user_id": g["_id"]}, sort=[("at", -1)])
    headline = (last.get("reasons") or ["Strong verified performances this week"])[0] if last else ""
    return SpotlightOut(
        user=public_user(u),
        locality=prof.get("locality"),
        gain=round(g["gain"], 1),
        matches=g["n"],
        headline=headline,
        is_demo=bool(g.get("demo")),
    )
