"""Captain invite links: "add yourself to the squad" links a captain shares in the team's WhatsApp group.

Flow: captain creates (or reuses) a link for a match → shares it → a player opens /join/<code>, registers if new
(password account; mobile marked as not verified, verified_via="captain_invite") → accepts the agreement →
taps "Add me": we add them to the team (captain invite + player accept) and to the match squad (join request +
captain confirm). The usual guards still apply: squad capacity, double booking, explicit unavailability.
Links are secret, expire when the match ends, have a use limit and can be revoked.
"""

import secrets
from typing import Any
from zoneinfo import ZoneInfo

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.enums import AccountStatus, MatchStatus, Role
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, NotFound
from app.core.security import hash_secret
from app.modules.auth.schemas import TokenOut
from app.modules.auth.service import AuthService
from app.modules.invitations.schemas import JoinRequestIn
from app.modules.invitations.service import InvitationService
from app.modules.joinlinks.schemas import InviteLinkOut, InviteRegisterIn, JoinIn, JoinPreviewOut, JoinResultOut
from app.modules.matches import lifecycle
from app.modules.matches.service import MatchAccess
from app.modules.teams.policy import ensure_match_manager
from app.modules.teams.schemas import AddMemberIn
from app.modules.teams.service import TeamService

MAX_USES = 40
ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"


def _code() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(10))


def _as_current_user(doc: dict[str, Any]) -> CurrentUser:
    return CurrentUser(
        id=doc["_id"],
        roles=list(doc.get("roles", [])),
        account_status=doc.get("account_status", AccountStatus.ACTIVE.value),
        full_name=doc.get("full_name", ""),
        doc=doc,
    )


class JoinLinkService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["match_invite_links"]
        self.access = MatchAccess(c)

    # ---------------------------------------------------------------- captain side
    def _base(self) -> str | None:
        s = self.c.settings
        base = s.app_base_url or None
        return base.rstrip("/") if base else None

    async def _out(self, link: dict[str, Any], match: dict[str, Any], team: dict[str, Any] | None) -> InviteLinkOut:
        joined_ids = link.get("joined_ids") or []
        by_id = {
            u["_id"]: u["full_name"]
            async for u in self.c.mongo["users"].find({"_id": {"$in": joined_ids}}, {"full_name": 1})
        }
        names = [by_id[i] for i in joined_ids if i in by_id]  # in the order they joined
        path = f"/join/{link['code']}"
        base = self._base()
        url = f"{base}{path}" if base else None
        venue = (match.get("venue") or {}).get("name") or (match.get("venue") or {}).get("area") or ""
        when = (
            ensure_utc(match["start_at"])
            .astimezone(ZoneInfo(match.get("timezone") or "Asia/Kolkata"))
            .strftime("%a %d %b, %I:%M %p")
        )
        team_name = (team or {}).get("team_name", "our team")
        # The group sees the whole confirmed squad (captain first, then in the order people were confirmed),
        # not only the people who came through this link.
        rows = [
            r
            async for r in self.c.mongo["match_rosters"]
            .find({"match_id": match["_id"], "is_active": True}, {"player_id": 1, "is_captain": 1})
            .sort([("is_captain", -1), ("_id", 1)])
        ]
        squad_ids = [r["player_id"] for r in rows]
        squad_names = {
            u["_id"]: u["full_name"]
            async for u in self.c.mongo["users"].find({"_id": {"$in": squad_ids}}, {"full_name": 1})
        }
        squad = [
            f"{squad_names[r['player_id']]}{' (C)' if r.get('is_captain') else ''}"
            for r in rows
            if r["player_id"] in squad_names
        ]
        roster = "".join(f"\n{i}) {n}" for i, n in enumerate(squad, 1))
        message = (
            f"🏏 {team_name} — {match.get('title', 'Match')}\n"
            f"📅 {when}{f' · 📍 {venue}' if venue else ''}\n"
            f"{'In so far:' + roster + chr(10) + chr(10) + '──────────' + chr(10) + chr(10) if squad else ''}"
            "Tap to join the squad. First come, first served 👇"
        )  # the client appends the link (it knows the current public address)
        return InviteLinkOut(
            code=link["code"],
            path=path,
            url=url,
            message=message,
            expires_at=link["expires_at"],
            uses=link.get("uses", 0),
            max_uses=link.get("max_uses", MAX_USES),
            active=link.get("active", True),
            joined=names,
        )

    async def get_or_create(self, user: CurrentUser, match_id: ObjectId, rotate: bool = False) -> InviteLinkOut:
        match, team = await self.access.load(match_id)
        ensure_match_manager(match, team, user.id)
        if MatchStatus(match["match_status"]) in lifecycle.TERMINAL:
            raise BusinessRuleViolation("This match is closed", code="MATCH_CLOSED")
        now = utcnow()
        if rotate:
            await self.col.update_many(
                {"match_id": match_id, "active": True}, {"$set": {"active": False, "revoked_at": now}}
            )
        link = await self.col.find_one({"match_id": match_id, "active": True, "expires_at": {"$gt": now}})
        if not link:
            link = {
                "code": _code(),
                "match_id": match_id,
                "team_id": match["team_id"],
                "created_by": user.id,
                "created_at": now,
                "expires_at": ensure_utc(match["end_at"]),
                "max_uses": MAX_USES,
                "uses": 0,
                "joined_ids": [],
                "active": True,
            }
            link["_id"] = (await self.col.insert_one(link)).inserted_id
        return await self._out(link, match, team)

    async def revoke(self, user: CurrentUser, match_id: ObjectId) -> None:
        match, team = await self.access.load(match_id)
        ensure_match_manager(match, team, user.id)
        await self.col.update_many(
            {"match_id": match_id, "active": True}, {"$set": {"active": False, "revoked_at": utcnow()}}
        )

    # ---------------------------------------------------------------- player side
    async def _link(self, code: str) -> dict[str, Any]:
        link = await self.col.find_one({"code": code})
        if not link:
            raise NotFound("This invite link isn't valid", code="INVITE_NOT_FOUND")
        return link

    @staticmethod
    def _state(link: dict[str, Any], match: dict[str, Any]) -> str:
        if not link.get("active") or MatchStatus(match["match_status"]) in lifecycle.TERMINAL:
            return "closed"
        if ensure_utc(link["expires_at"]) <= utcnow() or link.get("uses", 0) >= link.get("max_uses", MAX_USES):
            return "expired"
        if match["squad_capacity"] - match.get("confirmed_count", 0) <= 0:
            return "full"
        return "open"

    async def preview(self, code: str) -> JoinPreviewOut:
        link = await self._link(code)
        match = await self.c.mongo["matches"].find_one({"_id": link["match_id"]})
        team = await self.c.mongo["teams"].find_one({"_id": link["team_id"]})
        if not match or not team:
            raise NotFound("This invite link isn't valid", code="INVITE_NOT_FOUND")
        captain = await self.c.mongo["users"].find_one({"_id": match["captain_id"]}, {"full_name": 1})
        venue = match.get("venue") or {}
        return JoinPreviewOut(
            team_name=team["team_name"],
            captain_name=(captain or {}).get("full_name", "Captain"),
            match_title=match.get("title", "Match"),
            start_at=match["start_at"],
            end_at=match["end_at"],
            timezone=match.get("timezone", "Asia/Kolkata"),
            area=venue.get("area"),  # area only — exact venue is shared once in the squad
            city=venue.get("city"),
            format=match.get("format", ""),
            capacity=match["squad_capacity"],
            confirmed=match.get("confirmed_count", 0),
            spots_left=max(0, match["squad_capacity"] - match.get("confirmed_count", 0)),
            status=self._state(link, match),
        )

    async def join(self, user: CurrentUser, code: str, data: JoinIn) -> JoinResultOut:
        link = await self._link(code)
        match, team = await self.access.load(link["match_id"])
        if not team:
            raise NotFound("Team not found")
        state = self._state(link, match)
        in_squad = await self.c.mongo["match_rosters"].count_documents(
            {"match_id": match["_id"], "player_id": user.id, "is_active": True}, limit=1
        )
        out = JoinResultOut(
            status="already_in",
            match_id=str(match["_id"]),
            team_id=str(team["_id"]),
            team_name=team["team_name"],
            match_title=match.get("title", "Match"),
        )
        if in_squad:
            return out
        if state == "closed":
            raise BusinessRuleViolation("The captain has closed this invite link", code="INVITE_CLOSED")
        if state == "expired":
            raise BusinessRuleViolation(
                "This invite link has expired — ask your captain for a new one", code="INVITE_EXPIRED"
            )
        if state == "full":
            raise BusinessRuleViolation("The squad is already full", code="SQUAD_FULL")
        if match["captain_id"] == user.id:
            raise BusinessRuleViolation("You're the captain of this match", code="SELF_INVITE")
        captain_doc = await self.c.mongo["users"].find_one({"_id": match["captain_id"]})
        assert captain_doc
        captain = _as_current_user(captain_doc)

        # 1) team membership (captain invite → player accept), skipped if already active
        teams = TeamService(self.c)
        member = await self.c.mongo["team_members"].find_one({"team_id": team["_id"], "user_id": user.id})
        if not member or member.get("status") != "active":
            if not member or member.get("status") not in ("invited",):
                try:
                    await teams.add_member(captain, team["_id"], AddMemberIn(user_id=str(user.id)))
                except (Conflict, BusinessRuleViolation):
                    pass  # e.g. a pending join request already exists — accepting below still works
            try:
                await teams.respond_membership(user, team["_id"], accept=True)
            except (Conflict, BusinessRuleViolation, NotFound):
                pass  # membership is nice-to-have; the squad place below is what matters

        # 2) squad place (join request → captain confirm)
        invites = InvitationService(self.c)
        existing = await invites.col.find_one({"match_id": match["_id"], "player_id": user.id, "is_active": True})
        if existing:
            inv_id = existing["_id"]
        else:
            note = "Joined via the captain's invite link"
            inv_id = ObjectId(
                (
                    await invites.request_join(
                        user, match["_id"], JoinRequestIn(proposed_role=data.proposed_role, message=note)
                    )
                ).id
            )
        await invites.confirm(captain, inv_id)

        await self.col.update_one({"_id": link["_id"]}, {"$inc": {"uses": 1}, "$addToSet": {"joined_ids": user.id}})
        out.status = "joined"
        return out

    async def register(self, data: InviteRegisterIn, user_agent: str | None) -> TokenOut:
        """New player via a valid invite link: password account, mobile NOT verified (honestly flagged)."""
        link = await self._link(data.code)
        match = await self.c.mongo["matches"].find_one({"_id": link["match_id"]})
        if not match or self._state(link, match) in ("closed", "expired"):
            raise BusinessRuleViolation("This invite link is no longer active", code="INVITE_EXPIRED")
        users = self.c.mongo["users"]
        email = str(data.email).lower()
        existing = await users.find_one({"mobile_number": data.mobile_number})
        if existing and (existing.get("mobile_verified") or existing.get("verified_via")):
            raise BusinessRuleViolation(
                "This mobile number already has an account — log in instead", code="ACCOUNT_EXISTS"
            )
        other = await users.find_one({"email": email})
        if other and (not existing or other["_id"] != existing["_id"]):
            raise BusinessRuleViolation("This email already has an account — log in instead", code="ACCOUNT_EXISTS")
        now = utcnow()
        fields: dict[str, Any] = {
            "full_name": data.full_name,
            "mobile_number": data.mobile_number,
            "email": email,
            "email_verified": False,
            "mobile_verified": False,
            "verified_via": "captain_invite",
            "invite_code": data.code,
            "password_hash": hash_secret(data.password),
            "profile_image": None,
            "roles": [Role.PLAYER.value],
            "city": data.city,
            "timezone": "Asia/Kolkata",
            "account_status": AccountStatus.ACTIVE.value,
            "notification_prefs": {"in_app": True, "push": True, "email": False, "muted_types": []},
            "agreement_version_accepted": None,
            "updated_at": now,
        }
        try:
            if existing:
                await users.update_one({"_id": existing["_id"]}, {"$set": fields})
                doc = await users.find_one({"_id": existing["_id"]})
            else:
                res = await users.insert_one({**fields, "created_at": now})
                doc = await users.find_one({"_id": res.inserted_id})
        except DuplicateKeyError as exc:
            raise BusinessRuleViolation(
                "This mobile or email already has an account — log in instead", code="ACCOUNT_EXISTS"
            ) from exc
        assert doc
        await self.c.audit.log(
            actor_id=doc["_id"],
            action="user.registered_via_invite",
            entity_type="user",
            entity_id=doc["_id"],
            new_value={"invite_code": data.code},
        )
        return await AuthService(self.c)._issue_tokens(doc, user_agent, family_id=None)
