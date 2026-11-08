"""Fee ledgers: what a match fee is split over.

A ledger id is either
  * a pickup match id (``matches``): squad = ``match_rosters``, managers = match captain/team admins
  * a team-vs-team fee side id (``fee_sides``): one per (fixture, team). Squad = ``fee_squads``,
    picked by that team's captain/vice-captain; managers = that team's captain/vice-captains.

``FeeAccess`` gives settlements and payments one interface for both, so expenses, splitting,
publishing and paid tracking reuse exactly the same code and audit trail.
"""

from typing import Any, Literal

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.dependencies import CurrentUser
from app.common.enums import FixtureStatus, MatchStatus
from app.core.exceptions import NotFound
from app.modules.matches.service import MatchAccess
from app.modules.teams.policy import can_manage_team, ensure_match_manager


def is_side(match: dict[str, Any]) -> bool:
    return bool(match.get("is_fee_side"))


class FeeAccess(MatchAccess):
    async def _side(self, ledger_id: ObjectId, session: AsyncClientSession | None = None) -> dict[str, Any] | None:
        side = await self.c.mongo["fee_sides"].find_one({"_id": ledger_id}, session=session)
        if not side:
            return None
        fx = await self.c.mongo["fixtures"].find_one({"_id": side["fixture_id"]}, session=session) or {}
        return {
            "_id": side["_id"],
            "is_fee_side": True,
            "fixture_id": side["fixture_id"],
            "team_id": side["team_id"],
            "captain_id": side["captain_id"],
            "title": side["title"],
            "start_at": fx.get("start_at", side.get("start_at")),
            "match_status": MatchStatus.CANCELLED.value
            if fx.get("status") == FixtureStatus.CANCELLED
            else MatchStatus.SCHEDULED.value,
        }

    async def load(
        self, match_id: ObjectId, session: AsyncClientSession | None = None
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        match = await self.matches.find_one({"_id": match_id}, session=session) or await self._side(match_id, session)
        if not match:
            raise NotFound("Match not found")
        team = await self.c.mongo["teams"].find_one({"_id": match["team_id"]}, session=session)
        if is_side(match) and team:
            match["captain_id"] = team["captain_id"]  # follows captaincy, not the snapshot
        return match, team

    async def load_managed(self, match_id: ObjectId, user: CurrentUser) -> tuple[dict[str, Any], dict[str, Any] | None]:
        match, team = await self.load(match_id)
        ensure_match_manager(match, team, user.id)
        return match, team

    async def relation(
        self, match: dict[str, Any], team: dict[str, Any] | None, user_id: ObjectId
    ) -> tuple[Literal["manager", "roster", "invitee", "public"], dict[str, Any] | None]:
        if not is_side(match):
            return await super().relation(match, team, user_id)
        if team and can_manage_team(team, user_id):
            return "manager", None
        seat = await self.c.mongo["fee_squads"].find_one(
            {"match_id": match["_id"], "player_id": user_id, "is_active": True}
        )
        return ("roster" if seat else "public"), None

    def squad_collection(self, match: dict[str, Any]) -> str:
        return "fee_squads" if is_side(match) else "match_rosters"
