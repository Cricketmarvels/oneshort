"""Builds and maintains the ``search_index`` collection: one small, denormalised document per searchable
entity (player, team, ground), so a search never joins or scans the source collections.

Document shape::

    _id        "player:<ObjectId>" | "team:<ObjectId>" | "ground:<ObjectId>"
    type       player | team | ground
    entity_id  ObjectId of the source document
    name       display name                      name_norm   normalised name
    tokens     edge n-grams of name (+ area/city words)      phonetic    Soundex keys of the name words
    area, city subtitle fields                   loc         GeoJSON point (rounded to ~100 m for players)
    boost      static popularity score (log scale)          image       private media key (signed on output)
    meta       type-specific public facts (role, verified matches, CricHeroes flag/link, member count, address)
    updated_at

Kept in sync two ways: services call ``index_*`` right after a write (write-through), and the scheduler
calls ``sync_recent`` every minute as a safety net for anything that bypassed a service. ``reindex_all``
rebuilds from scratch (startup when empty, or scripts/reindex_search.py).
"""

import math
from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId

from app.common.types import utcnow
from app.infrastructure.database.mongo import Mongo
from app.modules.cricheroes.urls import safe_profile_url
from app.modules.search.cache import candidate_cache
from app.modules.search.text import edge_ngrams, normalise, phonetic

COLLECTION = "search_index"
_ACTIVE_ACCOUNTS = ("active", None)  # users without the field predate the status feature


def _round_point(loc: dict[str, Any] | None, places: int) -> dict[str, Any] | None:
    try:
        lng, lat = loc["coordinates"]  # type: ignore[index]
    except (KeyError, TypeError, ValueError):
        return None
    return {"type": "Point", "coordinates": [round(float(lng), places), round(float(lat), places)]}


class SearchIndexer:
    def __init__(self, mongo: Mongo) -> None:
        self.m = mongo
        self.col = mongo[COLLECTION]

    # ------------------------------------------------------------------ document builders
    def _base(self, kind: str, eid: ObjectId, name: str, area: str | None, city: str | None) -> dict[str, Any]:
        extra = " ".join(x for x in (area, city) if x)
        return {
            "_id": f"{kind}:{eid}",
            "type": kind,
            "entity_id": eid,
            "name": name,
            "name_norm": normalise(name),
            "tokens": edge_ngrams(f"{name} {extra}"),
            "phonetic": phonetic(name),
            "area": area,
            "city": city,
            "updated_at": utcnow(),
        }

    async def _player_doc(self, user: dict[str, Any]) -> dict[str, Any] | None:
        if user.get("account_status") not in _ACTIVE_ACCOUNTS or user.get("deleted_at"):
            return None
        if "player" not in (user.get("roles") or ["player"]):
            return None
        prof = await self.m["player_profiles"].find_one({"user_id": user["_id"]}) or {}
        rating = await self.m["player_ratings"].find_one({"user_id": user["_id"]}, {"matches": 1, "overall": 1}) or {}
        ch_url, _ = safe_profile_url(prof.get("cricheroes_url"), "player")
        matches = int(rating.get("matches") or 0)
        doc = self._base(
            "player", user["_id"], user.get("full_name") or "Player", prof.get("locality"), user.get("city")
        )
        doc.update(
            {
                "loc": _round_point(prof.get("home_location"), 3),  # ~100 m: enough for distance, not for a doorstep
                "image": user.get("profile_image"),
                "boost": math.log1p(matches) + (0.6 if ch_url else 0) + (0.3 if user.get("profile_image") else 0),
                "meta": {
                    "role": prof.get("primary_role"),
                    "verified_matches": matches,
                    "has_cricheroes": bool(ch_url),
                    "cricheroes_profile_url": ch_url,
                    "rating": (rating.get("overall") or {}).get("rating"),
                },
            }
        )
        return doc

    def _team_doc(self, team: dict[str, Any]) -> dict[str, Any] | None:
        if team.get("team_status") != "active":
            return None
        ch_url, _ = safe_profile_url(team.get("cricheroes_team_url"), "team")
        members = int(team.get("member_count") or 0)
        doc = self._base("team", team["_id"], team["team_name"], team.get("area"), team.get("city"))
        doc.update(
            {
                "loc": _round_point(team.get("location"), 4),
                "image": team.get("logo"),
                "boost": math.log1p(members) + (0.4 if ch_url else 0),
                "meta": {
                    "member_count": members,
                    "has_cricheroes": bool(ch_url),
                    "cricheroes_team_url": ch_url,
                    "category": team.get("category"),
                    "looking_for_opponents": bool(team.get("looking_for_opponents")),
                },
            }
        )
        return doc

    def _ground_doc(self, venue: dict[str, Any]) -> dict[str, Any]:
        doc = self._base("ground", venue["_id"], venue["name"], venue.get("area"), venue.get("city"))
        doc["tokens"] = edge_ngrams(f"{venue['name']} {venue.get('area') or ''} {venue.get('city') or ''}")
        doc.update(
            {
                "loc": _round_point(venue.get("location"), 6),
                "image": (venue.get("photos") or [None])[0],
                "boost": 0.5,
                "meta": {"address": venue.get("address")},
            }
        )
        return doc

    # ------------------------------------------------------------------ write-through API
    async def _put(self, kind: str, eid: ObjectId, doc: dict[str, Any] | None) -> None:
        candidate_cache.clear()
        if doc is None:
            await self.col.delete_one({"_id": f"{kind}:{eid}"})
        else:
            await self.col.replace_one({"_id": doc["_id"]}, doc, upsert=True)

    async def index_user(self, user_id: ObjectId) -> None:
        user = await self.m["users"].find_one({"_id": user_id})
        await self._put("player", user_id, await self._player_doc(user) if user else None)

    async def index_team(self, team_id: ObjectId) -> None:
        team = await self.m["teams"].find_one({"_id": team_id})
        await self._put("team", team_id, self._team_doc(team) if team else None)

    async def index_venue(self, venue_id: ObjectId) -> None:
        venue = await self.m["venues"].find_one({"_id": venue_id})
        await self._put("ground", venue_id, self._ground_doc(venue) if venue else None)

    async def remove(self, kind: str, eid: ObjectId) -> None:
        await self.col.delete_one({"_id": f"{kind}:{eid}"})

    # ------------------------------------------------------------------ bulk maintenance
    async def reindex_all(self) -> dict[str, int]:
        n = {"player": 0, "team": 0, "ground": 0}
        async for u in self.m["users"].find({}):
            await self._put("player", u["_id"], await self._player_doc(u))
            n["player"] += 1
        async for t in self.m["teams"].find({}):
            await self._put("team", t["_id"], self._team_doc(t))
            n["team"] += 1
        async for v in self.m["venues"].find({}):
            await self._put("ground", v["_id"], self._ground_doc(v))
            n["ground"] += 1
        # Drop entries whose source vanished (hard deletes).
        for kind, coll in (("player", "users"), ("team", "teams"), ("ground", "venues")):
            ids = [d["entity_id"] async for d in self.col.find({"type": kind}, {"entity_id": 1})]
            live = {d["_id"] async for d in self.m[coll].find({"_id": {"$in": ids}}, {"_id": 1})}
            gone = [f"{kind}:{i}" for i in ids if i not in live]
            if gone:
                await self.col.delete_many({"_id": {"$in": gone}})
        return n

    async def sync_recent(self, since: datetime) -> int:
        """Re-index anything updated after ``since`` (safety net behind write-through)."""
        count = 0
        user_ids: set[ObjectId] = set()
        async for u in self.m["users"].find({"updated_at": {"$gte": since}}, {"_id": 1}):
            user_ids.add(u["_id"])
        async for p in self.m["player_profiles"].find({"updated_at": {"$gte": since}}, {"user_id": 1}):
            user_ids.add(p["user_id"])
        async for r in self.m["player_ratings"].find({"updated_at": {"$gte": since}}, {"user_id": 1}):
            user_ids.add(r["user_id"])
        for uid in user_ids:
            await self.index_user(uid)
            count += 1
        async for t in self.m["teams"].find({"updated_at": {"$gte": since}}, {"_id": 1}):
            await self.index_team(t["_id"])
            count += 1
        return count

    async def ensure_populated(self) -> None:
        if await self.col.estimated_document_count() == 0:
            await self.reindex_all()


def sync_window(interval_seconds: int) -> datetime:
    return utcnow() - timedelta(seconds=max(interval_seconds * 3, 180))
