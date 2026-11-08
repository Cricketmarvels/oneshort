"""Helpers shared by challenges, fixtures, ratings and leaderboards."""

from collections.abc import Iterable
from typing import Any

from bson import ObjectId

from app.common.enums import FixtureFormat
from app.core.container import Container
from app.modules.competition.schemas import ProposalOut, RatingBrief, TeamCard, VenueOut
from app.modules.rating_engine.composite import confidence_from_rd
from app.modules.rating_engine.config import FORMATS, PROVISIONAL_MIN_MATCHES

TEAM_PROVISIONAL_MIN = 5
TEAM_PROVISIONAL_MAX_RD = 160.0


def overs_for(fmt: str, overs: int | None) -> int:
    default = FORMATS.get(fmt)
    return int(overs or default or 20)


def team_rating_brief(r: dict[str, Any] | None) -> RatingBrief | None:
    if not r or not r.get("played"):
        return None
    rd = r["rd"]
    return RatingBrief(
        rating=round(r["rating"], 1),
        rd=round(rd, 1),
        confidence=confidence_from_rd(rd),
        provisional=r["played"] < TEAM_PROVISIONAL_MIN or rd > TEAM_PROVISIONAL_MAX_RD,
    )


def player_rating_brief(r: dict[str, Any] | None) -> RatingBrief | None:
    if not r or not r.get("matches"):
        return None
    o = r["overall"]
    return RatingBrief(
        rating=o["rating"],
        rd=o["rd"],
        confidence=o["confidence"],
        provisional=r["matches"] < PROVISIONAL_MIN_MATCHES or o["provisional"],
    )


def to_team_brief(team: dict[str, Any], rating: dict[str, Any] | None) -> TeamCard:
    return TeamCard(
        id=str(team["_id"]),
        team_name=team["team_name"],
        logo=team.get("logo"),
        cover_image=team.get("cover_image"),
        area=team.get("area"),
        city=team.get("city"),
        rating=team_rating_brief(rating),
        matches=int((rating or {}).get("played", 0)),
    )


async def team_briefs(c: Container, ids: Iterable[ObjectId]) -> dict[ObjectId, TeamCard]:
    ids = list(set(ids))
    teams = {t["_id"]: t async for t in c.mongo["teams"].find({"_id": {"$in": ids}})}
    ratings = {r["team_id"]: r async for r in c.mongo["team_ratings"].find({"team_id": {"$in": ids}})}
    return {tid: to_team_brief(t, ratings.get(tid)) for tid, t in teams.items()}


async def managed_team_ids(c: Container, user_id: ObjectId) -> set[ObjectId]:
    cur = c.mongo["teams"].find(
        {"team_status": "active", "$or": [{"captain_id": user_id}, {"admin_ids": user_id}]}, {"_id": 1}
    )
    return {t["_id"] async for t in cur}


async def member_team_ids(c: Container, user_id: ObjectId) -> set[ObjectId]:
    cur = c.mongo["team_members"].find({"user_id": user_id, "status": "active"}, {"team_id": 1})
    return {m["team_id"] async for m in cur}


async def team_manager_ids(c: Container, team_ids: Iterable[ObjectId]) -> list[ObjectId]:
    out: list[ObjectId] = []
    async for t in c.mongo["teams"].find({"_id": {"$in": list(team_ids)}}, {"captain_id": 1, "admin_ids": 1}):
        out.append(t["captain_id"])
        out.extend(t.get("admin_ids") or [])
    return list(dict.fromkeys(out))


def proposal_out(p: dict[str, Any]) -> ProposalOut:
    v = p.get("venue") or {}
    return ProposalOut(
        start_at=p["start_at"],
        venue=VenueOut(name=v.get("name", ""), area=v.get("area"), city=v.get("city")),
        format=FixtureFormat(p["format"]),
        overs=p["overs"],
        conditions=p.get("conditions"),
    )


def provisional_matches() -> int:
    return PROVISIONAL_MIN_MATCHES
