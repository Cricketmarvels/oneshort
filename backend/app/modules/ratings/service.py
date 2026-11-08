"""Verified, match-based two-way reputation (FR-REP-1..5).

Rules
- Only for COMPLETED matches, within ``rating_window_days`` of completion.
- Reviewer and reviewee must both be verified participants: the match captain, or a
  squad member who attended (present/late). Nobody rates themselves.
- Rating the match captain uses the captain categories; anyone else uses player categories.
- One review per (match, reviewer, reviewee): unique index, so retries cannot inflate scores.
- Aggregates are recomputed from visible ratings, so moderation (hide/restore) is exact.
"""

from datetime import datetime, timedelta
from typing import Any, Literal

from bson import ObjectId
from pydantic import BaseModel, Field, model_validator
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.enums import (
    CAPTAIN_RATING_CATEGORIES,
    PLAYER_RATING_CATEGORIES,
    Attendance,
    MatchStatus,
    NotificationType,
    RatingType,
)
from app.common.types import ObjectIdStr, StrictModel, ensure_utc, utcnow
from app.common.validators import ShortText
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, Forbidden, NotFound
from app.modules.matches.service import MatchAccess
from app.modules.players.reliability import recompute_player_stats
from app.modules.users.schemas import PublicUserOut, public_user


class RatingIn(StrictModel):
    reviewed_user_id: ObjectIdStr
    scores: dict[str, int] = Field(description="category → 1..5")
    comment: str | None = Field(default=None, max_length=500)

    @model_validator(mode="after")
    def _range(self) -> "RatingIn":
        if not self.scores:
            raise ValueError("at least one score is required")
        for k, v in self.scores.items():
            if not 1 <= v <= 5:
                raise ValueError(f"score for '{k}' must be between 1 and 5")
        return self


class RatingOut(BaseModel):
    id: str
    match_id: str
    match_title: str
    reviewer: PublicUserOut
    rating_type: RatingType
    scores: dict[str, int]
    overall: float
    comment: str | None
    status: str
    created_at: datetime


class ReputationOut(BaseModel):
    user: PublicUserOut
    rating_type: RatingType
    average_rating: float | None
    rating_count: int
    breakdown: dict[str, float]
    reliability_score: float | None
    matches_played: int | None
    recent: list[RatingOut]


class RateableOut(BaseModel):
    user: PublicUserOut
    rating_type: RatingType
    categories: list[str]
    already_rated: bool


class ModerateRatingIn(StrictModel):
    status: Literal["visible", "hidden"]
    reason: ShortText


VERIFIED_ATTENDANCE = (Attendance.PRESENT.value, Attendance.LATE.value)


class RatingService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["ratings"]
        self.access = MatchAccess(c)

    async def _participants(self, match: dict[str, Any]) -> set[ObjectId]:
        ids = {
            r["player_id"]
            async for r in self.c.mongo["match_rosters"].find(
                {"match_id": match["_id"], "is_active": True, "attendance": {"$in": list(VERIFIED_ATTENDANCE)}}
            )
        }
        ids.add(match["captain_id"])
        return ids

    async def _rateable_match(self, match_id: ObjectId) -> dict[str, Any]:
        match, _ = await self.access.load(match_id)
        if match["match_status"] != MatchStatus.COMPLETED:
            raise BusinessRuleViolation("Ratings open once the match is completed", code="MATCH_NOT_COMPLETED")
        done = ensure_utc(match.get("completed_at") or match["end_at"])
        if utcnow() > done + timedelta(days=self.c.settings.rating_window_days):
            raise BusinessRuleViolation("The rating window for this match has closed", code="RATING_WINDOW_CLOSED")
        return match

    async def rate(self, user: CurrentUser, match_id: ObjectId, data: RatingIn) -> RatingOut:
        match = await self._rateable_match(match_id)
        reviewed = ObjectId(data.reviewed_user_id)
        participants = await self._participants(match)
        if user.id not in participants:
            raise Forbidden("Only verified participants of this match can rate", code="NOT_VERIFIED_PARTICIPANT")
        if reviewed not in participants:
            raise BusinessRuleViolation("That user did not take part in this match", code="NOT_VERIFIED_PARTICIPANT")
        if reviewed == user.id:
            raise BusinessRuleViolation("You cannot rate yourself", code="SELF_RATING")
        rtype = RatingType.CAPTAIN if reviewed == match["captain_id"] else RatingType.PLAYER
        allowed = CAPTAIN_RATING_CATEGORIES if rtype == RatingType.CAPTAIN else PLAYER_RATING_CATEGORIES
        unknown = set(data.scores) - set(allowed)
        if unknown:
            raise BusinessRuleViolation(
                f"Unknown categories for a {rtype.value} rating: {sorted(unknown)}",
                code="INVALID_CATEGORIES",
                details=[{"allowed": list(allowed)}],
            )
        if "overall" not in data.scores:
            raise BusinessRuleViolation("An 'overall' score is required", code="INVALID_CATEGORIES")
        now = utcnow()
        doc = {
            "match_id": match_id,
            "team_id": match["team_id"],
            "reviewer_id": user.id,
            "reviewed_user_id": reviewed,
            "rating_type": rtype.value,
            "scores": data.scores,
            "overall": float(data.scores["overall"]),
            "comment": data.comment,
            "status": "visible",
            "created_at": now,
        }
        try:
            res = await self.col.insert_one(doc)
        except DuplicateKeyError as exc:
            raise Conflict("You have already rated this person for this match", code="DUPLICATE_RATING") from exc
        await self.recompute(reviewed, rtype)
        if rtype == RatingType.CAPTAIN:
            await self._recompute_team(match["team_id"])
        await self.c.audit.log(
            actor_id=user.id,
            action="rating.created",
            entity_type="rating",
            entity_id=res.inserted_id,
            new_value={"reviewed": reviewed, "type": rtype.value},
            request_id=user.request_id,
        )
        await self.c.notifications.notify(
            [reviewed],
            NotificationType.RATING_RECEIVED,
            "You received a rating",
            f"New {rtype.value} rating for {match.get('title', 'a match')}.",
            {"match_id": match_id},
        )
        return await self._out({**doc, "_id": res.inserted_id})

    async def recompute(self, user_id: ObjectId, rtype: RatingType) -> None:
        cats = CAPTAIN_RATING_CATEGORIES if rtype == RatingType.CAPTAIN else PLAYER_RATING_CATEGORIES
        group: dict[str, Any] = {"_id": None, "n": {"$sum": 1}, "overall": {"$avg": "$overall"}}
        group.update({c: {"$avg": f"$scores.{c}"} for c in cats})
        agg: dict[str, Any] = {}
        async for a in await self.col.aggregate(
            [
                {"$match": {"reviewed_user_id": user_id, "rating_type": rtype.value, "status": "visible"}},
                {"$group": group},
            ]
        ):
            agg = a
        fields = {
            "average_rating": round(agg["overall"], 2) if agg.get("overall") is not None else None,
            "rating_count": agg.get("n", 0),
            "rating_breakdown": {c: round(agg[c], 2) for c in cats if agg.get(c) is not None},
        }
        col = "captain_profiles" if rtype == RatingType.CAPTAIN else "player_profiles"
        await self.c.mongo[col].update_one({"user_id": user_id}, {"$set": fields})
        if rtype == RatingType.PLAYER:
            await recompute_player_stats(self.c.mongo, [user_id])

    async def _recompute_team(self, team_id: ObjectId) -> None:
        avg = None
        async for a in await self.col.aggregate(
            [
                {"$match": {"team_id": team_id, "rating_type": "captain", "status": "visible"}},
                {"$group": {"_id": None, "avg": {"$avg": "$overall"}}},
            ]
        ):
            avg = round(a["avg"], 2)
        await self.c.mongo["teams"].update_one({"_id": team_id}, {"$set": {"average_rating": avg}})

    async def _out(
        self, r: dict[str, Any], users: dict[ObjectId, Any] | None = None, matches: dict[ObjectId, Any] | None = None
    ) -> RatingOut:
        reviewer = (
            (users or {}).get(r["reviewer_id"])
            or await self.c.mongo["users"].find_one({"_id": r["reviewer_id"]})
            or {"_id": r["reviewer_id"], "full_name": "Player"}
        )
        match = (
            (matches or {}).get(r["match_id"])
            or await self.c.mongo["matches"].find_one({"_id": r["match_id"]}, {"title": 1})
            or {}
        )
        return RatingOut(
            id=str(r["_id"]),
            match_id=str(r["match_id"]),
            match_title=match.get("title", "Match"),
            reviewer=public_user(reviewer),
            rating_type=r["rating_type"],
            scores=r["scores"],
            overall=r["overall"],
            comment=r.get("comment"),
            status=r["status"],
            created_at=r["created_at"],
        )

    async def reputation(self, user_id: ObjectId, rtype: RatingType) -> ReputationOut:
        u = await self.c.mongo["users"].find_one({"_id": user_id, "account_status": {"$ne": "deleted"}})
        if not u:
            raise NotFound("User not found")
        col = "captain_profiles" if rtype == RatingType.CAPTAIN else "player_profiles"
        prof = await self.c.mongo[col].find_one({"user_id": user_id}) or {}
        rows = [
            r
            async for r in self.col.find({"reviewed_user_id": user_id, "rating_type": rtype.value, "status": "visible"})
            .sort("created_at", -1)
            .limit(20)
        ]
        users = {
            x["_id"]: x async for x in self.c.mongo["users"].find({"_id": {"$in": [r["reviewer_id"] for r in rows]}})
        }
        matches = {
            x["_id"]: x
            async for x in self.c.mongo["matches"].find({"_id": {"$in": [r["match_id"] for r in rows]}}, {"title": 1})
        }
        return ReputationOut(
            user=public_user(u),
            rating_type=rtype,
            average_rating=prof.get("average_rating"),
            rating_count=prof.get("rating_count", 0),
            breakdown=prof.get("rating_breakdown") or {},
            reliability_score=prof.get("reliability_score") if rtype == RatingType.PLAYER else None,
            matches_played=(prof.get("stats") or {}).get("matches_played")
            if rtype == RatingType.PLAYER
            else prof.get("matches_captained"),
            recent=[await self._out(r, users, matches) for r in rows],
        )

    async def rateable(self, user: CurrentUser, match_id: ObjectId) -> list[RateableOut]:
        match = await self._rateable_match(match_id)
        participants = await self._participants(match)
        if user.id not in participants:
            raise Forbidden("Only verified participants of this match can rate", code="NOT_VERIFIED_PARTICIPANT")
        done = {r["reviewed_user_id"] async for r in self.col.find({"match_id": match_id, "reviewer_id": user.id})}
        users = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": list(participants)}})}
        out = []
        for pid in participants:
            if pid == user.id or pid not in users:
                continue
            is_cap = pid == match["captain_id"]
            out.append(
                RateableOut(
                    user=public_user(users[pid]),
                    rating_type=RatingType.CAPTAIN if is_cap else RatingType.PLAYER,
                    categories=list(CAPTAIN_RATING_CATEGORIES if is_cap else PLAYER_RATING_CATEGORIES),
                    already_rated=pid in done,
                )
            )
        out.sort(key=lambda x: (x.rating_type != RatingType.CAPTAIN, x.already_rated, x.user.full_name))
        return out

    async def moderate(self, admin: CurrentUser, rating_id: ObjectId, data: ModerateRatingIn) -> RatingOut:
        r = await self.col.find_one_and_update(
            {"_id": rating_id},
            {"$set": {"status": data.status, "moderation": {"by": admin.id, "at": utcnow(), "reason": data.reason}}},
        )
        if not r:
            raise NotFound("Rating not found")
        await self.recompute(r["reviewed_user_id"], RatingType(r["rating_type"]))
        if r["rating_type"] == RatingType.CAPTAIN:
            await self._recompute_team(r["team_id"])
        await self.c.audit.log(
            actor_id=admin.id,
            action=f"rating.{data.status}",
            entity_type="rating",
            entity_id=rating_id,
            previous_value={"status": r["status"]},
            new_value={"status": data.status, "reason": data.reason},
            request_id=admin.request_id,
        )
        updated = await self.col.find_one({"_id": rating_id})
        assert updated is not None
        return await self._out(updated)
