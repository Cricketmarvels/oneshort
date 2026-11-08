"""Link a team to its CricHeroes profile and store imported CricHeroes team data.

One document per team in ``cricheroes_teams``:
    {team_id, link: {external_team_id, slug, url, linked_at, linked_by},
     snapshot: {team_name, team_logo, players, matches, stats, leaderboard, method, imported_at, imported_by},
     updated_at}

Anyone signed in can view it (CricHeroes team pages are public). Only the team captain or
team admins can link, import, sync or remove it. Every change is audited (counts only).
"""

import re
from datetime import date, datetime
from typing import Any, Literal

from bson import ObjectId

from app.api.dependencies import CurrentUser
from app.common.types import utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, NotFound, ValidationFailed
from app.modules.cricheroes.schemas import (
    CricHeroesLeaderboardOut,
    CricHeroesLeaderOut,
    CricHeroesLinkOut,
    CricHeroesMatchOut,
    CricHeroesPlayerOut,
    CricHeroesProfileOut,
    CricHeroesSnapshotIn,
    CricHeroesSnapshotOut,
    CricHeroesStatOut,
)
from app.modules.cricheroes.urls import parse_team_ref, safe_cricheroes_url, safe_profile_url
from app.modules.teams.policy import can_manage_team, ensure_team_manager
from app.modules.teams.service import TeamService
from app.modules.users.schemas import public_user

_DATE_FORMATS = ("%d-%b-%y", "%d-%b-%Y", "%Y-%m-%d", "%d %b %Y", "%d %B %Y", "%d/%m/%Y")


def parse_match_date(raw: str | None) -> date | None:
    if not raw:
        return None
    value = raw.strip()
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(value, fmt).date()
        except ValueError:
            continue
    return None


def _norm_name(name: str) -> str:
    return re.sub(r"\s+", " ", name).strip().casefold()


def normalise_snapshot(data: CricHeroesSnapshotIn) -> dict[str, Any]:
    """Convert validated input into the stored shape: links sanitised, dates parsed, empties dropped."""
    snap: dict[str, Any] = {
        "team_name": data.team_name or None,
        "team_logo": safe_cricheroes_url(data.team_logo, media=True),
        "players": [
            {"name": p.name, "role": p.sub_title or None, "profile_url": safe_cricheroes_url(p.profile_url)}
            for p in data.players
        ],
        "matches": [
            {
                "tournament": m.tournament or None,
                "info": m.info or None,
                "score": [s for s in m.score if s],
                "result": m.result or None,
                "url": safe_cricheroes_url(m.url),
                "played_on": (d.isoformat() if (d := parse_match_date(m.date)) else None),
                "venue": m.venue or None,
            }
            for m in data.matches
        ],
        "stats": [{"label": s.label, "value": s.value} for s in data.stats],
        "leaderboard": {
            k: [{"player_name": e.player_name, "stat": e.stat} for e in getattr(data.leaderboard, k)]
            for k in ("batting", "bowling", "fielding")
        },
    }
    if not (snap["players"] or snap["matches"] or snap["stats"] or any(snap["leaderboard"].values())):
        raise ValidationFailed(
            "Nothing to import. Add at least one player, match, stat or leaderboard entry.",
            code="CRICHEROES_EMPTY_IMPORT",
        )
    return snap


def _counts(snap: dict[str, Any]) -> dict[str, int]:
    return {
        "players": len(snap["players"]),
        "matches": len(snap["matches"]),
        "stats": len(snap["stats"]),
        "leaderboard": sum(len(v) for v in snap["leaderboard"].values()),
    }


class CricHeroesService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["cricheroes_teams"]
        self.teams = TeamService(c)

    async def get(self, user: CurrentUser, team_id: ObjectId) -> CricHeroesProfileOut:
        team = await self.teams.get_team(team_id)
        doc = await self.col.find_one({"team_id": team_id}) or {}
        return await self._out(team, doc, user)

    async def link(self, user: CurrentUser, team_id: ObjectId, url: str) -> CricHeroesProfileOut:
        team = await self.teams.get_team(team_id)
        ensure_team_manager(team, user.id)
        ref = parse_team_ref(url)
        link = {
            "external_team_id": ref.external_team_id,
            "slug": ref.slug,
            "url": ref.url,
            "linked_at": utcnow(),
            "linked_by": user.id,
        }
        prev = await self.col.find_one_and_update(
            {"team_id": team_id},
            {"$set": {"link": link, "updated_at": utcnow()}, "$setOnInsert": {"team_id": team_id}},
            upsert=True,
        )
        team_url, team_ext = safe_profile_url(ref.url, "team")
        if team_url:  # keep the team record's CricHeroes link in step with this older endpoint
            await self.c.mongo["teams"].update_one(
                {"_id": team_id}, {"$set": {"cricheroes_team_url": team_url, "cricheroes_team_id": team_ext}}
            )
        await self.c.audit.log(
            actor_id=user.id,
            action="cricheroes.link",
            entity_type="team",
            entity_id=team_id,
            previous_value=(prev or {}).get("link", {}).get("url"),
            new_value=ref.url,
        )
        return await self.get(user, team_id)

    async def import_snapshot(
        self,
        user: CurrentUser,
        team_id: ObjectId,
        data: CricHeroesSnapshotIn,
        method: Literal["file", "manual", "sync"],
    ) -> CricHeroesProfileOut:
        team = await self.teams.get_team(team_id)
        ensure_team_manager(team, user.id)
        snap = normalise_snapshot(data)
        snap |= {"method": method, "imported_at": utcnow(), "imported_by": user.id}
        await self.col.update_one(
            {"team_id": team_id},
            {"$set": {"snapshot": snap, "updated_at": utcnow()}, "$setOnInsert": {"team_id": team_id}},
            upsert=True,
        )
        await self.c.audit.log(
            actor_id=user.id,
            action=f"cricheroes.import.{method}",
            entity_type="team",
            entity_id=team_id,
            new_value=_counts(snap),
        )
        return await self.get(user, team_id)

    async def sync(self, user: CurrentUser, team_id: ObjectId) -> CricHeroesProfileOut:
        team = await self.teams.get_team(team_id)
        ensure_team_manager(team, user.id)
        doc = await self.col.find_one({"team_id": team_id})
        link = (doc or {}).get("link")
        if not link:
            raise BusinessRuleViolation("Link your CricHeroes team first", code="CRICHEROES_NOT_LINKED")
        raw = await self.c.cricheroes.fetch_team(link["external_team_id"], link["slug"])
        return await self.import_snapshot(user, team_id, CricHeroesSnapshotIn.model_validate(raw), "sync")

    async def remove(self, user: CurrentUser, team_id: ObjectId) -> None:
        team = await self.teams.get_team(team_id)
        ensure_team_manager(team, user.id)
        res = await self.col.delete_one({"team_id": team_id})
        if res.deleted_count == 0:
            raise NotFound("No CricHeroes data for this team")
        await self.c.audit.log(actor_id=user.id, action="cricheroes.remove", entity_type="team", entity_id=team_id)

    # ---- helpers -----------------------------------------------------------

    async def _member_names(self, team_id: ObjectId) -> dict[str, str]:
        """Map normalised full name -> user id for active members, skipping ambiguous (duplicate) names."""
        ids = [m["user_id"] async for m in self.c.mongo["team_members"].find({"team_id": team_id, "status": "active"})]
        names: dict[str, str] = {}
        dupes: set[str] = set()
        async for u in self.c.mongo["users"].find({"_id": {"$in": ids}}, {"full_name": 1}):
            key = _norm_name(u.get("full_name") or "")
            if not key:
                continue
            if key in names:
                dupes.add(key)
            names[key] = str(u["_id"])
        return {k: v for k, v in names.items() if k not in dupes}

    async def _out(self, team: dict[str, Any], doc: dict[str, Any], user: CurrentUser) -> CricHeroesProfileOut:
        link = doc.get("link")
        snap = doc.get("snapshot")
        snapshot_out = None
        if snap:
            members = await self._member_names(team["_id"]) if snap["players"] else {}
            importer = await self.c.mongo["users"].find_one({"_id": snap.get("imported_by")})
            snapshot_out = CricHeroesSnapshotOut(
                team_name=snap.get("team_name"),
                team_logo=snap.get("team_logo"),
                players=[
                    CricHeroesPlayerOut(**p, member_user_id=members.get(_norm_name(p["name"]))) for p in snap["players"]
                ],
                matches=[
                    CricHeroesMatchOut(
                        **{k: v for k, v in m.items() if k != "played_on"},
                        played_on=date.fromisoformat(m["played_on"]) if m.get("played_on") else None,
                    )
                    for m in snap["matches"]
                ],
                stats=[CricHeroesStatOut(**s) for s in snap["stats"]],
                leaderboard=CricHeroesLeaderboardOut(
                    **{
                        k: [CricHeroesLeaderOut(**e) for e in snap["leaderboard"].get(k, [])]
                        for k in ("batting", "bowling", "fielding")
                    }
                ),
                method=snap["method"],
                imported_at=snap["imported_at"],
                imported_by=public_user(importer) if importer else None,
            )
        source = self.c.cricheroes
        return CricHeroesProfileOut(
            team_id=str(team["_id"]),
            link=CricHeroesLinkOut(
                external_team_id=link["external_team_id"], url=link["url"], linked_at=link["linked_at"]
            )
            if link
            else None,
            snapshot=snapshot_out,
            can_manage=can_manage_team(team, user.id),
            auto_sync_available=source.available,
            auto_sync_note=source.unavailable_reason,
        )
