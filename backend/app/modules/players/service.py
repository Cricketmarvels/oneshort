from typing import Any

from bson import ObjectId

from app.api.dependencies import CurrentUser
from app.common.enums import Role
from app.common.types import GeoPointOut, utcnow
from app.core.container import Container
from app.core.exceptions import NotFound
from app.modules.players.schemas import PlayerProfileIn, PlayerPublicOut, PlayerSelfOut, PlayerStats

DEFAULT_RELIABILITY = 70.0


def stats_out(raw: dict[str, Any] | None) -> PlayerStats:
    raw = raw or {}
    received = raw.get("invitations_received", 0)
    responded = raw.get("invitations_responded", 0)
    return PlayerStats(
        matches_played=raw.get("matches_played", 0),
        attended=raw.get("attended", 0),
        no_shows=raw.get("no_shows", 0),
        late_withdrawals=raw.get("late_withdrawals", 0),
        invitations_received=received,
        invitations_responded=responded,
        response_rate=round(responded / received, 2) if received else None,
    )


class PlayerService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["player_profiles"]

    async def get_profile(self, user_id: ObjectId) -> dict[str, Any] | None:
        return await self.col.find_one({"user_id": user_id})

    async def upsert_me(self, user: CurrentUser, data: PlayerProfileIn) -> PlayerSelfOut:
        now = utcnow()
        fields = data.model_dump(mode="json", exclude={"home_location"})
        if data.home_location is not None:
            fields["home_location"] = data.home_location.to_geojson()
        fields["city"] = user.doc.get("city")
        fields["updated_at"] = now
        await self.col.update_one(
            {"user_id": user.id},
            {
                "$set": fields,
                "$setOnInsert": {
                    "user_id": user.id,
                    "stats": {},
                    "average_rating": None,
                    "rating_count": 0,
                    "rating_breakdown": {},
                    "reliability_score": DEFAULT_RELIABILITY,
                    "_lock": 0,
                    "created_at": now,
                },
            },
            upsert=True,
        )
        # Keep availability visibility in sync for discovery filtering.
        await self.c.mongo["availability"].update_many(
            {"player_id": user.id}, {"$set": {"visibility": data.availability_visibility.value}}
        )
        await self.c.mongo["users"].update_one({"_id": user.id}, {"$addToSet": {"roles": Role.PLAYER.value}})
        return await self.me(user)

    async def me(self, user: CurrentUser) -> PlayerSelfOut:
        prof = await self.get_profile(user.id)
        if not prof:
            raise NotFound("Player profile not created yet", code="PLAYER_PROFILE_MISSING")
        user_doc = await self.c.mongo["users"].find_one({"_id": user.id}) or user.doc
        public = self._public(prof, user_doc)
        missing = [
            name
            for name, present in (
                ("profile_image", bool(user_doc.get("profile_image"))),
                ("city", bool(user_doc.get("city"))),
                ("email", bool(user_doc.get("email"))),
                ("home_location", bool(prof.get("home_location"))),
            )
            if not present
        ]
        return PlayerSelfOut(
            **public.model_dump(),
            home_location=GeoPointOut.from_geojson(prof.get("home_location")),
            availability_visibility=prof.get("availability_visibility", "discoverable"),
            missing_fields=missing,
        )

    async def public(self, user_id: ObjectId) -> PlayerPublicOut:
        prof = await self.get_profile(user_id)
        user_doc = await self.c.mongo["users"].find_one({"_id": user_id, "account_status": {"$ne": "deleted"}})
        if not prof or not user_doc:
            raise NotFound("Player not found")
        return self._public(prof, user_doc)

    @staticmethod
    def _public(prof: dict[str, Any], user_doc: dict[str, Any]) -> PlayerPublicOut:
        return PlayerPublicOut(
            user_id=str(prof["user_id"]),
            full_name=user_doc.get("full_name", "Player"),
            profile_image=user_doc.get("profile_image"),
            city=user_doc.get("city"),
            primary_role=prof["primary_role"],
            secondary_roles=prof.get("secondary_roles", []),
            batting_style=prof.get("batting_style"),
            bowling_style=prof.get("bowling_style"),
            experience_years=prof.get("experience_years"),
            preferred_formats=prof.get("preferred_formats", []),
            preferred_days=prof.get("preferred_days", []),
            preferred_timing=prof.get("preferred_timing", []),
            cricheroes_url=prof.get("cricheroes_url"),
            previous_teams=prof.get("previous_teams", []),
            bio=prof.get("bio"),
            locality=prof.get("locality"),
            average_rating=prof.get("average_rating"),
            rating_count=prof.get("rating_count", 0),
            rating_breakdown=prof.get("rating_breakdown") or {},
            reliability_score=prof.get("reliability_score", DEFAULT_RELIABILITY),
            stats=stats_out(prof.get("stats")),
            member_since=user_doc["created_at"],
        )
