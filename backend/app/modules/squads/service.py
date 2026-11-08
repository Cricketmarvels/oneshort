"""Squad (roster) management: composition, edits, removal, withdrawal, replacement,
and Build-a-Team suggestions (team members, previous participants)."""

from datetime import timedelta
from typing import Any

from bson import ObjectId
from pydantic import BaseModel, Field
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.dependencies import CurrentUser
from app.common.enums import (
    Attendance,
    ContributionType,
    InvitationStatus,
    MatchStatus,
    NotificationType,
    PlayingRole,
    RosterStatus,
)
from app.common.types import ObjectIdStr, StrictModel, ensure_utc, utcnow
from app.common.validators import ShortText
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Forbidden, NotFound
from app.modules.availability.service import AvailabilityService
from app.modules.invitations.schemas import CreateInvitationsIn, InvitationResultItem, InviteItem
from app.modules.invitations.service import InvitationService
from app.modules.matches import lifecycle
from app.modules.matches.schemas import CompositionOut
from app.modules.matches.service import MatchAccess
from app.modules.users.schemas import PublicUserOut, public_user


class RosterEntryOut(BaseModel):
    player: PublicUserOut
    assigned_role: PlayingRole | None
    contribution_type: ContributionType
    status: RosterStatus
    is_captain: bool
    is_substitute: bool
    attendance: Attendance | None
    average_rating: float | None
    reliability_score: float | None
    joined_at: Any


class RosterOut(BaseModel):
    match_id: str
    match_status: MatchStatus
    composition: CompositionOut
    active: list[RosterEntryOut]
    history: list[RosterEntryOut] = Field(description="Withdrawn / removed / replaced players")
    can_manage: bool


class ConfirmIn(StrictModel):
    invitation_id: ObjectIdStr


class RosterUpdateIn(StrictModel):
    assigned_role: PlayingRole | None = None
    contribution_type: ContributionType | None = None
    status: RosterStatus | None = Field(default=None, description="Only 'removed' is accepted here")
    reason: ShortText | None = None


class ReplaceIn(StrictModel):
    replacement_player_id: ObjectIdStr
    reason: ShortText | None = None


class WithdrawIn(StrictModel):
    reason: ShortText | None = None


class SuggestionOut(BaseModel):
    player: PublicUserOut
    primary_role: PlayingRole | None
    secondary_roles: list[PlayingRole]
    availability_state: str
    average_rating: float | None
    reliability_score: float | None
    previous_matches_together: int
    already_invited: bool


class SquadService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.access = MatchAccess(c)
        self.rosters = c.mongo["match_rosters"]
        self.invitations = InvitationService(c)
        self.avail = AvailabilityService(c)

    async def roster(self, user: CurrentUser, match_id: ObjectId) -> RosterOut:
        match, team = await self.access.load(match_id)
        relation, _ = await self.access.relation(match, team, user.id)
        if relation not in ("manager", "roster"):
            raise Forbidden("Only the squad and its captain can view the roster", code="ROSTER_PRIVATE")
        rows = [r async for r in self.rosters.find({"match_id": match_id}).sort("joined_at", 1)]
        ids = [r["player_id"] for r in rows]
        users = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": ids}})}
        profs = {p["user_id"]: p async for p in self.c.mongo["player_profiles"].find({"user_id": {"$in": ids}})}

        def entry(r: dict[str, Any]) -> RosterEntryOut:
            p = profs.get(r["player_id"], {})
            return RosterEntryOut(
                player=public_user(users.get(r["player_id"], {"_id": r["player_id"], "full_name": "Player"})),
                assigned_role=r.get("assigned_role"),
                contribution_type=r["contribution_type"],
                status=r["status"],
                is_captain=r.get("is_captain", False),
                is_substitute=r.get("is_substitute", False),
                attendance=r.get("attendance"),
                average_rating=p.get("average_rating"),
                reliability_score=p.get("reliability_score"),
                joined_at=r.get("joined_at"),
            )

        return RosterOut(
            match_id=str(match_id),
            match_status=match["match_status"],
            composition=await self.access.composition(match),
            active=[entry(r) for r in rows if r.get("is_active")],
            history=[entry(r) for r in rows if not r.get("is_active")],
            can_manage=relation == "manager",
        )

    async def update_entry(
        self, user: CurrentUser, match_id: ObjectId, player_id: ObjectId, data: RosterUpdateIn
    ) -> RosterOut:
        match, _ = await self.access.load_managed(match_id, user)
        if data.status is not None:
            if data.status != RosterStatus.REMOVED:
                raise BusinessRuleViolation("Only 'removed' can be set here", code="INVALID_STATUS")
            await self._vacate(user, match, player_id, RosterStatus.REMOVED, data.reason)
            return await self.roster(user, match_id)
        fields: dict[str, Any] = {"updated_at": utcnow()}
        if data.assigned_role:
            fields["assigned_role"] = data.assigned_role.value
        if data.contribution_type:
            fields["contribution_type"] = data.contribution_type.value
        res = await self.rosters.update_one(
            {"match_id": match_id, "player_id": player_id, "is_active": True}, {"$set": fields}
        )
        if res.matched_count == 0:
            raise NotFound("Player is not in the squad")
        await self.c.audit.log(
            actor_id=user.id,
            action="roster.updated",
            entity_type="match",
            entity_id=match_id,
            new_value={"player_id": player_id, **fields},
            request_id=user.request_id,
        )
        await self.c.notifications.emit([player_id], "roster.updated", {"match_id": str(match_id)})
        return await self.roster(user, match_id)

    async def _vacate(
        self,
        actor: CurrentUser,
        match: dict[str, Any],
        player_id: ObjectId,
        status: RosterStatus,
        reason: str | None,
        replaced_by: ObjectId | None = None,
    ) -> None:
        if MatchStatus(match["match_status"]) not in lifecycle.ROSTER_MUTABLE:
            raise BusinessRuleViolation("The squad can no longer change", code="ROSTER_LOCKED")
        now = utcnow()
        late = (ensure_utc(match["start_at"]) - now) < timedelta(hours=self.c.settings.late_withdrawal_hours)

        async def txn(s: AsyncClientSession) -> None:
            seat = await self.rosters.find_one_and_update(
                {"match_id": match["_id"], "player_id": player_id, "is_active": True},
                {
                    "$set": {
                        "status": status.value,
                        "is_active": False,
                        "updated_at": now,
                        "vacate_reason": reason,
                        "replaced_by": replaced_by,
                        "late_withdrawal": late and status == RosterStatus.WITHDRAWN,
                    }
                },
                session=s,
            )
            if not seat:
                raise NotFound("Player is not in the squad")
            if seat.get("is_captain") and status != RosterStatus.WITHDRAWN:
                raise BusinessRuleViolation(
                    "The captain cannot be removed from their own match", code="CAPTAIN_CANNOT_LEAVE"
                )
            await self.c.mongo["matches"].update_one(
                {"_id": match["_id"]}, {"$inc": {"confirmed_count": -1}, "$set": {"updated_at": now}}, session=s
            )
            if seat.get("invitation_id"):
                await self.c.mongo["invitations"].update_one(
                    {"_id": seat["invitation_id"], "invitation_status": InvitationStatus.CONFIRMED.value},
                    {
                        "$set": {
                            "invitation_status": InvitationStatus.CANCELLED.value,
                            "is_active": False,
                            "cancel_reason": status.value,
                            "updated_at": now,
                        },
                        "$push": {
                            "status_history": {
                                "from": "confirmed",
                                "to": "cancelled",
                                "by": actor.id,
                                "at": now,
                                "reason": status.value,
                            }
                        },
                    },
                    session=s,
                )
            # A vacancy re-opens recruitment if the squad had been locked in.
            if match["match_status"] in (MatchStatus.SQUAD_CONFIRMED, MatchStatus.SCHEDULED):
                await self.c.mongo["matches"].update_one(
                    {"_id": match["_id"], "match_status": match["match_status"]},
                    {
                        "$set": {"match_status": MatchStatus.RECRUITING.value},
                        "$push": {
                            "status_history": {
                                "from": match["match_status"],
                                "to": "recruiting",
                                "by": actor.id,
                                "at": now,
                                "reason": f"vacancy:{status.value}",
                            }
                        },
                    },
                    session=s,
                )
            await self.c.audit.log(
                actor_id=actor.id,
                action=f"roster.{status.value}",
                entity_type="match",
                entity_id=match["_id"],
                new_value={"player_id": player_id, "reason": reason, "late": late},
                request_id=actor.request_id,
                session=s,
            )

        await self.c.mongo.transaction(txn)
        if status == RosterStatus.WITHDRAWN:
            await self.c.mongo["player_profiles"].update_one(
                {"user_id": player_id}, {"$inc": {"stats.late_withdrawals": 1 if late else 0}}
            )
            await self.c.notifications.notify(
                [match["captain_id"]],
                NotificationType.PLAYER_WITHDREW,
                f"{actor.full_name} withdrew",
                f"{match.get('title', 'Match')}: a spot is open.{' (late withdrawal)' if late else ''}",
                {"match_id": match["_id"]},
            )
        else:
            await self.c.notifications.notify(
                [player_id],
                NotificationType.PLAYER_REPLACED
                if status == RosterStatus.REPLACED
                else NotificationType.INVITATION_CANCELLED,
                f"Squad update: {match.get('title', 'Match')}",
                "The captain has updated the squad and you are no longer in it."
                + (f" Reason: {reason}" if reason else ""),
                {"match_id": match["_id"]},
            )
        await self.c.notifications.emit(
            [player_id, match["captain_id"]], "roster.updated", {"match_id": str(match["_id"])}
        )

    async def withdraw(self, user: CurrentUser, match_id: ObjectId, reason: str | None) -> None:
        match, _ = await self.access.load(match_id)
        if match["captain_id"] == user.id:
            raise BusinessRuleViolation("Captains cancel the match instead of withdrawing", code="CAPTAIN_CANNOT_LEAVE")
        await self._vacate(user, match, user.id, RosterStatus.WITHDRAWN, reason)

    async def replace(
        self, user: CurrentUser, match_id: ObjectId, player_id: ObjectId, data: ReplaceIn
    ) -> list[InvitationResultItem]:
        match, _ = await self.access.load_managed(match_id, user)
        seat = await self.rosters.find_one({"match_id": match_id, "player_id": player_id, "is_active": True})
        if not seat:
            raise NotFound("Player is not in the squad")
        new_id = ObjectId(data.replacement_player_id)
        await self._vacate(user, match, player_id, RosterStatus.REPLACED, data.reason, replaced_by=new_id)
        match, _ = await self.access.load(match_id)
        return await self.invitations.invite(
            user,
            match_id,
            CreateInvitationsIn(
                invites=[
                    InviteItem(
                        player_id=str(new_id),
                        contribution_type=ContributionType(seat["contribution_type"]),
                        proposed_role=seat.get("assigned_role"),
                    )
                ],
                message=f"Substitute call-up{': ' + data.reason if data.reason else ''}",
            ),
            is_substitute=True,
            replaces=player_id,
        )

    # ------------------------------------------------------- Build a Team helpers
    async def _suggest(
        self, match: dict[str, Any], candidates: dict[ObjectId, int], role: str | None, q: str | None
    ) -> list[SuggestionOut]:
        ids = [i for i in candidates if i != match["captain_id"]]
        users = {
            u["_id"]: u
            async for u in self.c.mongo["users"].find({"_id": {"$in": ids}, "account_status": {"$in": ["active"]}})
        }
        profs = {p["user_id"]: p async for p in self.c.mongo["player_profiles"].find({"user_id": {"$in": ids}})}
        active_inv = {
            i["player_id"]
            async for i in self.c.mongo["invitations"].find(
                {"match_id": match["_id"], "is_active": True}, {"player_id": 1}
            )
        }
        seated = {r["player_id"] async for r in self.rosters.find({"match_id": match["_id"], "is_active": True})}
        out: list[SuggestionOut] = []
        for uid in ids:
            u, p = users.get(uid), profs.get(uid)
            if not u or not p or uid in seated:
                continue
            if role and p.get("primary_role") != role and role not in (p.get("secondary_roles") or []):
                continue
            if q and q.lower() not in u["full_name"].lower():
                continue
            st = await self.avail.status_for_window(uid, ensure_utc(match["start_at"]), ensure_utc(match["end_at"]))
            out.append(
                SuggestionOut(
                    player=public_user(u),
                    primary_role=p.get("primary_role"),
                    secondary_roles=p.get("secondary_roles") or [],
                    availability_state=st["state"],
                    average_rating=p.get("average_rating"),
                    reliability_score=p.get("reliability_score"),
                    previous_matches_together=candidates[uid],
                    already_invited=uid in active_inv,
                )
            )
        rank = {"available": 0, "tentative": 1, "partial": 2, "unknown": 3, "unavailable": 4}
        out.sort(
            key=lambda s: (rank.get(s.availability_state, 5), -s.previous_matches_together, -(s.average_rating or 0))
        )
        return out

    async def suggest_members(
        self, user: CurrentUser, match_id: ObjectId, role: str | None, q: str | None
    ) -> list[SuggestionOut]:
        """Method A: existing team members with their availability for the match window."""
        match, _ = await self.access.load_managed(match_id, user)
        members = {
            m["user_id"]: 0
            async for m in self.c.mongo["team_members"].find({"team_id": match["team_id"], "status": "active"})
        }
        return await self._suggest(match, members, role, q)

    async def suggest_previous(
        self, user: CurrentUser, match_id: ObjectId, role: str | None, q: str | None
    ) -> list[SuggestionOut]:
        """Method C: players who previously played (attended) in this team's completed matches
        and are currently available."""
        match, _ = await self.access.load_managed(match_id, user)
        past_ids = [
            m["_id"]
            async for m in self.c.mongo["matches"].find(
                {"team_id": match["team_id"], "match_status": MatchStatus.COMPLETED.value}, {"_id": 1}
            )
        ]
        counts: dict[ObjectId, int] = {}
        async for r in await self.rosters.aggregate(
            [
                {
                    "$match": {
                        "match_id": {"$in": past_ids},
                        "status": "confirmed",
                        "attendance": {"$in": ["present", "late"]},
                    }
                },
                {"$group": {"_id": "$player_id", "n": {"$sum": 1}}},
            ]
        ):
            counts[r["_id"]] = r["n"]
        suggestions = await self._suggest(match, counts, role, q)
        return [s for s in suggestions if s.availability_state in ("available", "tentative")]
