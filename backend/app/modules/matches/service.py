import math
import secrets
from datetime import timedelta
from typing import Any, Literal

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.enums import (
    ContributionType,
    InvitationStatus,
    MatchStatus,
    NotificationType,
    RosterStatus,
)
from app.common.response import PageParams
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, NotFound, ValidationFailed
from app.modules.matches import lifecycle
from app.modules.matches.schemas import (
    CompleteIn,
    CompositionOut,
    MatchIn,
    MatchOut,
    MatchUpdateIn,
    VenueOut,
)
from app.modules.players.reliability import recompute_player_stats
from app.modules.teams.policy import can_manage_match, ensure_match_manager, ensure_team_manager
from app.modules.users.schemas import public_user

_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
ROLES = ("batsman", "bowler", "wicketkeeper", "all_rounder")


def new_match_code() -> str:
    return "CM-" + "".join(secrets.choice(_CODE_ALPHABET) for _ in range(6))


def per_head_fee(estimated_paise: int, capacity: int) -> int:
    """Indicative per-head fee, rounded up to the whole rupee."""
    if capacity <= 0 or estimated_paise <= 0:
        return 0
    return math.ceil(estimated_paise / capacity / 100) * 100


class MatchAccess:
    """Loads matches/teams and evaluates viewer relationships. Shared by match-related modules."""

    def __init__(self, c: Container) -> None:
        self.c = c
        self.matches = c.mongo["matches"]

    async def load(
        self, match_id: ObjectId, session: AsyncClientSession | None = None
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        match = await self.matches.find_one({"_id": match_id}, session=session)
        if not match:
            raise NotFound("Match not found")
        team = await self.c.mongo["teams"].find_one({"_id": match["team_id"]}, session=session)
        return match, team

    async def load_managed(self, match_id: ObjectId, user: CurrentUser) -> tuple[dict[str, Any], dict[str, Any] | None]:
        match, team = await self.load(match_id)
        ensure_match_manager(match, team, user.id)
        return match, team

    async def relation(
        self, match: dict[str, Any], team: dict[str, Any] | None, user_id: ObjectId
    ) -> tuple[Literal["manager", "roster", "invitee", "public"], dict[str, Any] | None]:
        inv = await self.c.mongo["invitations"].find_one(
            {"match_id": match["_id"], "player_id": user_id}, sort=[("invited_at", -1)]
        )
        if can_manage_match(match, team, user_id):
            return "manager", inv
        seat = await self.c.mongo["match_rosters"].find_one(
            {"match_id": match["_id"], "player_id": user_id, "is_active": True}
        )
        if seat:
            return "roster", inv
        if inv and inv["invitation_status"] in (
            InvitationStatus.PENDING,
            InvitationStatus.ACCEPTED,
            InvitationStatus.CONFIRMED,
        ):
            return "invitee", inv
        return "public", inv

    async def composition(self, match: dict[str, Any], session: AsyncClientSession | None = None) -> CompositionOut:
        counts = dict.fromkeys(ROLES, 0)
        async for r in self.c.mongo["match_rosters"].find(
            {"match_id": match["_id"], "is_active": True}, {"assigned_role": 1}, session=session
        ):
            role = r.get("assigned_role")
            if role in counts:
                counts[role] += 1
        confirmed = match.get("confirmed_count", 0)
        return CompositionOut(
            required=match.get("required_roles") or {},
            confirmed=counts,
            capacity=match["squad_capacity"],
            confirmed_total=confirmed,
            vacancies=max(0, match["squad_capacity"] - confirmed),
        )

    async def to_out(self, match: dict[str, Any], team: dict[str, Any] | None, user: CurrentUser) -> MatchOut:
        relation, inv = await self.relation(match, team, user.id)
        captain = await self.c.mongo["users"].find_one({"_id": match["captain_id"]}) or {
            "_id": match["captain_id"],
            "full_name": "Captain",
        }
        venue = match.get("venue") or {}
        lng, lat = match["location"]["coordinates"]
        private = relation == "public"
        seat = await self.c.mongo["match_rosters"].find_one(
            {"match_id": match["_id"], "player_id": user.id, "is_active": True}, {"contribution_type": 1}
        )
        status = MatchStatus(match["match_status"])
        return MatchOut(
            id=str(match["_id"]),
            match_code=match["match_code"],
            team_id=str(match["team_id"]),
            team_name=(team or {}).get("team_name", "Team"),
            team_logo=(team or {}).get("logo"),
            captain=public_user(captain),
            title=match.get("title", "Match"),
            description=match.get("description"),
            venue=VenueOut(
                name=None if private else venue.get("name"),
                address=None if private else venue.get("address"),
                area=venue.get("area"),
                city=venue.get("city"),
                lat=None if private else lat,
                lng=None if private else lng,
                restricted=private,
            ),
            start_at=match["start_at"],
            end_at=match["end_at"],
            timezone=match["timezone"],
            format=match["format"],
            category=match["category"],
            squad_capacity=match["squad_capacity"],
            required_roles=match.get("required_roles") or {},
            composition=await self.composition(match),
            estimated_expenses_paise=match.get("estimated_expenses_paise", 0),
            per_head_fee_paise=match.get("per_head_fee_paise", 0),
            default_contribution_type=match.get("default_contribution_type", ContributionType.PAYEE),
            match_status=status,
            allowed_transitions=sorted(s.value for s in lifecycle.TRANSITIONS[status]) if relation == "manager" else [],
            viewer_relation=relation,
            my_invitation_id=str(inv["_id"]) if inv else None,
            my_invitation_status=inv["invitation_status"] if inv else None,
            my_contribution_type=(seat or {}).get("contribution_type") or (inv or {}).get("contribution_type"),
            cancelled_reason=match.get("cancelled_reason"),
            reschedule_count=len(match.get("reschedule_history") or []),
            created_at=match["created_at"],
        )


class MatchService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.access = MatchAccess(c)
        self.matches = c.mongo["matches"]
        self.rosters = c.mongo["match_rosters"]

    async def _participants(self, match_id: ObjectId, include_pending: bool = True) -> list[ObjectId]:
        ids = [r["player_id"] async for r in self.rosters.find({"match_id": match_id, "is_active": True})]
        if include_pending:
            ids += [
                i["player_id"]
                async for i in self.c.mongo["invitations"].find({"match_id": match_id, "is_active": True})
            ]
        return list(set(ids))

    @staticmethod
    def _history(frm: str | None, to: str, by: ObjectId | None, reason: str | None = None) -> dict[str, Any]:
        return {"from": frm, "to": to, "by": by, "at": utcnow(), "reason": reason}

    # ---------------------------------------------------------------- create
    async def create(self, user: CurrentUser, data: MatchIn) -> MatchOut:
        team = await self.c.mongo["teams"].find_one({"_id": ObjectId(data.team_id), "team_status": "active"})
        if not team:
            raise NotFound("Team not found")
        ensure_team_manager(team, user.id)
        now = utcnow()
        status = MatchStatus.PUBLISHED if data.publish else MatchStatus.DRAFT
        captain_role = data.captain_role
        if data.captain_plays and captain_role is None:
            prof = await self.c.mongo["player_profiles"].find_one({"user_id": user.id}, {"primary_role": 1})
            captain_role = (prof or {}).get("primary_role", "all_rounder")
        doc: dict[str, Any] = {
            "team_id": team["_id"],
            "captain_id": user.id,
            "title": data.title,
            "description": data.description,
            "venue": data.venue.model_dump(mode="json"),
            "location": data.location.to_geojson(),
            "start_at": data.start_at,
            "end_at": data.end_at,
            "timezone": data.timezone,
            "format": data.format.value,
            "category": data.category.value,
            "squad_capacity": data.squad_capacity,
            "required_roles": data.required_roles.model_dump(),
            "estimated_expenses_paise": data.estimated_expenses_paise,
            "per_head_fee_paise": per_head_fee(data.estimated_expenses_paise, data.squad_capacity),
            "default_contribution_type": data.default_contribution_type.value,
            "captain_plays": data.captain_plays,
            "confirmed_count": 1 if data.captain_plays else 0,
            "match_status": status.value,
            "status_history": [self._history(None, MatchStatus.DRAFT.value, user.id)]
            + ([self._history(MatchStatus.DRAFT.value, status.value, user.id)] if data.publish else []),
            "reschedule_history": [],
            "reminder_sent_at": None,
            "created_at": now,
            "updated_at": now,
        }

        async def txn(s: AsyncClientSession) -> ObjectId:
            for _ in range(5):
                doc["match_code"] = new_match_code()
                try:
                    res = await self.matches.insert_one(dict(doc), session=s)
                    break
                except DuplicateKeyError:
                    continue
            else:  # pragma: no cover - astronomically unlikely
                raise BusinessRuleViolation("Could not allocate a match code, please retry")
            if data.captain_plays:
                await self.rosters.insert_one(
                    {
                        "match_id": res.inserted_id,
                        "player_id": user.id,
                        "assigned_role": captain_role,
                        "contribution_type": ContributionType.PAYEE.value,
                        "status": RosterStatus.CONFIRMED.value,
                        "is_active": True,
                        "is_captain": True,
                        "source": "captain",
                        "invitation_id": None,
                        "joined_at": now,
                        "updated_at": now,
                    },
                    session=s,
                )
            await self.c.audit.log(
                actor_id=user.id,
                action="match.created",
                entity_type="match",
                entity_id=res.inserted_id,
                new_value={"status": status.value},
                request_id=user.request_id,
                session=s,
            )
            return ObjectId(res.inserted_id)

        match_id = await self.c.mongo.transaction(txn)
        match, team = await self.access.load(match_id)
        return await self.access.to_out(match, team, user)

    # ------------------------------------------------------------------ read
    async def get(self, user: CurrentUser, match_id: ObjectId) -> MatchOut:
        match, team = await self.access.load(match_id)
        out = await self.access.to_out(match, team, user)
        if out.viewer_relation == "public" and match["match_status"] == MatchStatus.DRAFT:
            raise NotFound("Match not found")
        return out

    async def list_matches(
        self,
        user: CurrentUser,
        role: Literal["captain", "player", "all"],
        when: Literal["upcoming", "past", "all"],
        team_id: ObjectId | None,
        status: MatchStatus | None,
        params: PageParams,
    ) -> tuple[list[MatchOut], int]:
        q: dict[str, Any] = {}
        ors: list[dict[str, Any]] = []
        managed_team_ids = [
            t["_id"]
            async for t in self.c.mongo["teams"].find(
                {"$or": [{"captain_id": user.id}, {"admin_ids": user.id}]}, {"_id": 1}
            )
        ]
        if role in ("captain", "all"):
            ors += [{"captain_id": user.id}, {"team_id": {"$in": managed_team_ids}}]
        if role in ("player", "all"):
            seat_ids = [
                r["match_id"]
                async for r in self.rosters.find(
                    {"player_id": user.id, "status": {"$in": [RosterStatus.CONFIRMED]}}, {"match_id": 1}
                )
            ]
            ors.append({"_id": {"$in": seat_ids}})
        q["$or"] = ors
        if team_id:
            q["team_id"] = team_id
        if status:
            q["match_status"] = status.value
        now = utcnow()
        if when == "upcoming":
            q["end_at"] = {"$gte": now}
            q.setdefault("match_status", {"$nin": [MatchStatus.COMPLETED, MatchStatus.CANCELLED]})
        elif when == "past":
            q["$and"] = [
                {
                    "$or": [
                        {"end_at": {"$lt": now}},
                        {"match_status": {"$in": [MatchStatus.COMPLETED, MatchStatus.CANCELLED]}},
                    ]
                }
            ]
        total = await self.matches.count_documents(q)
        sort = 1 if when == "upcoming" else -1
        cursor = self.matches.find(q).sort("start_at", sort).skip(params.skip).limit(params.page_size)
        out: list[MatchOut] = []
        teams: dict[ObjectId, dict[str, Any] | None] = {}
        async for m in cursor:
            if m["team_id"] not in teams:
                teams[m["team_id"]] = await self.c.mongo["teams"].find_one({"_id": m["team_id"]})
            out.append(await self.access.to_out(m, teams[m["team_id"]], user))
        return out, total

    # ---------------------------------------------------------------- update
    async def update(self, user: CurrentUser, match_id: ObjectId, data: MatchUpdateIn) -> MatchOut:
        match, team = await self.access.load_managed(match_id, user)
        if MatchStatus(match["match_status"]) not in lifecycle.EDITABLE:
            raise BusinessRuleViolation("This match can no longer be edited", code="MATCH_NOT_EDITABLE")
        fields = data.model_dump(
            exclude_unset=True,
            mode="json",
            exclude={"location", "start_at", "end_at", "reschedule_reason", "required_roles"},
        )
        if data.location is not None:
            fields["location"] = data.location.to_geojson()
        capacity = data.squad_capacity or match["squad_capacity"]
        if capacity < match.get("confirmed_count", 0):
            raise BusinessRuleViolation(
                "Squad capacity cannot be below the number of confirmed players", code="CAPACITY_BELOW_CONFIRMED"
            )
        if data.required_roles is not None:
            if data.required_roles.total > capacity:
                raise ValidationFailed("required_roles add up to more than squad_capacity")
            fields["required_roles"] = data.required_roles.model_dump()
        est = (
            data.estimated_expenses_paise
            if data.estimated_expenses_paise is not None
            else match.get("estimated_expenses_paise", 0)
        )
        fields["per_head_fee_paise"] = per_head_fee(est, capacity)

        rescheduled = False
        update: dict[str, Any] = {}
        if data.start_at or data.end_at:
            start = data.start_at or ensure_utc(match["start_at"])
            end = data.end_at or ensure_utc(match["end_at"])
            from app.modules.matches.schemas import _check_window

            try:
                _check_window(start, end)
            except ValueError as exc:
                raise ValidationFailed(str(exc)) from exc
            if start != ensure_utc(match["start_at"]) or end != ensure_utc(match["end_at"]):
                rescheduled = True
                fields.update({"start_at": start, "end_at": end, "reminder_sent_at": None})
                update["$push"] = {
                    "reschedule_history": {
                        "from_start": match["start_at"],
                        "from_end": match["end_at"],
                        "to_start": start,
                        "to_end": end,
                        "by": user.id,
                        "at": utcnow(),
                        "reason": data.reschedule_reason,
                    }
                }
        fields["updated_at"] = utcnow()
        update["$set"] = fields
        await self.matches.update_one({"_id": match_id}, update)
        await self.c.audit.log(
            actor_id=user.id,
            action="match.rescheduled" if rescheduled else "match.updated",
            entity_type="match",
            entity_id=match_id,
            previous_value={k: match.get(k) for k in fields if k != "updated_at"},
            new_value=fields,
            request_id=user.request_id,
        )
        if rescheduled:
            people = [p for p in await self._participants(match_id) if p != user.id]
            await self.c.notifications.notify(
                people,
                NotificationType.MATCH_RESCHEDULED,
                f"{match.get('title', 'Match')} rescheduled",
                f"New time: {fields['start_at'].isoformat()}. Please check your availability.",
                {"match_id": match_id},
            )
        match, team = await self.access.load(match_id)
        return await self.access.to_out(match, team, user)

    # ------------------------------------------------------------- lifecycle
    async def transition(
        self,
        user: CurrentUser,
        match_id: ObjectId,
        target: MatchStatus,
        allow_short_squad: bool = False,
        reason: str | None = None,
    ) -> MatchOut:
        match, team = await self.access.load_managed(match_id, user)
        current = MatchStatus(match["match_status"])
        lifecycle.ensure_transition(current, target)
        now = utcnow()
        if target == MatchStatus.SQUAD_CONFIRMED:
            confirmed = match.get("confirmed_count", 0)
            if confirmed < 2:
                raise BusinessRuleViolation("At least two confirmed players are required", code="SQUAD_TOO_SMALL")
            if confirmed < match["squad_capacity"] and not allow_short_squad:
                raise BusinessRuleViolation(
                    f"Only {confirmed} of {match['squad_capacity']} players are confirmed", code="SQUAD_INCOMPLETE"
                )
        if target == MatchStatus.IN_PROGRESS and now < ensure_utc(match["start_at"]) - timedelta(hours=1):
            raise BusinessRuleViolation("A match can only be started close to its start time", code="MATCH_NOT_STARTED")
        res = await self.matches.update_one(
            {"_id": match_id, "match_status": current.value},
            {
                "$set": {"match_status": target.value, "updated_at": now},
                "$push": {"status_history": self._history(current.value, target.value, user.id, reason)},
            },
        )
        if res.modified_count == 0:
            raise BusinessRuleViolation("Match status changed concurrently, please refresh", code="CONCURRENT_UPDATE")
        await self.c.audit.log(
            actor_id=user.id,
            action=f"match.{target.value}",
            entity_type="match",
            entity_id=match_id,
            previous_value={"status": current.value},
            new_value={"status": target.value},
            request_id=user.request_id,
        )
        if target in (MatchStatus.SQUAD_CONFIRMED, MatchStatus.SCHEDULED):
            roster = [p for p in await self._participants(match_id, include_pending=False) if p != user.id]
            await self.c.notifications.notify(
                roster,
                NotificationType.MATCH_CONFIRMED,
                f"{match.get('title', 'Match')} is confirmed",
                "The squad is locked in. See match details for venue and timing.",
                {"match_id": match_id},
            )
        await self.c.notifications.emit(
            await self._participants(match_id), "match.updated", {"match_id": str(match_id), "status": target.value}
        )
        match, team = await self.access.load(match_id)
        return await self.access.to_out(match, team, user)

    async def cancel(self, user: CurrentUser, match_id: ObjectId, reason: str) -> MatchOut:
        match, team = await self.access.load_managed(match_id, user)
        current = MatchStatus(match["match_status"])
        lifecycle.ensure_transition(current, MatchStatus.CANCELLED)
        people = [p for p in await self._participants(match_id) if p != user.id]
        now = utcnow()

        async def txn(s: AsyncClientSession) -> None:
            res = await self.matches.update_one(
                {"_id": match_id, "match_status": current.value},
                {
                    "$set": {
                        "match_status": MatchStatus.CANCELLED.value,
                        "cancelled_reason": reason,
                        "updated_at": now,
                    },
                    "$push": {"status_history": self._history(current.value, "cancelled", user.id, reason)},
                },
                session=s,
            )
            if res.modified_count == 0:
                raise BusinessRuleViolation("Match status changed concurrently", code="CONCURRENT_UPDATE")
            await self.c.mongo["invitations"].update_many(
                {
                    "match_id": match_id,
                    "invitation_status": {"$in": [InvitationStatus.PENDING, InvitationStatus.ACCEPTED]},
                },
                {
                    "$set": {
                        "invitation_status": InvitationStatus.CANCELLED.value,
                        "is_active": False,
                        "cancel_reason": "match_cancelled",
                        "responded_at": now,
                    }
                },
                session=s,
            )
            await self.c.audit.log(
                actor_id=user.id,
                action="match.cancelled",
                entity_type="match",
                entity_id=match_id,
                previous_value={"status": current.value},
                new_value={"status": "cancelled", "reason": reason},
                request_id=user.request_id,
                session=s,
            )

        await self.c.mongo.transaction(txn)
        await self.c.notifications.notify(
            people,
            NotificationType.MATCH_CANCELLED,
            f"{match.get('title', 'Match')} cancelled",
            f"Reason: {reason}",
            {"match_id": match_id},
        )
        match, team = await self.access.load(match_id)
        return await self.access.to_out(match, team, user)

    async def complete(self, user: CurrentUser, match_id: ObjectId, data: CompleteIn) -> MatchOut:
        match, team = await self.access.load_managed(match_id, user)
        current = MatchStatus(match["match_status"])
        now = utcnow()
        if now < ensure_utc(match["start_at"]):
            raise BusinessRuleViolation("A match cannot be completed before it starts", code="MATCH_NOT_STARTED")
        if current == MatchStatus.SCHEDULED:
            path = [MatchStatus.IN_PROGRESS, MatchStatus.COMPLETED]
        else:
            lifecycle.ensure_transition(current, MatchStatus.COMPLETED)
            path = [MatchStatus.COMPLETED]
        seats = {r["player_id"]: r async for r in self.rosters.find({"match_id": match_id, "is_active": True})}
        for item in data.attendance:
            if ObjectId(item.player_id) not in seats:
                raise ValidationFailed(f"Player {item.player_id} is not on this match roster", code="NOT_ON_ROSTER")

        async def txn(s: AsyncClientSession) -> None:
            history = []
            prev = current.value
            for step in path:
                history.append(self._history(prev, step.value, user.id))
                prev = step.value
            res = await self.matches.update_one(
                {"_id": match_id, "match_status": current.value},
                {
                    "$set": {"match_status": MatchStatus.COMPLETED.value, "completed_at": now, "updated_at": now},
                    "$push": {"status_history": {"$each": history}},
                },
                session=s,
            )
            if res.modified_count == 0:
                raise BusinessRuleViolation("Match status changed concurrently", code="CONCURRENT_UPDATE")
            marked = {ObjectId(i.player_id): i.attendance.value for i in data.attendance}
            for pid in seats:
                await self.rosters.update_one(
                    {"match_id": match_id, "player_id": pid, "is_active": True},
                    {"$set": {"attendance": marked.get(pid, "present"), "updated_at": now}},
                    session=s,
                )
            await self.c.mongo["captain_profiles"].update_one(
                {"user_id": match["captain_id"]}, {"$inc": {"matches_captained": 1}}, session=s
            )
            await self.c.audit.log(
                actor_id=user.id,
                action="match.completed",
                entity_type="match",
                entity_id=match_id,
                new_value={"attendance": {str(k): v for k, v in marked.items()}},
                request_id=user.request_id,
                session=s,
            )

        await self.c.mongo.transaction(txn)
        await recompute_player_stats(self.c.mongo, list(seats))
        others = [p for p in seats if p != user.id]
        await self.c.notifications.notify(
            others,
            NotificationType.RATING_REQUEST,
            "Rate your match",
            f"{match.get('title', 'Match')} is complete. Rate your captain and teammates.",
            {"match_id": match_id, "action": "rate"},
        )
        match, team = await self.access.load(match_id)
        return await self.access.to_out(match, team, user)
