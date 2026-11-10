"""Invitations and join requests.

Concurrency guarantees
- Duplicate active invitations: partial unique index ``(match_id, player_id) where is_active``.
- Overbooking: confirmation runs in a transaction that performs a guarded increment
  ``confirmed_count < squad_capacity`` on the match document. Concurrent confirmations
  conflict on that document; MongoDB aborts and the driver retries, at which point the
  guard fails once the squad is full.
- Double booking: a player cannot hold active seats in two overlapping matches.
"""

from datetime import timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.enums import (
    AccountStatus,
    ContributionType,
    InvitationDirection,
    InvitationStatus,
    MatchStatus,
    NotificationType,
    RosterStatus,
)
from app.common.response import PageParams
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import AppError, BusinessRuleViolation, Conflict, Forbidden, NotFound
from app.modules.availability.service import AvailabilityService
from app.modules.invitations import state_machine as sm
from app.modules.invitations.schemas import (
    CreateInvitationsIn,
    InvitationOut,
    InvitationResultItem,
    JoinRequestIn,
    MatchBriefOut,
)
from app.modules.matches import lifecycle
from app.modules.matches.service import MatchAccess
from app.modules.teams.policy import can_manage_match, ensure_match_manager
from app.modules.users.schemas import public_user

S = InvitationStatus
D = InvitationDirection


class InvitationService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["invitations"]
        self.access = MatchAccess(c)
        self.avail = AvailabilityService(c)

    # ------------------------------------------------------------ helpers
    def _expiry(self, match: dict[str, Any]) -> Any:
        return min(utcnow() + timedelta(hours=self.c.settings.invitation_ttl_hours), ensure_utc(match["start_at"]))

    async def _eligible_player(self, player_id: ObjectId) -> dict[str, Any]:
        user = await self.c.mongo["users"].find_one({"_id": player_id})
        if not user or user.get("account_status") in (AccountStatus.DELETED, AccountStatus.SUSPENDED):
            raise NotFound("Player not found", code="PLAYER_NOT_FOUND")
        if user.get("account_status") == AccountStatus.RESTRICTED:
            raise BusinessRuleViolation("This player cannot be invited right now", code="PLAYER_RESTRICTED")
        if not await self.c.mongo["player_profiles"].count_documents({"user_id": player_id}, limit=1):
            raise BusinessRuleViolation("Player has no player profile", code="PLAYER_PROFILE_MISSING")
        return user

    async def _check_availability(self, match: dict[str, Any], player_id: ObjectId, is_member: bool) -> str:
        """Enforce FR-INV-2 (no invitations to unavailable players). See FRD assumption 4."""
        state = await self.avail.status_for_window(
            player_id, ensure_utc(match["start_at"]), ensure_utc(match["end_at"])
        )
        st = state["state"]
        if st == "unavailable":
            raise BusinessRuleViolation(
                "Player has marked themselves unavailable for this time", code="PLAYER_UNAVAILABLE"
            )
        if not is_member and st in ("unknown",):
            raise BusinessRuleViolation("Player has not declared availability for this time", code="PLAYER_UNAVAILABLE")
        return str(st)

    async def _is_member(self, team_id: ObjectId, player_id: ObjectId) -> bool:
        return bool(
            await self.c.mongo["team_members"].count_documents(
                {"team_id": team_id, "user_id": player_id, "status": "active"}, limit=1
            )
        )

    async def _double_booked(
        self, match: dict[str, Any], player_id: ObjectId, s: AsyncClientSession | None = None
    ) -> bool:
        seats = [
            r["match_id"]
            async for r in self.c.mongo["match_rosters"].find(
                {"player_id": player_id, "is_active": True, "match_id": {"$ne": match["_id"]}},
                {"match_id": 1},
                session=s,
            )
        ]
        if not seats:
            return False
        clash = await self.c.mongo["matches"].count_documents(
            {
                "_id": {"$in": seats},
                "match_status": {"$nin": [MatchStatus.CANCELLED, MatchStatus.COMPLETED]},
                "start_at": {"$lt": match["end_at"]},
                "end_at": {"$gt": match["start_at"]},
            },
            session=s,
            limit=1,
        )
        return bool(clash)

    @staticmethod
    def _hist(frm: str | None, to: str, by: ObjectId | None, reason: str | None = None) -> dict[str, Any]:
        return {"from": frm, "to": to, "by": by, "at": utcnow(), "reason": reason}

    async def _get(self, invitation_id: ObjectId) -> dict[str, Any]:
        inv = await self.col.find_one({"_id": invitation_id})
        if not inv:
            raise NotFound("Invitation not found")
        return inv

    async def _transition(
        self,
        inv: dict[str, Any],
        target: S,
        actor: ObjectId,
        reason: str | None = None,
        extra: dict[str, Any] | None = None,
        s: AsyncClientSession | None = None,
    ) -> None:
        sm.ensure_transition(inv["invitation_status"], target, inv["direction"])
        now = utcnow()
        fields: dict[str, Any] = {
            "invitation_status": target.value,
            "is_active": sm.is_active(target),
            "updated_at": now,
            **(extra or {}),
        }
        if target in (S.ACCEPTED, S.REJECTED) or (target == S.CONFIRMED and inv["direction"] == D.REQUEST):
            fields["responded_at"] = now
        if target == S.CONFIRMED:
            fields["confirmed_at"] = now
        if target == S.CANCELLED and reason:
            fields["cancel_reason"] = reason
        res = await self.col.update_one(
            {"_id": inv["_id"], "invitation_status": inv["invitation_status"]},
            {
                "$set": fields,
                "$push": {"status_history": self._hist(inv["invitation_status"], target.value, actor, reason)},
            },
            session=s,
        )
        if res.modified_count == 0:
            raise Conflict("Invitation was updated by someone else, please refresh", code="CONCURRENT_UPDATE")

    async def _auto_recruiting(self, match: dict[str, Any], actor: ObjectId) -> None:
        if match["match_status"] == MatchStatus.PUBLISHED:
            await self.c.mongo["matches"].update_one(
                {"_id": match["_id"], "match_status": MatchStatus.PUBLISHED.value},
                {
                    "$set": {"match_status": MatchStatus.RECRUITING.value, "updated_at": utcnow()},
                    "$push": {"status_history": self._hist("published", "recruiting", actor, "first invitation")},
                },
            )

    # ------------------------------------------------------------ captain → player
    async def invite(
        self,
        user: CurrentUser,
        match_id: ObjectId,
        data: CreateInvitationsIn,
        *,
        is_substitute: bool = False,
        replaces: ObjectId | None = None,
    ) -> list[InvitationResultItem]:
        match, team = await self.access.load_managed(match_id, user)
        if MatchStatus(match["match_status"]) not in lifecycle.RECRUITABLE | {
            MatchStatus.SQUAD_CONFIRMED,
            MatchStatus.SCHEDULED,
        }:
            raise BusinessRuleViolation("Publish the match before inviting players", code="MATCH_NOT_RECRUITING")
        if ensure_utc(match["start_at"]) <= utcnow():
            raise BusinessRuleViolation("This match has already started", code="MATCH_STARTED")
        results: list[InvitationResultItem] = []
        now = utcnow()
        for item in data.invites:
            pid = ObjectId(item.player_id)
            try:
                if pid == user.id:
                    raise BusinessRuleViolation("You cannot invite yourself", code="SELF_INVITE")
                await self._eligible_player(pid)
                if await self.c.mongo["match_rosters"].count_documents(
                    {"match_id": match_id, "player_id": pid, "is_active": True}, limit=1
                ):
                    raise Conflict("Player is already in the squad", code="ALREADY_IN_SQUAD")
                state = await self._check_availability(match, pid, await self._is_member(match["team_id"], pid))
                ctype = item.contribution_type or ContributionType(match.get("default_contribution_type", "payee"))
                doc = {
                    "match_id": match_id,
                    "team_id": match["team_id"],
                    "captain_id": match["captain_id"],
                    "player_id": pid,
                    "direction": D.INVITE.value,
                    "invitation_status": S.PENDING.value,
                    "is_active": True,
                    "contribution_type": ctype.value,
                    "proposed_role": item.proposed_role.value if item.proposed_role else None,
                    "message": data.message,
                    "is_substitute": is_substitute,
                    "replaces_player_id": replaces,
                    "availability_state_at_invite": state,
                    "invited_by": user.id,
                    "invited_at": now,
                    "responded_at": None,
                    "confirmed_at": None,
                    "expires_at": self._expiry(match),
                    "status_history": [self._hist(None, S.PENDING.value, user.id)],
                    "updated_at": now,
                }
                try:
                    res = await self.col.insert_one(doc)
                except DuplicateKeyError as exc:
                    raise Conflict(
                        "Player already has an active invitation for this match", code="DUPLICATE_INVITATION"
                    ) from exc
                await self.c.mongo["player_profiles"].update_one(
                    {"user_id": pid}, {"$inc": {"stats.invitations_received": 1}}
                )
                await self.c.notifications.notify(
                    [pid],
                    NotificationType.PLAYER_INVITATION,
                    f"{'Substitute ' if is_substitute else ''}Invitation: {match.get('title', 'Match')}",
                    f"{user.full_name} invited you to play for {(team or {}).get('team_name', 'their team')} "
                    f"({'Payee' if ctype == ContributionType.PAYEE else 'Non-payee'}).",
                    {"match_id": match_id, "invitation_id": res.inserted_id},
                )
                await self.c.notifications.emit(
                    [pid], "invitation.updated", {"invitation_id": str(res.inserted_id), "status": "pending"}
                )
                wa = await self._send_whatsapp(
                    pid, match, team, user.full_name, item.proposed_role, ctype, data.message
                )
                await self.col.update_one({"_id": res.inserted_id}, {"$set": {"whatsapp_status": wa}})
                results.append(
                    InvitationResultItem(
                        player_id=str(pid), ok=True, invitation_id=str(res.inserted_id), whatsapp_status=wa
                    )
                )
            except AppError as err:
                results.append(
                    InvitationResultItem(player_id=str(pid), ok=False, error_code=err.code, message=err.message)
                )
        if any(r.ok for r in results):
            await self._auto_recruiting(match, user.id)
            await self.c.audit.log(
                actor_id=user.id,
                action="invitations.created",
                entity_type="match",
                entity_id=match_id,
                new_value={"player_ids": [r.player_id for r in results if r.ok]},
                request_id=user.request_id,
            )
        return results

    # ------------------------------------------------------------ player → captain
    async def request_join(self, user: CurrentUser, match_id: ObjectId, data: JoinRequestIn) -> InvitationOut:
        match, team = await self.access.load(match_id)
        if MatchStatus(match["match_status"]) not in lifecycle.DISCOVERABLE:
            raise BusinessRuleViolation("This match is not accepting players", code="MATCH_NOT_RECRUITING")
        if can_manage_match(match, team, user.id):
            raise BusinessRuleViolation("You manage this match", code="SELF_INVITE")
        if match["squad_capacity"] - match.get("confirmed_count", 0) <= 0:
            raise BusinessRuleViolation("This squad is full", code="SQUAD_FULL")
        await self._eligible_player(user.id)
        if await self.c.mongo["match_rosters"].count_documents(
            {"match_id": match_id, "player_id": user.id, "is_active": True}, limit=1
        ):
            raise Conflict("You are already in the squad", code="ALREADY_IN_SQUAD")
        state = await self.avail.status_for_window(user.id, ensure_utc(match["start_at"]), ensure_utc(match["end_at"]))
        if state["state"] == "unavailable":
            raise BusinessRuleViolation("You marked yourself unavailable for this time", code="PLAYER_UNAVAILABLE")
        if await self._double_booked(match, user.id):
            raise BusinessRuleViolation("You are already in another match at this time", code="PLAYER_DOUBLE_BOOKED")
        now = utcnow()
        doc = {
            "match_id": match_id,
            "team_id": match["team_id"],
            "captain_id": match["captain_id"],
            "player_id": user.id,
            "direction": D.REQUEST.value,
            "invitation_status": S.PENDING.value,
            "is_active": True,
            "contribution_type": match.get("default_contribution_type", "payee"),
            "proposed_role": data.proposed_role.value if data.proposed_role else None,
            "message": data.message,
            "is_substitute": False,
            "replaces_player_id": None,
            "availability_state_at_invite": state["state"],
            "invited_by": user.id,
            "invited_at": now,
            "responded_at": None,
            "confirmed_at": None,
            "expires_at": self._expiry(match),
            "status_history": [self._hist(None, "pending", user.id)],
            "updated_at": now,
        }
        try:
            res = await self.col.insert_one(doc)
        except DuplicateKeyError as exc:
            raise Conflict(
                "You already have an active request or invitation for this match", code="DUPLICATE_INVITATION"
            ) from exc
        managers = list({match["captain_id"], *((team or {}).get("admin_ids") or [])})
        await self.c.notifications.notify(
            managers,
            NotificationType.JOIN_REQUEST,
            f"Join request: {match.get('title', 'Match')}",
            f"{user.full_name} wants to join your squad.",
            {"match_id": match_id, "invitation_id": res.inserted_id},
        )
        await self.c.notifications.emit(managers, "invitation.updated", {"invitation_id": str(res.inserted_id)})
        return await self.to_out(await self._get(res.inserted_id), user)

    # ------------------------------------------------------------ responses
    async def accept(self, user: CurrentUser, invitation_id: ObjectId) -> InvitationOut:
        inv = await self._get(invitation_id)
        if inv["player_id"] != user.id or inv["direction"] != D.INVITE:
            raise NotFound("Invitation not found")
        if inv["invitation_status"] == S.PENDING and ensure_utc(inv["expires_at"]) <= utcnow():
            await self._transition(inv, S.EXPIRED, user.id)
            raise BusinessRuleViolation("This invitation has expired", code="INVITATION_EXPIRED")
        match, _ = await self.access.load(inv["match_id"])
        if MatchStatus(match["match_status"]) in lifecycle.TERMINAL:
            raise BusinessRuleViolation("This match is no longer open", code="MATCH_CLOSED")
        if await self._double_booked(match, user.id):
            raise BusinessRuleViolation("You are already in another match at this time", code="PLAYER_DOUBLE_BOOKED")
        await self._transition(inv, S.ACCEPTED, user.id)
        await self.c.mongo["player_profiles"].update_one(
            {"user_id": user.id}, {"$inc": {"stats.invitations_responded": 1}}
        )
        await self.c.notifications.notify(
            [inv["captain_id"]],
            NotificationType.INVITATION_ACCEPTED,
            f"{user.full_name} accepted",
            f"Confirm them for {match.get('title', 'the match')}.",
            {"match_id": inv["match_id"], "invitation_id": invitation_id},
        )
        await self.c.notifications.emit(
            [inv["captain_id"], user.id],
            "invitation.updated",
            {"invitation_id": str(invitation_id), "status": "accepted"},
        )
        return await self.to_out(await self._get(invitation_id), user)

    async def reject(self, user: CurrentUser, invitation_id: ObjectId, reason: str | None) -> InvitationOut:
        inv = await self._get(invitation_id)
        match, team = await self.access.load(inv["match_id"])
        if inv["direction"] == D.INVITE:
            if inv["player_id"] != user.id:
                raise NotFound("Invitation not found")
            notify_to, ntype = [inv["captain_id"]], NotificationType.INVITATION_REJECTED
            await self.c.mongo["player_profiles"].update_one(
                {"user_id": user.id}, {"$inc": {"stats.invitations_responded": 1}}
            )
        else:
            ensure_match_manager(match, team, user.id)
            notify_to, ntype = [inv["player_id"]], NotificationType.INVITATION_REJECTED
        await self._transition(inv, S.REJECTED, user.id, reason)
        await self.c.notifications.notify(
            notify_to,
            ntype,
            f"{'Invitation' if inv['direction'] == D.INVITE else 'Join request'} declined",
            f"{match.get('title', 'Match')}{': ' + reason if reason else ''}",
            {"match_id": inv["match_id"], "invitation_id": invitation_id},
        )
        await self.c.notifications.emit(
            notify_to + [user.id], "invitation.updated", {"invitation_id": str(invitation_id), "status": "rejected"}
        )
        return await self.to_out(await self._get(invitation_id), user)

    async def cancel(self, user: CurrentUser, invitation_id: ObjectId, reason: str | None) -> InvitationOut:
        inv = await self._get(invitation_id)
        match, team = await self.access.load(inv["match_id"])
        is_manager = can_manage_match(match, team, user.id)
        is_own_request = inv["direction"] == D.REQUEST and inv["player_id"] == user.id
        if not (is_manager or is_own_request):
            raise Forbidden("You cannot cancel this invitation", code="NOT_ALLOWED")
        if inv["invitation_status"] == S.CONFIRMED:
            raise BusinessRuleViolation(
                "Use roster removal or withdrawal for confirmed players", code="USE_ROSTER_ACTION"
            )
        await self._transition(inv, S.CANCELLED, user.id, reason)
        other = inv["player_id"] if is_manager else inv["captain_id"]
        await self.c.notifications.notify(
            [other],
            NotificationType.INVITATION_CANCELLED,
            "Invitation cancelled",
            f"{match.get('title', 'Match')}{': ' + reason if reason else ''}",
            {"match_id": inv["match_id"], "invitation_id": invitation_id},
        )
        await self.c.notifications.emit(
            [other, user.id], "invitation.updated", {"invitation_id": str(invitation_id), "status": "cancelled"}
        )
        return await self.to_out(await self._get(invitation_id), user)

    async def confirm(self, user: CurrentUser, invitation_id: ObjectId) -> InvitationOut:
        """Captain confirms an accepted invite or approves a join request (capacity-guarded)."""
        inv = await self._get(invitation_id)
        match, team = await self.access.load(inv["match_id"])
        ensure_match_manager(match, team, user.id)
        if MatchStatus(match["match_status"]) not in lifecycle.ROSTER_MUTABLE:
            raise BusinessRuleViolation("The squad can no longer change", code="ROSTER_LOCKED")
        if (
            inv["direction"] == D.REQUEST
            and inv["invitation_status"] == S.PENDING
            and ensure_utc(inv["expires_at"]) <= utcnow()
        ):
            await self._transition(inv, S.EXPIRED, user.id)
            raise BusinessRuleViolation("This join request has expired", code="INVITATION_EXPIRED")
        sm.ensure_transition(inv["invitation_status"], S.CONFIRMED, inv["direction"])
        prof = await self.c.mongo["player_profiles"].find_one({"user_id": inv["player_id"]}, {"primary_role": 1})
        role = inv.get("proposed_role") or (prof or {}).get("primary_role")
        now = utcnow()

        async def txn(s: AsyncClientSession) -> None:
            m = await self.c.mongo["matches"].find_one_and_update(
                {
                    "_id": match["_id"],
                    "$expr": {"$lt": ["$confirmed_count", "$squad_capacity"]},
                    "match_status": {"$in": [st.value for st in lifecycle.ROSTER_MUTABLE]},
                },
                {"$inc": {"confirmed_count": 1}, "$set": {"updated_at": now}},
                session=s,
            )
            if not m:
                raise BusinessRuleViolation("The squad is already full", code="SQUAD_FULL")
            if await self._double_booked(match, inv["player_id"], s):
                raise BusinessRuleViolation(
                    "Player is already confirmed in another match at this time", code="PLAYER_DOUBLE_BOOKED"
                )
            await self._transition(inv, S.CONFIRMED, user.id, s=s)
            try:
                await self.c.mongo["match_rosters"].insert_one(
                    {
                        "match_id": match["_id"],
                        "player_id": inv["player_id"],
                        "assigned_role": role,
                        "contribution_type": inv["contribution_type"],
                        "status": RosterStatus.CONFIRMED.value,
                        "is_active": True,
                        "is_captain": False,
                        "source": inv["direction"],
                        "invitation_id": inv["_id"],
                        "is_substitute": inv.get("is_substitute", False),
                        "replaces_player_id": inv.get("replaces_player_id"),
                        "joined_at": now,
                        "updated_at": now,
                    },
                    session=s,
                )
            except DuplicateKeyError as exc:
                raise Conflict("Player is already in the squad", code="ALREADY_IN_SQUAD") from exc
            await self.c.audit.log(
                actor_id=user.id,
                action="roster.player_confirmed",
                entity_type="match",
                entity_id=match["_id"],
                new_value={"player_id": inv["player_id"], "invitation_id": inv["_id"]},
                request_id=user.request_id,
                session=s,
            )

        await self.c.mongo.transaction(txn)
        await self.c.notifications.notify(
            [inv["player_id"]],
            NotificationType.MATCH_CONFIRMED,
            f"You're in: {match.get('title', 'Match')}",
            f"{user.full_name} confirmed your place in the squad.",
            {"match_id": match["_id"], "invitation_id": invitation_id},
        )
        await self.c.notifications.emit([inv["player_id"], user.id], "roster.updated", {"match_id": str(match["_id"])})
        return await self.to_out(await self._get(invitation_id), user)

    # ------------------------------------------------------------ queries
    async def to_out(
        self, inv: dict[str, Any], viewer: CurrentUser, cache: dict[ObjectId, Any] | None = None
    ) -> InvitationOut:
        cache = cache if cache is not None else {}

        async def user_doc(uid: ObjectId) -> dict[str, Any]:
            if uid not in cache:
                cache[uid] = await self.c.mongo["users"].find_one({"_id": uid}) or {"_id": uid, "full_name": "Player"}
            return dict(cache[uid])

        mkey = ("m", inv["match_id"])
        if mkey not in cache:
            m = await self.c.mongo["matches"].find_one({"_id": inv["match_id"]})
            t = await self.c.mongo["teams"].find_one({"_id": m["team_id"]}) if m else None
            cache[mkey] = (m, t)  # type: ignore[index]
        match, team = cache[mkey]  # type: ignore[index]
        status = S(inv["invitation_status"])
        if status == S.PENDING and ensure_utc(inv["expires_at"]) <= utcnow():
            status = S.EXPIRED
        is_player = inv["player_id"] == viewer.id
        is_manager = can_manage_match(match, team, viewer.id)
        invite = inv["direction"] == D.INVITE
        availability_state = None
        if is_manager and status in (S.PENDING, S.ACCEPTED):
            availability_state = (
                await self.avail.status_for_window(
                    inv["player_id"], ensure_utc(match["start_at"]), ensure_utc(match["end_at"])
                )
            )["state"]
        venue = match.get("venue") or {}
        return InvitationOut(
            id=str(inv["_id"]),
            direction=inv["direction"],
            invitation_status=status,
            contribution_type=inv["contribution_type"],
            proposed_role=inv.get("proposed_role"),
            message=inv.get("message"),
            is_substitute=inv.get("is_substitute", False),
            player=public_user(await user_doc(inv["player_id"])),
            captain=public_user(await user_doc(inv["captain_id"])),
            match=MatchBriefOut(
                id=str(match["_id"]),
                match_code=match["match_code"],
                title=match.get("title", "Match"),
                team_name=(team or {}).get("team_name", "Team"),
                team_logo=(team or {}).get("logo"),
                start_at=match["start_at"],
                end_at=match["end_at"],
                timezone=match["timezone"],
                format=match["format"],
                category=match["category"],
                area=venue.get("area"),
                city=venue.get("city"),
                match_status=match["match_status"],
                per_head_fee_paise=match.get("per_head_fee_paise", 0),
                venue_name=venue.get("name"),
            ),
            availability_state=availability_state,
            invited_at=inv["invited_at"],
            responded_at=inv.get("responded_at"),
            confirmed_at=inv.get("confirmed_at"),
            expires_at=inv["expires_at"],
            can_accept=invite and is_player and status == S.PENDING,
            can_reject=status == S.PENDING and ((invite and is_player) or (not invite and is_manager)),
            can_cancel=status in (S.PENDING, S.ACCEPTED) and (is_manager or (not invite and is_player)),
            can_confirm=is_manager and ((invite and status == S.ACCEPTED) or (not invite and status == S.PENDING)),
            whatsapp_status=inv.get("whatsapp_status") if is_manager else None,
            can_chat=status in (S.ACCEPTED, S.CONFIRMED) and (is_player or inv["captain_id"] == viewer.id),
        )

    async def _send_whatsapp(
        self,
        pid: ObjectId,
        match: dict[str, Any],
        team: dict[str, Any] | None,
        captain_name: str,
        role: Any,
        ctype: ContributionType,
        note: str | None,
    ) -> str:
        """WhatsApp copy of a match invitation — only to players who opted in, and only via a configured provider."""
        player = await self.c.mongo["users"].find_one(
            {"_id": pid}, {"mobile_number": 1, "notification_prefs": 1, "mobile_verified": 1, "verified_via": 1}
        )
        if not player or not (player.get("notification_prefs") or {}).get("whatsapp"):
            return "opted_out"
        if not player.get("mobile_number") or (
            player.get("verified_via") == "email" and not player.get("mobile_verified")
        ):
            return "no_number"  # an unproven number from email sign-up is never messaged
        if not self.c.whatsapp.configured:
            return "not_configured"
        tz = ZoneInfo(match.get("timezone") or "Asia/Kolkata")
        start = ensure_utc(match["start_at"]).astimezone(tz)
        venue = match.get("venue") or {}
        where = ", ".join(x for x in (venue.get("name"), venue.get("area")) if x) or "Venue to be confirmed"
        fee = match.get("per_head_fee_paise", 0)
        lines = [
            f"{captain_name} invited you to play for {(team or {}).get('team_name', 'their team')}",
            match.get("title", "Match"),
            start.strftime("%a %d %b, %I:%M %p").replace(" 0", " "),
            where,
            f"{match.get('format', '')} · {str(role.value).replace('_', '-').title() if role else 'Any role'}",
            f"About Rs {fee // 100} per head" if fee and ctype == ContributionType.PAYEE else "No fee for you",
        ]
        link = f"{(self.c.settings.app_base_url or self.c.settings.web_base_url).rstrip('/')}/match/{match['_id']}"
        body = "\n".join(
            [
                "🏏 GoFindr match invitation",
                *lines,
                *([f'Note: "{note}"'] if note else []),
                f"Accept or decline in the GoFindr app: {link}",
            ]
        )
        return await self.c.whatsapp.send(player["mobile_number"], body, [*lines, link])

    async def list_mine(
        self, user: CurrentUser, box: Literal["received", "sent", "all"], status: S | None, params: PageParams
    ) -> tuple[list[InvitationOut], int]:
        q: dict[str, Any] = {"player_id": user.id}
        if box == "received":
            q["direction"] = D.INVITE.value
        elif box == "sent":
            q["direction"] = D.REQUEST.value
        if status:
            q["invitation_status"] = status.value
        total = await self.col.count_documents(q)
        cache: dict[ObjectId, Any] = {}
        items = [
            await self.to_out(i, user, cache)
            async for i in self.col.find(q).sort("invited_at", -1).skip(params.skip).limit(params.page_size)
        ]
        return items, total

    async def list_for_captain(
        self, user: CurrentUser, direction: D | None, status: S | None, params: PageParams
    ) -> tuple[list[InvitationOut], int]:
        """Join requests / invitations across all matches the user manages."""
        team_ids = [
            t["_id"]
            async for t in self.c.mongo["teams"].find(
                {"$or": [{"captain_id": user.id}, {"admin_ids": user.id}]}, {"_id": 1}
            )
        ]
        q: dict[str, Any] = {"$or": [{"captain_id": user.id}, {"team_id": {"$in": team_ids}}]}
        if direction:
            q["direction"] = direction.value
        if status:
            q["invitation_status"] = status.value
        total = await self.col.count_documents(q)
        cache: dict[ObjectId, Any] = {}
        items = [
            await self.to_out(i, user, cache)
            async for i in self.col.find(q).sort("invited_at", -1).skip(params.skip).limit(params.page_size)
        ]
        return items, total

    async def list_for_match(self, user: CurrentUser, match_id: ObjectId, status: S | None) -> list[InvitationOut]:
        await self.access.load_managed(match_id, user)
        q: dict[str, Any] = {"match_id": match_id}
        if status:
            q["invitation_status"] = status.value
        cache: dict[ObjectId, Any] = {}
        return [await self.to_out(i, user, cache) async for i in self.col.find(q).sort("invited_at", -1)]

    async def expire_due(self) -> int:
        """Scheduler: mark overdue pending invitations as expired."""
        now = utcnow()
        n = 0
        async for inv in self.col.find({"invitation_status": S.PENDING.value, "expires_at": {"$lte": now}}).limit(500):
            res = await self.col.update_one(
                {"_id": inv["_id"], "invitation_status": S.PENDING.value},
                {
                    "$set": {"invitation_status": S.EXPIRED.value, "is_active": False, "updated_at": now},
                    "$push": {"status_history": self._hist("pending", "expired", None, "ttl")},
                },
            )
            n += res.modified_count
        return n
