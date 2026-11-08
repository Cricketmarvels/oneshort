import re
from typing import Any, Literal

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.enums import MatchStatus, NotificationType, TeamMemberRole
from app.common.response import PageParams
from app.common.types import utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, NotFound, ValidationFailed
from app.modules.captains.service import CaptainService
from app.modules.teams.policy import can_manage_team, ensure_team_captain, ensure_team_manager
from app.modules.teams.schemas import (
    AddMemberIn,
    TeamIn,
    TeamMemberOut,
    TeamOut,
    TeamUpdateIn,
    UpcomingMatchBrief,
)
from app.modules.users.schemas import public_user

OPEN_STATUSES = [MatchStatus.PUBLISHED, MatchStatus.RECRUITING]
UPCOMING_STATUSES = [MatchStatus.PUBLISHED, MatchStatus.RECRUITING, MatchStatus.SQUAD_CONFIRMED, MatchStatus.SCHEDULED]


def match_brief(m: dict[str, Any]) -> UpcomingMatchBrief:
    return UpcomingMatchBrief(
        id=str(m["_id"]),
        match_code=m["match_code"],
        title=m.get("title", "Match"),
        start_at=m["start_at"],
        end_at=m["end_at"],
        format=m["format"],
        category=m["category"],
        area=(m.get("venue") or {}).get("area"),
        vacancies=max(0, m["squad_capacity"] - m.get("confirmed_count", 0)),
        required_roles=m.get("required_roles") or {},
        per_head_fee_paise=m.get("per_head_fee_paise", 0),
        match_status=m["match_status"],
    )


class TeamService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.teams = c.mongo["teams"]
        self.members = c.mongo["team_members"]

    async def get_team(self, team_id: ObjectId) -> dict[str, Any]:
        team = await self.teams.find_one({"_id": team_id})
        if not team or team.get("team_status") == "archived":
            raise NotFound("Team not found")
        return team

    async def create(self, user: CurrentUser, data: TeamIn) -> TeamOut:
        await CaptainService(self.c).ensure_profile(user.id)
        now = utcnow()
        doc: dict[str, Any] = {
            "team_name": data.team_name,
            "slug": re.sub(r"[^a-z0-9]+", "-", data.team_name.lower()).strip("-"),
            "logo": data.logo,
            "description": data.description,
            "location": data.location.to_geojson(),
            "area": data.area,
            "city": data.city,
            "category": data.category.value,
            "looking_for_opponents": data.looking_for_opponents,
            "preferred_formats": [f.value for f in data.preferred_formats],
            "captain_id": user.id,
            "admin_ids": [],
            "member_count": 1,
            "team_status": "active",
            "average_rating": None,
            "created_at": now,
            "updated_at": now,
        }

        async def txn(s: AsyncClientSession) -> ObjectId:
            res = await self.teams.insert_one(doc, session=s)
            await self.members.insert_one(
                {
                    "team_id": res.inserted_id,
                    "user_id": user.id,
                    "member_role": TeamMemberRole.CAPTAIN,
                    "status": "active",
                    "joined_at": now,
                    "updated_at": now,
                },
                session=s,
            )
            await self.c.audit.log(
                actor_id=user.id,
                action="team.created",
                entity_type="team",
                entity_id=res.inserted_id,
                new_value={"team_name": data.team_name},
                request_id=user.request_id,
                session=s,
            )
            return ObjectId(res.inserted_id)

        team_id = await self.c.mongo.transaction(txn)
        return await self.get_out(team_id, user)

    async def update(self, user: CurrentUser, team_id: ObjectId, data: TeamUpdateIn) -> TeamOut:
        team = await self.get_team(team_id)
        ensure_team_manager(team, user.id)
        fields = data.model_dump(exclude_unset=True, mode="json", exclude={"location"})
        if data.location is not None:
            fields["location"] = data.location.to_geojson()
        if not fields:
            raise ValidationFailed("Nothing to update")
        fields["updated_at"] = utcnow()
        await self.teams.update_one({"_id": team_id}, {"$set": fields})
        await self.c.audit.log(
            actor_id=user.id,
            action="team.updated",
            entity_type="team",
            entity_id=team_id,
            previous_value={k: team.get(k) for k in fields},
            new_value=fields,
            request_id=user.request_id,
        )
        return await self.get_out(team_id, user)

    async def get_out(self, team_id: ObjectId, user: CurrentUser) -> TeamOut:
        team = await self.get_team(team_id)
        captain = await self.c.mongo["users"].find_one({"_id": team["captain_id"]}) or {
            "_id": team["captain_id"],
            "full_name": "Captain",
        }
        cap_prof = await self.c.mongo["captain_profiles"].find_one({"user_id": team["captain_id"]}) or {}
        membership = await self.members.find_one({"team_id": team_id, "user_id": user.id})
        my = None
        if membership and membership["status"] in ("active", "invited", "requested"):
            my = membership["member_role"] if membership["status"] == "active" else membership["status"]
        upcoming = [
            match_brief(m)
            async for m in self.c.mongo["matches"]
            .find({"team_id": team_id, "match_status": {"$in": UPCOMING_STATUSES}, "start_at": {"$gte": utcnow()}})
            .sort("start_at", 1)
            .limit(5)
        ]
        return TeamOut(
            id=str(team["_id"]),
            team_name=team["team_name"],
            logo=team.get("logo"),
            description=team.get("description"),
            area=team.get("area"),
            city=team.get("city"),
            category=team["category"],
            captain=public_user(captain),
            captain_rating=cap_prof.get("average_rating"),
            member_count=team.get("member_count", 0),
            average_rating=team.get("average_rating"),
            team_status=team["team_status"],
            my_membership=my,
            can_manage=can_manage_team(team, user.id),
            looking_for_opponents=team.get("looking_for_opponents", True),
            preferred_formats=team.get("preferred_formats") or [],
            upcoming_matches=upcoming,
            created_at=team["created_at"],
        )

    async def list_teams(
        self, user: CurrentUser, scope: Literal["mine", "member", "all"], q: str | None, params: PageParams
    ) -> tuple[list[TeamOut], int]:
        query: dict[str, Any] = {"team_status": "active"}
        if scope == "mine":
            query["$or"] = [{"captain_id": user.id}, {"admin_ids": user.id}]
        elif scope == "member":
            ids = [
                m["team_id"] async for m in self.members.find({"user_id": user.id, "status": "active"}, {"team_id": 1})
            ]
            query["_id"] = {"$in": ids}
        if q:
            query["team_name"] = {"$regex": re.escape(q[:60]), "$options": "i"}
        total = await self.teams.count_documents(query)
        cursor = self.teams.find(query, {"_id": 1}).sort("created_at", -1).skip(params.skip).limit(params.page_size)
        out = [await self.get_out(t["_id"], user) async for t in cursor]
        return out, total

    # ------------------------------------------------------------ membership
    async def list_members(
        self, user: CurrentUser, team_id: ObjectId, q: str | None, role: str | None
    ) -> list[TeamMemberOut]:
        team = await self.get_team(team_id)
        statuses = ["active", "invited"] if can_manage_team(team, user.id) else ["active"]
        rows = [m async for m in self.members.find({"team_id": team_id, "status": {"$in": statuses}})]
        uids = [r["user_id"] for r in rows]
        users = {
            u["_id"]: u
            async for u in self.c.mongo["users"].find({"_id": {"$in": uids}, "account_status": {"$ne": "deleted"}})
        }
        profs = {p["user_id"]: p async for p in self.c.mongo["player_profiles"].find({"user_id": {"$in": uids}})}
        out: list[TeamMemberOut] = []
        for r in rows:
            u = users.get(r["user_id"])
            if not u:
                continue
            p = profs.get(r["user_id"], {})
            if q and q.lower() not in u["full_name"].lower():
                continue
            if role and p.get("primary_role") != role and role not in (p.get("secondary_roles") or []):
                continue
            out.append(
                TeamMemberOut(
                    user=public_user(u),
                    member_role=r["member_role"],
                    status=r["status"],
                    primary_role=p.get("primary_role"),
                    average_rating=p.get("average_rating"),
                    reliability_score=p.get("reliability_score"),
                    joined_at=r.get("joined_at"),
                )
            )
        order = {"captain": 0, "admin": 1, "member": 2}
        out.sort(key=lambda m: (m.status != "active", order.get(m.member_role, 3), m.user.full_name))
        return out

    async def add_member(self, user: CurrentUser, team_id: ObjectId, data: AddMemberIn) -> None:
        team = await self.get_team(team_id)
        ensure_team_manager(team, user.id)
        if data.member_role == TeamMemberRole.CAPTAIN:
            raise ValidationFailed("A team has exactly one captain")
        if data.member_role == TeamMemberRole.ADMIN:
            ensure_team_captain(team, user.id)
        if data.user_id:
            target = await self.c.mongo["users"].find_one({"_id": ObjectId(data.user_id)})
        elif data.mobile_number:
            target = await self.c.mongo["users"].find_one({"mobile_number": data.mobile_number})
        else:
            raise ValidationFailed("Provide user_id or mobile_number")
        if not target or target.get("account_status") == "deleted":
            raise NotFound("No player found. Ask them to register first.", code="USER_NOT_FOUND")
        existing = await self.members.find_one({"team_id": team_id, "user_id": target["_id"]})
        if existing and existing["status"] in ("active", "invited"):
            raise Conflict("Player is already a member or invited", code="ALREADY_MEMBER")
        now = utcnow()
        try:
            await self.members.update_one(
                {"team_id": team_id, "user_id": target["_id"]},
                {
                    "$set": {
                        "member_role": data.member_role,
                        "status": "invited",
                        "invited_by": user.id,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"joined_at": None},
                },
                upsert=True,
            )
        except DuplicateKeyError as exc:
            raise Conflict("Player is already a member", code="ALREADY_MEMBER") from exc
        await self.c.audit.log(
            actor_id=user.id,
            action="team.member_invited",
            entity_type="team",
            entity_id=team_id,
            new_value={"user_id": target["_id"]},
            request_id=user.request_id,
        )
        await self.c.notifications.notify(
            [target["_id"]],
            NotificationType.TEAM_INVITATION,
            f"Join {team['team_name']}",
            f"{user.full_name} invited you to join {team['team_name']}.",
            {"team_id": team_id},
        )

    async def respond_membership(self, user: CurrentUser, team_id: ObjectId, accept: bool) -> None:
        team = await self.get_team(team_id)
        now = utcnow()

        async def txn(s: AsyncClientSession) -> None:
            res = await self.members.update_one(
                {"team_id": team_id, "user_id": user.id, "status": "invited"},
                {
                    "$set": {
                        "status": "active" if accept else "left",
                        "joined_at": now if accept else None,
                        "updated_at": now,
                    }
                },
                session=s,
            )
            if res.modified_count == 0:
                raise NotFound("No pending team invitation", code="NO_PENDING_INVITE")
            if accept:
                m = await self.members.find_one({"team_id": team_id, "user_id": user.id}, session=s)
                upd: dict[str, Any] = {"$inc": {"member_count": 1}}
                if m and m["member_role"] == TeamMemberRole.ADMIN:
                    upd["$addToSet"] = {"admin_ids": user.id}
                await self.teams.update_one({"_id": team_id}, upd, session=s)

        await self.c.mongo.transaction(txn)
        await self.c.notifications.notify(
            [team["captain_id"]],
            NotificationType.TEAM_MEMBERSHIP,
            f"{user.full_name} {'joined' if accept else 'declined'} {team['team_name']}",
            "Team membership updated.",
            {"team_id": team_id},
        )
        await self.c.notifications.emit([team["captain_id"]], "team.membership.updated", {"team_id": str(team_id)})

    async def update_member_role(
        self, user: CurrentUser, team_id: ObjectId, member_id: ObjectId, role: TeamMemberRole
    ) -> None:
        team = await self.get_team(team_id)
        ensure_team_captain(team, user.id)
        if role == TeamMemberRole.CAPTAIN or member_id == team["captain_id"]:
            raise BusinessRuleViolation("Captaincy transfer is not supported yet", code="UNSUPPORTED")
        res = await self.members.update_one(
            {"team_id": team_id, "user_id": member_id, "status": {"$in": ["active", "invited"]}},
            {"$set": {"member_role": role, "updated_at": utcnow()}},
        )
        if res.matched_count == 0:
            raise NotFound("Member not found")
        op = "$addToSet" if role == TeamMemberRole.ADMIN else "$pull"
        await self.teams.update_one({"_id": team_id}, {op: {"admin_ids": member_id}})
        await self.c.audit.log(
            actor_id=user.id,
            action="team.member_role_changed",
            entity_type="team",
            entity_id=team_id,
            new_value={"user_id": member_id, "role": role},
            request_id=user.request_id,
        )

    async def remove_member(self, user: CurrentUser, team_id: ObjectId, member_id: ObjectId) -> None:
        team = await self.get_team(team_id)
        leaving_self = member_id == user.id
        if not leaving_self:
            ensure_team_manager(team, user.id)
        if member_id == team["captain_id"]:
            raise BusinessRuleViolation("The captain cannot leave the team", code="CAPTAIN_CANNOT_LEAVE")
        if member_id in (team.get("admin_ids") or []) and not leaving_self:
            ensure_team_captain(team, user.id)
        now = utcnow()

        async def txn(s: AsyncClientSession) -> None:
            before = await self.members.find_one_and_update(
                {"team_id": team_id, "user_id": member_id, "status": {"$in": ["active", "invited", "requested"]}},
                {"$set": {"status": "left" if leaving_self else "removed", "updated_at": now}},
                session=s,
            )
            if not before:
                raise NotFound("Member not found")
            upd: dict[str, Any] = {"$pull": {"admin_ids": member_id}}
            if before["status"] == "active":
                upd["$inc"] = {"member_count": -1}
            await self.teams.update_one({"_id": team_id}, upd, session=s)
            await self.c.audit.log(
                actor_id=user.id,
                action="team.member_removed",
                entity_type="team",
                entity_id=team_id,
                new_value={"user_id": member_id},
                request_id=user.request_id,
                session=s,
            )

        await self.c.mongo.transaction(txn)
        if not leaving_self:
            await self.c.notifications.notify(
                [member_id],
                NotificationType.TEAM_MEMBERSHIP,
                f"Removed from {team['team_name']}",
                "You are no longer a member of this team.",
                {"team_id": team_id},
            )
        await self.c.notifications.emit(
            [member_id, team["captain_id"]], "team.membership.updated", {"team_id": str(team_id)}
        )

    async def pending_invites(self, user: CurrentUser) -> list[TeamOut]:
        ids = [m["team_id"] async for m in self.members.find({"user_id": user.id, "status": "invited"})]
        out = []
        for tid in ids:
            try:
                out.append(await self.get_out(tid, user))
            except NotFound:
                continue
        return out

    # ---------------------------------------------------------------- join requests
    async def request_join(self, user: CurrentUser, team_id: ObjectId) -> None:
        team = await self.get_team(team_id)
        existing = await self.members.find_one({"team_id": team_id, "user_id": user.id})
        if existing and existing["status"] in ("active", "invited", "requested"):
            raise Conflict("You're already a member, invited or waiting for approval", code="ALREADY_MEMBER")
        await self.members.update_one(
            {"team_id": team_id, "user_id": user.id},
            {
                "$set": {"member_role": TeamMemberRole.MEMBER, "status": "requested", "updated_at": utcnow()},
                "$setOnInsert": {"joined_at": None},
            },
            upsert=True,
        )
        await self.c.notifications.notify(
            [team["captain_id"], *(team.get("admin_ids") or [])],
            NotificationType.JOIN_REQUEST,
            f"{user.full_name} wants to join {team['team_name']}",
            "Approve or decline the request from your team dashboard.",
            {"team_id": team_id, "user_id": user.id},
        )

    async def respond_join_request(
        self, user: CurrentUser, team_id: ObjectId, player_id: ObjectId, approve: bool
    ) -> None:
        team = await self.get_team(team_id)
        ensure_team_manager(team, user.id)
        now = utcnow()

        async def txn(s: AsyncClientSession) -> None:
            res = await self.members.update_one(
                {"team_id": team_id, "user_id": player_id, "status": "requested"},
                {
                    "$set": {
                        "status": "active" if approve else "declined",
                        "joined_at": now if approve else None,
                        "updated_at": now,
                    }
                },
                session=s,
            )
            if res.modified_count == 0:
                raise NotFound("No pending join request", code="NO_JOIN_REQUEST")
            if approve:
                await self.teams.update_one({"_id": team_id}, {"$inc": {"member_count": 1}}, session=s)
            await self.c.audit.log(
                actor_id=user.id,
                action="team.join_request_approved" if approve else "team.join_request_declined",
                entity_type="team",
                entity_id=team_id,
                new_value={"user_id": player_id},
                request_id=user.request_id,
                session=s,
            )

        await self.c.mongo.transaction(txn)
        await self.c.notifications.notify(
            [player_id],
            NotificationType.TEAM_MEMBERSHIP,
            f"{'Welcome to' if approve else 'Request declined by'} {team['team_name']}",
            "Your join request was approved." if approve else "Your join request was declined.",
            {"team_id": team_id},
        )
