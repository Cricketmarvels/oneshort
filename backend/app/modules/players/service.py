from typing import Any

from bson import ObjectId

from app.api.dependencies import CurrentUser
from app.common.enums import Role
from app.common.types import GeoPointOut, utcnow
from app.core.container import Container
from app.core.exceptions import NotFound
from app.modules.cricheroes.urls import safe_profile_url
from app.modules.players.schemas import (
    CricHeroesIn,
    CricHeroesStatsOut,
    PlayerProfileIn,
    PlayerPublicOut,
    PlayerSelfOut,
    PlayerStats,
)
from app.modules.search.indexer import SearchIndexer

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


def cricheroes_stats_out(raw: dict[str, Any] | None) -> CricHeroesStatsOut | None:
    """Stored self-reported CricHeroes numbers for display (None when the player added none)."""
    return CricHeroesStatsOut(**raw) if raw else None


class PlayerService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["player_profiles"]

    async def get_profile(self, user_id: ObjectId) -> dict[str, Any] | None:
        return await self.col.find_one({"user_id": user_id})

    async def upsert_me(self, user: CurrentUser, data: PlayerProfileIn) -> PlayerSelfOut:
        out = await self._upsert_me(user, data)
        await SearchIndexer(self.c.mongo).index_user(user.id)
        return out

    async def _upsert_me(self, user: CurrentUser, data: PlayerProfileIn) -> PlayerSelfOut:
        now = utcnow()
        fields = data.model_dump(mode="json", exclude={"home_location", "cricheroes_url", "cricheroes_profile_url"})
        # CricHeroes link: only touched when sent (omit = keep, null = remove), so other edits never wipe it.
        sent = data.model_fields_set
        if "cricheroes_profile_url" in sent or "cricheroes_url" in sent:
            link = data.cricheroes_profile_url if "cricheroes_profile_url" in sent else data.cricheroes_url
            fields["cricheroes_url"], fields["cricheroes_player_id"] = safe_profile_url(link, "player")
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

    async def update_cricheroes(self, user: CurrentUser, data: CricHeroesIn) -> PlayerSelfOut:
        out = await self._update_cricheroes(user, data)
        await SearchIndexer(self.c.mongo).index_user(user.id)
        return out

    async def _update_cricheroes(self, user: CurrentUser, data: CricHeroesIn) -> PlayerSelfOut:
        """Link and self-reported stats only; the rest of the profile is untouched."""
        if not await self.col.find_one({"user_id": user.id}, {"_id": 1}):
            raise NotFound("Create your player profile first", code="PLAYER_PROFILE_REQUIRED")
        sent = data.model_fields_set
        now = utcnow()
        set_: dict[str, Any] = {"updated_at": now}
        unset: dict[str, str] = {}
        if "profile_url" in sent:
            set_["cricheroes_url"], set_["cricheroes_player_id"] = safe_profile_url(data.profile_url, "player")
        if "stats" in sent:
            if data.stats is None or data.stats.is_empty():
                unset["cricheroes_stats"] = ""
            else:
                set_["cricheroes_stats"] = {**data.stats.model_dump(exclude_none=True), "updated_at": now}
        await self.col.update_one({"user_id": user.id}, {"$set": set_, **({"$unset": unset} if unset else {})})
        await self.c.audit.log(
            actor_id=user.id,
            action="player.cricheroes_updated",
            entity_type="user",
            entity_id=user.id,
            new_value={"fields": sorted(sent)},
            request_id=user.request_id,
        )
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
        ch_url, ch_id = safe_profile_url(
            prof.get("cricheroes_url"), "player"
        )  # legacy values must pass the strict rules
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
            cricheroes_url=ch_url,
            cricheroes_profile_url=ch_url,
            cricheroes_player_id=ch_id,
            cricheroes_stats=cricheroes_stats_out(prof.get("cricheroes_stats")),
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
