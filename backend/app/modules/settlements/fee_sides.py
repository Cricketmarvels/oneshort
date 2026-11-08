"""Team-vs-team match fees: each team splits its own share among the players it chooses."""

from datetime import datetime
from typing import Any

from bson import ObjectId
from pydantic import BaseModel, Field
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.enums import ContributionType, FixtureStatus, SettlementStatus
from app.common.types import ObjectIdStr, StrictModel, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Forbidden, NotFound, ValidationFailed
from app.modules.teams.policy import can_manage_team
from app.modules.users.schemas import PublicUserOut, public_user


class SquadIn(StrictModel):
    player_ids: list[ObjectIdStr] = Field(min_length=1, max_length=30)
    non_payee_ids: list[ObjectIdStr] = Field(
        default_factory=list, max_length=30, description="In the squad but don't pay"
    )


class SquadMemberOut(BaseModel):
    user: PublicUserOut
    in_squad: bool
    contribution_type: ContributionType | None


class FeeSideOut(BaseModel):
    id: str = Field(description="Ledger id: use it as match_id with the expense and settlement endpoints")
    fixture_id: str
    team_id: str
    team_name: str
    title: str
    start_at: datetime
    can_manage: bool
    members: list[SquadMemberOut]
    settlement_id: str | None = Field(description="Current published settlement, if any")
    settlement_status: SettlementStatus | None


class FeeSideService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["fee_sides"]
        self.squads = c.mongo["fee_squads"]

    async def _fixture_team(self, fid: ObjectId, tid: ObjectId) -> tuple[dict[str, Any], dict[str, Any]]:
        fx = await self.c.mongo["fixtures"].find_one({"_id": fid})
        if not fx or tid not in (fx["home_team_id"], fx["away_team_id"]):
            raise NotFound("Match not found")
        team = await self.c.mongo["teams"].find_one({"_id": tid})
        if not team:
            raise NotFound("Team not found")
        return fx, team

    async def _members(self, tid: ObjectId) -> list[ObjectId]:
        return [
            m["user_id"]
            async for m in self.c.mongo["team_members"].find({"team_id": tid, "status": "active"}, {"user_id": 1})
        ]

    async def open(self, user: CurrentUser, fid: ObjectId, tid: ObjectId) -> FeeSideOut:
        """Get this team's fee ledger for the fixture, creating it (managers only) on first use."""
        fx, team = await self._fixture_team(fid, tid)
        side = await self.col.find_one({"fixture_id": fid, "team_id": tid})
        manager = can_manage_team(team, user.id)
        if not side:
            if not manager:
                raise NotFound("This team hasn't set up a match fee yet", code="NO_FEE_LEDGER")
            if fx["status"] == FixtureStatus.CANCELLED:
                raise BusinessRuleViolation("This match was cancelled", code="MATCH_CANCELLED")
            names = {
                t["_id"]: t["team_name"]
                async for t in self.c.mongo["teams"].find({"_id": {"$in": [fx["home_team_id"], fx["away_team_id"]]}})
            }
            other = fx["away_team_id"] if tid == fx["home_team_id"] else fx["home_team_id"]
            doc = {
                "fixture_id": fid,
                "team_id": tid,
                "captain_id": team["captain_id"],
                "title": f"{names.get(tid, 'Team')} vs {names.get(other, 'Opponent')}",
                "start_at": fx["start_at"],
                "created_by": user.id,
                "created_at": utcnow(),
            }
            try:
                res = await self.col.insert_one(doc)
                side = {**doc, "_id": res.inserted_id}
            except DuplicateKeyError:
                side = await self.col.find_one({"fixture_id": fid, "team_id": tid})
                assert side
            else:
                # default squad: this team's scorecard players if a result exists, else every active member
                played = [p["user_id"] for p in ((fx.get("result") or {}).get("players") or []) if p["team_id"] == tid]
                ids = played or await self._members(tid)
                if ids:
                    await self.squads.insert_many(
                        [
                            {
                                "match_id": side["_id"],
                                "player_id": u,
                                "is_active": True,
                                "contribution_type": ContributionType.PAYEE.value,
                            }
                            for u in ids
                        ]
                    )
                await self.c.audit.log(
                    actor_id=user.id,
                    action="fee_side.created",
                    entity_type="fixture",
                    entity_id=fid,
                    new_value={"team_id": tid, "squad": len(ids)},
                    request_id=user.request_id,
                )
        elif not manager:
            seat = await self.squads.count_documents(
                {"match_id": side["_id"], "player_id": user.id, "is_active": True}, limit=1
            )
            if not seat:
                raise Forbidden("Only this team's squad can see its match fee", code="FEES_PRIVATE")
        return await self._out(side, team, manager)

    async def get(self, user: CurrentUser, side_id: ObjectId) -> FeeSideOut:
        side = await self.col.find_one({"_id": side_id})
        if not side:
            raise NotFound("Fee ledger not found")
        return await self.open(user, side["fixture_id"], side["team_id"])

    async def set_squad(self, user: CurrentUser, side_id: ObjectId, data: SquadIn) -> FeeSideOut:
        side = await self.col.find_one({"_id": side_id})
        if not side:
            raise NotFound("Fee ledger not found")
        team = await self.c.mongo["teams"].find_one({"_id": side["team_id"]})
        if not team or not can_manage_team(team, user.id):
            raise Forbidden("Only the team's captain or vice-captain can choose who pays", code="NOT_TEAM_MANAGER")
        members = set(await self._members(side["team_id"]))
        wanted = [ObjectId(p) for p in dict.fromkeys(data.player_ids)]
        free = {ObjectId(p) for p in data.non_payee_ids}
        if not set(wanted) <= members:
            raise ValidationFailed("The squad can only include active members of the team", code="NOT_TEAM_MEMBER")
        if not free <= set(wanted):
            raise ValidationFailed("Non-paying players must be in the squad", code="NOT_IN_SQUAD")
        await self.squads.update_many({"match_id": side_id}, {"$set": {"is_active": False}})
        for p in wanted:
            await self.squads.update_one(
                {"match_id": side_id, "player_id": p},
                {
                    "$set": {
                        "is_active": True,
                        "contribution_type": (
                            ContributionType.NON_PAYEE if p in free else ContributionType.PAYEE
                        ).value,
                    }
                },
                upsert=True,
            )
        await self.c.audit.log(
            actor_id=user.id,
            action="fee_side.squad_set",
            entity_type="fee_side",
            entity_id=side_id,
            new_value={"players": len(wanted), "non_payees": len(free)},
            request_id=user.request_id,
        )
        return await self._out(side, team, True)

    async def _out(self, side: dict[str, Any], team: dict[str, Any], manager: bool) -> FeeSideOut:
        squad = {s["player_id"]: s async for s in self.squads.find({"match_id": side["_id"]})}
        ids = list(set(squad) | set(await self._members(side["team_id"]) if manager else set(squad)))
        users = {
            u["_id"]: u
            async for u in self.c.mongo["users"].find({"_id": {"$in": ids}, "account_status": {"$ne": "deleted"}})
        }
        members = sorted(
            (
                SquadMemberOut(
                    user=public_user(users[u]),
                    in_squad=bool(squad.get(u, {}).get("is_active")),
                    contribution_type=squad[u]["contribution_type"] if squad.get(u, {}).get("is_active") else None,
                )
                for u in ids
                if u in users and (manager or squad.get(u, {}).get("is_active"))
            ),
            key=lambda m: (not m.in_squad, m.user.full_name),
        )
        st = await self.c.mongo["settlements"].find_one(
            {
                "match_id": side["_id"],
                "settlement_status": {"$in": [SettlementStatus.PUBLISHED.value, SettlementStatus.DRAFT.value]},
            },
            sort=[("version", -1)],
        )
        fx = await self.c.mongo["fixtures"].find_one({"_id": side["fixture_id"]}, {"start_at": 1}) or {}
        return FeeSideOut(
            id=str(side["_id"]),
            fixture_id=str(side["fixture_id"]),
            team_id=str(side["team_id"]),
            team_name=team["team_name"],
            title=side["title"],
            start_at=fx.get("start_at", side["start_at"]),
            can_manage=manager,
            members=members,
            settlement_id=str(st["_id"]) if st else None,
            settlement_status=st["settlement_status"] if st else None,
        )
