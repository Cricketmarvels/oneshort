from datetime import datetime
from typing import Any

from bson import ObjectId
from pydantic import BaseModel

from app.api.dependencies import CurrentUser
from app.common.enums import Role
from app.common.types import StrictModel, utcnow
from app.common.validators import LongText
from app.core.container import Container
from app.core.exceptions import NotFound


class CaptainProfileIn(StrictModel):
    bio: LongText | None = None


class TeamSummary(BaseModel):
    id: str
    team_name: str
    logo: str | None
    category: str
    area: str | None
    city: str | None
    member_count: int


class CaptainOut(BaseModel):
    user_id: str
    full_name: str
    profile_image: str | None
    city: str | None
    bio: str | None
    average_rating: float | None
    rating_count: int
    rating_breakdown: dict[str, float]
    matches_captained: int
    teams: list[TeamSummary]
    member_since: datetime


def team_summary(t: dict[str, Any]) -> TeamSummary:
    return TeamSummary(
        id=str(t["_id"]),
        team_name=t["team_name"],
        logo=t.get("logo"),
        category=t["category"],
        area=t.get("area"),
        city=t.get("city"),
        member_count=t.get("member_count", 0),
    )


class CaptainService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["captain_profiles"]

    async def ensure_profile(self, user_id: ObjectId) -> None:
        """Idempotently create a captain profile and grant the captain role."""
        now = utcnow()
        await self.col.update_one(
            {"user_id": user_id},
            {
                "$setOnInsert": {
                    "user_id": user_id,
                    "bio": None,
                    "average_rating": None,
                    "rating_count": 0,
                    "rating_breakdown": {},
                    "matches_captained": 0,
                    "created_at": now,
                    "updated_at": now,
                }
            },
            upsert=True,
        )
        await self.c.mongo["users"].update_one({"_id": user_id}, {"$addToSet": {"roles": Role.CAPTAIN.value}})

    async def upsert_me(self, user: CurrentUser, data: CaptainProfileIn) -> CaptainOut:
        await self.ensure_profile(user.id)
        await self.col.update_one({"user_id": user.id}, {"$set": {"bio": data.bio, "updated_at": utcnow()}})
        return await self.get(user.id)

    async def get(self, user_id: ObjectId) -> CaptainOut:
        prof = await self.col.find_one({"user_id": user_id})
        user = await self.c.mongo["users"].find_one({"_id": user_id, "account_status": {"$ne": "deleted"}})
        if not prof or not user:
            raise NotFound("Captain profile not found", code="CAPTAIN_PROFILE_MISSING")
        teams = [
            team_summary(t)
            async for t in self.c.mongo["teams"]
            .find({"captain_id": user_id, "team_status": "active"})
            .sort("created_at", -1)
        ]
        return CaptainOut(
            user_id=str(user_id),
            full_name=user["full_name"],
            profile_image=user.get("profile_image"),
            city=user.get("city"),
            bio=prof.get("bio"),
            average_rating=prof.get("average_rating"),
            rating_count=prof.get("rating_count", 0),
            rating_breakdown=prof.get("rating_breakdown") or {},
            matches_captained=prof.get("matches_captained", 0),
            teams=teams,
            member_since=user["created_at"],
        )
