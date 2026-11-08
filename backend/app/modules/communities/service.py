"""Location-based cricket communities.

A community is not a team: it groups independent players, several teams, organisers and
moderators around a locality or interest. Collections:
    communities, community_members (user_id, role, status), community_teams,
    community_posts, community_poll_votes, community_post_reports, user_blocks

Permissions (role rank owner > admin > moderator > member)
* Public communities: anyone signed in can read the feed and join instantly.
* Private communities: profile is visible, but feed and member directory are for members;
  joining needs approval from a moderator or above.
* Members post; announcements, polls and tournament posts need moderator or above.
* Moderators approve joins, remove posts and remove ordinary members; admins also ban and
  manage moderators; only the owner manages admins.
* Posts reported by REPORT_HIDE_THRESHOLD members are hidden pending moderator review.
"""

import re
import secrets
from typing import Any

from bson import ObjectId
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.enums import CommunityPostType, CommunityRole, NotificationType
from app.common.types import GeoPointIn, approx_km, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, Forbidden, NotFound, ValidationFailed
from app.modules.communities.schemas import (
    PLATFORM_DISCLAIMER,
    BlockedUserOut,
    CommunityIn,
    CommunityLeaderboardOut,
    CommunityMemberOut,
    CommunityOut,
    CommunityTeamOut,
    CommunityUpdateIn,
    FeedOut,
    PollOptionOut,
    PostIn,
    PostOut,
)
from app.modules.competition.common import managed_team_ids, team_briefs
from app.modules.competition.schemas import PlayerLeaderboardEntry
from app.modules.rating_engine.composite import confidence_from_rd
from app.modules.users.schemas import public_user

RANK = {CommunityRole.OWNER: 4, CommunityRole.ADMIN: 3, CommunityRole.MODERATOR: 2, CommunityRole.MEMBER: 1}
MOD_ONLY_POSTS = (CommunityPostType.ANNOUNCEMENT, CommunityPostType.POLL, CommunityPostType.TOURNAMENT)
REPORT_HIDE_THRESHOLD = 5


def _rank(m: dict[str, Any] | None) -> int:
    if not m or m.get("status") != "active":
        return 0
    return RANK[CommunityRole(m["role"])]


class CommunityService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["communities"]
        self.members = c.mongo["community_members"]
        self.posts = c.mongo["community_posts"]

    async def _get(self, cid: ObjectId) -> dict[str, Any]:
        doc = await self.col.find_one({"_id": cid, "status": "active"})
        if not doc:
            raise NotFound("Community not found")
        return doc

    async def _me(self, cid: ObjectId, uid: ObjectId) -> dict[str, Any] | None:
        return await self.members.find_one({"community_id": cid, "user_id": uid})

    async def _require(
        self, cid: ObjectId, user: CurrentUser, rank: int, what: str
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        com = await self._get(cid)
        me = await self._me(cid, user.id)
        if _rank(me) < rank:
            raise Forbidden(f"Only community {what} can do this", code="COMMUNITY_PERMISSION")
        return com, me

    async def _can_read(self, com: dict[str, Any], me: dict[str, Any] | None) -> bool:
        return com["visibility"] == "public" or _rank(me) >= 1

    async def _staff_ids(self, cid: ObjectId) -> list[ObjectId]:
        return [
            m["user_id"]
            async for m in self.members.find(
                {"community_id": cid, "status": "active", "role": {"$in": ["owner", "admin", "moderator"]}},
                {"user_id": 1},
            )
        ]

    async def _out(
        self, com: dict[str, Any], user: CurrentUser, dist: float | None = None, me: Any = ...
    ) -> CommunityOut:
        if me is ...:
            me = await self._me(com["_id"], user.id)
        creator = await self.c.mongo["users"].find_one({"_id": com["created_by"]})
        r = _rank(me)
        return CommunityOut(
            id=str(com["_id"]),
            name=com["name"],
            slug=com["slug"],
            description=com.get("description"),
            kind=com["kind"],
            visibility=com["visibility"],
            area=com.get("area"),
            city=com["city"],
            distance_km=approx_km(dist) if dist is not None else None,
            guidelines=com.get("guidelines"),
            disclaimer=PLATFORM_DISCLAIMER,
            member_count=com.get("member_count", 0),
            team_count=com.get("team_count", 0),
            created_by=public_user(creator) if creator else None,
            my_role=me["role"] if me and me["status"] == "active" else None,
            my_status=me["status"] if me and me["status"] in ("active", "pending", "banned") else None,
            can_moderate=r >= 2,
            can_admin=r >= 3,
            created_at=com["created_at"],
        )

    # ------------------------------------------------------------ communities
    async def create(self, user: CurrentUser, data: CommunityIn) -> CommunityOut:
        now = utcnow()
        slug = re.sub(r"[^a-z0-9]+", "-", data.name.lower()).strip("-")
        if await self.col.find_one({"slug": slug}):
            slug = f"{slug}-{secrets.token_hex(2)}"
        doc: dict[str, Any] = {
            "name": data.name,
            "slug": slug,
            "description": data.description,
            "kind": data.kind.value,
            "visibility": data.visibility,
            "area": data.area,
            "city": data.city,
            "guidelines": data.guidelines,
            "member_count": 1,
            "team_count": 0,
            "status": "active",
            "created_by": user.id,
            "created_at": now,
            "updated_at": now,
        }
        if data.location:
            doc["location"] = data.location.to_geojson()
        res = await self.col.insert_one(doc)
        doc["_id"] = res.inserted_id
        me = {
            "community_id": res.inserted_id,
            "user_id": user.id,
            "role": "owner",
            "status": "active",
            "joined_at": now,
        }
        await self.members.insert_one(me)
        await self.c.audit.log(
            actor_id=user.id,
            action="community.created",
            entity_type="community",
            entity_id=res.inserted_id,
            new_value={"name": data.name, "visibility": data.visibility},
            request_id=user.request_id,
        )
        return await self._out(doc, user, me=me)

    async def update(self, user: CurrentUser, cid: ObjectId, data: CommunityUpdateIn) -> CommunityOut:
        com, _ = await self._require(cid, user, 3, "admins")
        fields = data.model_dump(exclude_unset=True)
        if not fields:
            raise ValidationFailed("Nothing to update")
        await self.col.update_one({"_id": cid}, {"$set": {**fields, "updated_at": utcnow()}})
        await self.c.audit.log(
            actor_id=user.id,
            action="community.updated",
            entity_type="community",
            entity_id=cid,
            previous_value={k: com.get(k) for k in fields},
            new_value=fields,
            request_id=user.request_id,
        )
        return await self.get(user, cid)

    async def get(self, user: CurrentUser, cid: ObjectId) -> CommunityOut:
        return await self._out(await self._get(cid), user)

    async def discover(
        self,
        user: CurrentUser,
        at: GeoPointIn | None,
        radius_km: int,
        city: str | None,
        kind: str | None,
        q: str | None,
        mine: bool,
    ) -> list[CommunityOut]:
        query: dict[str, Any] = {"status": "active"}
        if kind:
            query["kind"] = kind
        if q:
            query["name"] = {"$regex": re.escape(q.strip()), "$options": "i"}
        if mine:
            ids = [
                m["community_id"]
                async for m in self.members.find({"user_id": user.id, "status": {"$in": ["active", "pending"]}})
            ]
            query["_id"] = {"$in": ids}
        dist: dict[ObjectId, float] = {}
        if at and not mine:
            pipe: list[dict[str, Any]] = [
                {
                    "$geoNear": {
                        "near": {"type": "Point", "coordinates": [at.lng, at.lat]},
                        "distanceField": "d",
                        "maxDistance": radius_km * 1000,
                        "spherical": True,
                        "query": query,
                    }
                },
                {"$limit": 50},
            ]
            rows = [d async for d in await self.col.aggregate(pipe)]
            dist = {d["_id"]: d["d"] for d in rows}
        else:
            if city and not mine:
                query["city"] = {"$regex": f"^{re.escape(city.strip())}$", "$options": "i"}
            rows = [d async for d in self.col.find(query).sort("member_count", -1).limit(50)]
        mems = {
            m["community_id"]: m
            async for m in self.members.find({"user_id": user.id, "community_id": {"$in": [r["_id"] for r in rows]}})
        }
        return [await self._out(r, user, dist.get(r["_id"]), mems.get(r["_id"])) for r in rows]

    # ------------------------------------------------------------ membership
    async def join(self, user: CurrentUser, cid: ObjectId, accept_guidelines: bool) -> CommunityOut:
        com = await self._get(cid)
        if not accept_guidelines:
            raise ValidationFailed("Please accept the community guidelines to join", code="GUIDELINES_REQUIRED")
        me = await self._me(cid, user.id)
        if me and me["status"] == "banned":
            raise Forbidden("You can't join this community", code="COMMUNITY_BANNED")
        if me and me["status"] in ("active", "pending"):
            raise Conflict("You're already a member or waiting for approval", code="ALREADY_MEMBER")
        status = "active" if com["visibility"] == "public" else "pending"
        now = utcnow()
        await self.members.update_one(
            {"community_id": cid, "user_id": user.id},
            {
                "$set": {
                    "role": "member",
                    "status": status,
                    "joined_at": now if status == "active" else None,
                    "guidelines_accepted_at": now,
                }
            },
            upsert=True,
        )
        if status == "active":
            await self.col.update_one({"_id": cid}, {"$inc": {"member_count": 1}})
        else:
            await self.c.notifications.notify(
                await self._staff_ids(cid),
                NotificationType.COMMUNITY_JOIN_REQUEST,
                f"{user.full_name} wants to join {com['name']}",
                "Review the request in the community.",
                {"community_id": cid},
            )
        return await self.get(user, cid)

    async def leave(self, user: CurrentUser, cid: ObjectId) -> None:
        await self._get(cid)
        me = await self._me(cid, user.id)
        if not me or me["status"] not in ("active", "pending"):
            raise NotFound("You're not a member")
        if me["role"] == "owner":
            raise BusinessRuleViolation("The owner can't leave the community", code="OWNER_CANNOT_LEAVE")
        await self.members.update_one({"_id": me["_id"]}, {"$set": {"status": "left"}})
        if me["status"] == "active":
            await self.col.update_one({"_id": cid}, {"$inc": {"member_count": -1}})

    async def list_members(self, user: CurrentUser, cid: ObjectId, status: str) -> list[CommunityMemberOut]:
        com = await self._get(cid)
        me = await self._me(cid, user.id)
        if not await self._can_read(com, me):
            raise Forbidden("Join this private community to see its members", code="COMMUNITY_PRIVATE")
        if status != "active" and _rank(me) < 2:
            raise Forbidden("Only moderators can see pending requests", code="COMMUNITY_PERMISSION")
        rows = [m async for m in self.members.find({"community_id": cid, "status": status}).limit(500)]
        users = {
            u["_id"]: u
            async for u in self.c.mongo["users"].find(
                {"_id": {"$in": [m["user_id"] for m in rows]}, "account_status": {"$ne": "deleted"}}
            )
        }
        out = [
            CommunityMemberOut(
                user=public_user(users[m["user_id"]]), role=m["role"], status=m["status"], joined_at=m.get("joined_at")
            )
            for m in rows
            if m["user_id"] in users
        ]
        out.sort(key=lambda m: (-RANK[CommunityRole(m.role)], m.user.full_name))
        return out

    async def decide_request(self, user: CurrentUser, cid: ObjectId, member_id: ObjectId, approve: bool) -> None:
        com, _ = await self._require(cid, user, 2, "moderators")
        res = await self.members.update_one(
            {"community_id": cid, "user_id": member_id, "status": "pending"},
            {"$set": {"status": "active" if approve else "declined", "joined_at": utcnow() if approve else None}},
        )
        if res.modified_count == 0:
            raise NotFound("No pending request", code="NO_PENDING_REQUEST")
        if approve:
            await self.col.update_one({"_id": cid}, {"$inc": {"member_count": 1}})
        await self.c.audit.log(
            actor_id=user.id,
            action=f"community.request_{'approved' if approve else 'declined'}",
            entity_type="community",
            entity_id=cid,
            new_value={"user_id": member_id},
            request_id=user.request_id,
        )
        await self.c.notifications.notify(
            [member_id],
            NotificationType.COMMUNITY_MEMBERSHIP,
            f"{'Welcome to' if approve else 'Request declined:'} {com['name']}",
            "You're now a member." if approve else "Your request to join was declined.",
            {"community_id": cid},
        )

    async def remove_member(self, user: CurrentUser, cid: ObjectId, member_id: ObjectId, ban: bool) -> None:
        _, me = await self._require(cid, user, 3 if ban else 2, "admins" if ban else "moderators")
        target = await self._me(cid, member_id)
        if not target or target["status"] not in ("active", "pending"):
            raise NotFound("Member not found")
        if member_id == user.id:
            raise BusinessRuleViolation("Use leave to leave the community", code="USE_LEAVE")
        if _rank(target) >= _rank(me):
            raise Forbidden("You can only remove members with a lower role than yours", code="COMMUNITY_PERMISSION")
        await self.members.update_one({"_id": target["_id"]}, {"$set": {"status": "banned" if ban else "removed"}})
        if target["status"] == "active":
            await self.col.update_one({"_id": cid}, {"$inc": {"member_count": -1}})
        await self.c.audit.log(
            actor_id=user.id,
            action="community.member_banned" if ban else "community.member_removed",
            entity_type="community",
            entity_id=cid,
            new_value={"user_id": member_id},
            request_id=user.request_id,
        )

    async def set_role(self, user: CurrentUser, cid: ObjectId, member_id: ObjectId, role: str) -> None:
        _, me = await self._require(cid, user, 3, "admins")
        target = await self._me(cid, member_id)
        if not target or target["status"] != "active":
            raise NotFound("Member not found")
        if target["role"] == "owner":
            raise BusinessRuleViolation("The owner's role can't be changed", code="OWNER_ROLE")
        if (role == "admin" or target["role"] == "admin") and me and me["role"] != "owner":
            raise Forbidden("Only the owner can appoint or remove admins", code="COMMUNITY_PERMISSION")
        await self.members.update_one({"_id": target["_id"]}, {"$set": {"role": role}})
        await self.c.audit.log(
            actor_id=user.id,
            action="community.role_changed",
            entity_type="community",
            entity_id=cid,
            previous_value={"role": target["role"]},
            new_value={"user_id": member_id, "role": role},
            request_id=user.request_id,
        )

    # ------------------------------------------------------------ teams in a community
    async def link_team(self, user: CurrentUser, cid: ObjectId, team_id: ObjectId) -> CommunityTeamOut:
        com, _ = await self._require(cid, user, 1, "members")
        if team_id not in await managed_team_ids(self.c, user.id):
            raise Forbidden("Only the team's captain or vice-captain can add it", code="NOT_TEAM_MANAGER")
        status = "active" if com["visibility"] == "public" else "pending"
        try:
            await self.c.mongo["community_teams"].insert_one(
                {"community_id": cid, "team_id": team_id, "status": status, "added_by": user.id, "created_at": utcnow()}
            )
        except DuplicateKeyError as exc:
            raise Conflict("This team is already in the community", code="TEAM_ALREADY_LINKED") from exc
        if status == "active":
            await self.col.update_one({"_id": cid}, {"$inc": {"team_count": 1}})
        briefs = await team_briefs(self.c, [team_id])
        return CommunityTeamOut(team=briefs[team_id], status=status)

    async def teams(self, user: CurrentUser, cid: ObjectId) -> list[CommunityTeamOut]:
        com = await self._get(cid)
        me = await self._me(cid, user.id)
        if not await self._can_read(com, me):
            raise Forbidden("Join this private community to see its teams", code="COMMUNITY_PRIVATE")
        statuses = ["active", "pending"] if _rank(me) >= 2 else ["active"]
        rows = [
            r async for r in self.c.mongo["community_teams"].find({"community_id": cid, "status": {"$in": statuses}})
        ]
        briefs = await team_briefs(self.c, [r["team_id"] for r in rows])
        return [CommunityTeamOut(team=briefs[r["team_id"]], status=r["status"]) for r in rows if r["team_id"] in briefs]

    async def approve_team(self, user: CurrentUser, cid: ObjectId, team_id: ObjectId) -> None:
        await self._require(cid, user, 2, "moderators")
        res = await self.c.mongo["community_teams"].update_one(
            {"community_id": cid, "team_id": team_id, "status": "pending"}, {"$set": {"status": "active"}}
        )
        if res.modified_count == 0:
            raise NotFound("No pending team")
        await self.col.update_one({"_id": cid}, {"$inc": {"team_count": 1}})

    # ------------------------------------------------------------ feed
    async def _post_out(
        self, posts: list[dict[str, Any]], user: CurrentUser, me: dict[str, Any] | None
    ) -> list[PostOut]:
        uids = list({p["author_id"] for p in posts})
        users = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": uids}})}
        roles = {}
        if posts:
            roles = {
                m["user_id"]: m["role"]
                async for m in self.members.find({"community_id": posts[0]["community_id"], "user_id": {"$in": uids}})
            }
        votes = {
            v["post_id"]: v["option"]
            async for v in self.c.mongo["community_poll_votes"].find(
                {"post_id": {"$in": [p["_id"] for p in posts]}, "user_id": user.id}
            )
        }
        is_mod = _rank(me) >= 2
        out = []
        for p in posts:
            a = users.get(p["author_id"])
            if not a:
                continue
            out.append(
                PostOut(
                    id=str(p["_id"]),
                    community_id=str(p["community_id"]),
                    type=p["type"],
                    author=public_user(a),
                    author_role=roles.get(p["author_id"]),
                    body=p["body"],
                    poll=[PollOptionOut(text=o["text"], votes=o["votes"]) for o in p["poll"]]
                    if p.get("poll")
                    else None,
                    my_vote=votes.get(p["_id"]),
                    event_at=p.get("event_at"),
                    report_count=p.get("report_count", 0) if is_mod else None,
                    can_remove=is_mod or p["author_id"] == user.id,
                    created_at=p["created_at"],
                )
            )
        return out

    async def feed(self, user: CurrentUser, cid: ObjectId, before: str | None, limit: int = 20) -> FeedOut:
        com = await self._get(cid)
        me = await self._me(cid, user.id)
        if not await self._can_read(com, me):
            raise Forbidden("Join this private community to see its feed", code="COMMUNITY_PRIVATE")
        blocked = [b["blocked_id"] async for b in self.c.mongo["user_blocks"].find({"user_id": user.id})]
        q: dict[str, Any] = {"community_id": cid, "removed": False, "author_id": {"$nin": blocked}}
        if _rank(me) < 2:
            q["report_count"] = {"$lt": REPORT_HIDE_THRESHOLD}
        if before:
            try:
                q["_id"] = {"$lt": ObjectId(before)}
            except Exception as exc:
                raise ValidationFailed("Invalid cursor") from exc
        rows = [p async for p in self.posts.find(q).sort([("pinned", -1), ("_id", -1)]).limit(limit + 1)]
        return FeedOut(data=await self._post_out(rows[:limit], user, me), has_next=len(rows) > limit)

    async def combined_feed(
        self,
        user: CurrentUser,
        scope: str,
        at: GeoPointIn | None,
        radius_km: int,
        before: str | None,
        limit: int = 20,
    ) -> FeedOut:
        """For you = joined + nearby public communities; Nearby = public communities in range; Following = joined."""
        mems = {m["community_id"]: m async for m in self.members.find({"user_id": user.id, "status": "active"})}
        dist: dict[ObjectId, float] = {}
        if scope in ("for_you", "nearby") and at:
            pipe: list[dict[str, Any]] = [
                {
                    "$geoNear": {
                        "near": {"type": "Point", "coordinates": [at.lng, at.lat]},
                        "distanceField": "d",
                        "maxDistance": radius_km * 1000,
                        "spherical": True,
                        "query": {"status": "active", "visibility": "public"},
                    }
                },
                {"$limit": 50},
            ]
            dist = {d["_id"]: d["d"] async for d in await self.col.aggregate(pipe)}
        if scope == "following":
            cids = set(mems)
        elif scope == "nearby":
            cids = set(dist)
        else:
            cids = set(mems) | set(dist)
        if not cids:
            return FeedOut(data=[], has_next=False)
        coms = {c["_id"]: c async for c in self.col.find({"_id": {"$in": list(cids)}, "status": "active"})}
        mod_cids = [cid for cid, m in mems.items() if _rank(m) >= 2 and cid in coms]
        other_cids = [cid for cid in coms if cid not in mod_cids]
        blocked = [b["blocked_id"] async for b in self.c.mongo["user_blocks"].find({"user_id": user.id})]
        hidden = [h["post_id"] async for h in self.c.mongo["post_hides"].find({"user_id": user.id})]
        q: dict[str, Any] = {
            "removed": False,
            "author_id": {"$nin": blocked},
            "_id": {"$nin": hidden},
            "$or": [
                {"community_id": {"$in": mod_cids}},
                {"community_id": {"$in": other_cids}, "report_count": {"$lt": REPORT_HIDE_THRESHOLD}},
            ],
        }
        if before:
            try:
                q["_id"]["$lt"] = ObjectId(before)
            except Exception as exc:
                raise ValidationFailed("Invalid cursor") from exc
        rows = [p async for p in self.posts.find(q).sort("_id", -1).limit(limit + 1)]
        page = rows[:limit]
        built: dict[ObjectId, PostOut] = {}
        for cid in {p["community_id"] for p in page}:
            group = [p for p in page if p["community_id"] == cid]
            for p, o in zip(group, await self._post_out(group, user, mems.get(cid)), strict=True):
                com = coms[cid]
                o.community_name = com["name"]
                o.community_area = com.get("area")
                o.community_joined = cid in mems
                o.approx_distance_km = approx_km(dist[cid]) if cid in dist else None
                built[p["_id"]] = o
        return FeedOut(data=[built[p["_id"]] for p in page], has_next=len(rows) > limit)

    async def hide_post(self, user: CurrentUser, pid: ObjectId) -> None:
        post = await self.posts.find_one({"_id": pid, "removed": False}, {"community_id": 1})
        if not post:
            raise NotFound("Post not found")
        await self.c.mongo["post_hides"].update_one(
            {"user_id": user.id, "post_id": pid}, {"$setOnInsert": {"at": utcnow()}}, upsert=True
        )

    async def unhide_post(self, user: CurrentUser, pid: ObjectId) -> None:
        await self.c.mongo["post_hides"].delete_one({"user_id": user.id, "post_id": pid})

    async def post(self, user: CurrentUser, cid: ObjectId, data: PostIn) -> PostOut:
        com, me = await self._require(cid, user, 1, "members")
        if data.type in MOD_ONLY_POSTS and _rank(me) < 2:
            raise Forbidden(
                "Only moderators and admins can post announcements, polls and tournaments", code="COMMUNITY_PERMISSION"
            )
        doc: dict[str, Any] = {
            "community_id": cid,
            "author_id": user.id,
            "type": data.type.value,
            "body": data.body,
            "poll": [{"text": o.text, "votes": 0} for o in data.poll_options] or None,
            "event_at": data.event_at,
            "pinned": data.type == CommunityPostType.ANNOUNCEMENT,
            "removed": False,
            "report_count": 0,
            "created_at": utcnow(),
        }
        res = await self.posts.insert_one(doc)
        doc["_id"] = res.inserted_id
        if data.type == CommunityPostType.ANNOUNCEMENT:
            members = [
                m["user_id"]
                async for m in self.members.find(
                    {"community_id": cid, "status": "active", "user_id": {"$ne": user.id}}, {"user_id": 1}
                )
            ]
            await self.c.notifications.notify(
                members,
                NotificationType.COMMUNITY_ANNOUNCEMENT,
                com["name"],
                data.body[:140],
                {"community_id": cid, "post_id": res.inserted_id},
            )
        return (await self._post_out([doc], user, me))[0]

    async def _visible_post(
        self, user: CurrentUser, cid: ObjectId, pid: ObjectId
    ) -> tuple[dict[str, Any], dict[str, Any] | None]:
        com = await self._get(cid)
        me = await self._me(cid, user.id)
        post = await self.posts.find_one({"_id": pid, "community_id": cid, "removed": False})
        if not post or not await self._can_read(com, me):
            raise NotFound("Post not found")
        return post, me

    async def vote(self, user: CurrentUser, cid: ObjectId, pid: ObjectId, option: int) -> PostOut:
        post, me = await self._visible_post(user, cid, pid)
        if _rank(me) < 1:
            raise Forbidden("Join the community to vote", code="COMMUNITY_PERMISSION")
        if not post.get("poll") or option >= len(post["poll"]):
            raise ValidationFailed("Invalid poll option")
        try:
            await self.c.mongo["community_poll_votes"].insert_one(
                {"post_id": pid, "user_id": user.id, "option": option, "at": utcnow()}
            )
        except DuplicateKeyError as exc:
            raise Conflict("You've already voted", code="ALREADY_VOTED") from exc
        await self.posts.update_one({"_id": pid}, {"$inc": {f"poll.{option}.votes": 1}})
        fresh = await self.posts.find_one({"_id": pid})
        assert fresh
        return (await self._post_out([fresh], user, me))[0]

    async def remove_post(self, user: CurrentUser, cid: ObjectId, pid: ObjectId) -> None:
        post, me = await self._visible_post(user, cid, pid)
        if post["author_id"] != user.id and _rank(me) < 2:
            raise Forbidden("Only the author or a moderator can remove this post", code="COMMUNITY_PERMISSION")
        await self.posts.update_one(
            {"_id": pid}, {"$set": {"removed": True, "removed_by": user.id, "removed_at": utcnow()}}
        )
        if post["author_id"] != user.id:
            await self.c.audit.log(
                actor_id=user.id,
                action="community.post_removed",
                entity_type="community_post",
                entity_id=pid,
                new_value={"community_id": cid, "author_id": post["author_id"]},
                request_id=user.request_id,
            )

    async def report_post(self, user: CurrentUser, cid: ObjectId, pid: ObjectId, reason: str) -> None:
        post, _ = await self._visible_post(user, cid, pid)
        if post["author_id"] == user.id:
            raise BusinessRuleViolation("You can't report your own post")
        try:
            await self.c.mongo["community_post_reports"].insert_one(
                {"post_id": pid, "community_id": cid, "user_id": user.id, "reason": reason, "at": utcnow()}
            )
        except DuplicateKeyError as exc:
            raise Conflict("You've already reported this post", code="ALREADY_REPORTED") from exc
        new = await self.posts.find_one_and_update({"_id": pid}, {"$inc": {"report_count": 1}}, return_document=True)
        if new and new["report_count"] in (1, REPORT_HIDE_THRESHOLD):
            await self.c.notifications.notify(
                await self._staff_ids(cid),
                NotificationType.MODERATION,
                "Post reported",
                reason,
                {"community_id": cid, "post_id": pid},
            )

    # ------------------------------------------------------------ leaderboard
    async def leaderboard(self, user: CurrentUser, cid: ObjectId) -> CommunityLeaderboardOut:
        com = await self._get(cid)
        me = await self._me(cid, user.id)
        if not await self._can_read(com, me):
            raise Forbidden("Join this private community to see its leaderboard", code="COMMUNITY_PRIVATE")
        uids = [
            m["user_id"] async for m in self.members.find({"community_id": cid, "status": "active"}, {"user_id": 1})
        ]
        ratings = [
            r
            async for r in self.c.mongo["player_ratings"]
            .find({"user_id": {"$in": uids}, "matches": {"$gte": 1}})
            .sort("scores.overall", -1)
            .limit(20)
        ]
        users = {
            u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": [r["user_id"] for r in ratings]}})
        }
        profs = {p["user_id"]: p async for p in self.c.mongo["player_profiles"].find({"user_id": {"$in": list(users)}})}
        players = [
            PlayerLeaderboardEntry(
                rank=i + 1,
                movement=None,
                user=public_user(users[r["user_id"]]),
                locality=profs.get(r["user_id"], {}).get("locality"),
                distance_km=None,
                primary_role=profs.get(r["user_id"], {}).get("primary_role"),
                rating=r["overall"]["rating"],
                rating_label="Rating",
                rd=r["overall"]["rd"],
                confidence=confidence_from_rd(r["overall"]["rd"]),
                provisional=r["overall"]["provisional"],
                matches=r["matches"],
                trend=r.get("trend", [])[-8:],
            )
            for i, r in enumerate(ratings)
            if r["user_id"] in users
        ]
        tids = [
            t["team_id"] async for t in self.c.mongo["community_teams"].find({"community_id": cid, "status": "active"})
        ]
        briefs = list((await team_briefs(self.c, tids)).values())
        briefs.sort(key=lambda b: -(b.rating.rating - 2 * b.rating.rd) if b.rating else 10_000)
        return CommunityLeaderboardOut(players=players, teams=briefs)


class BlockService:
    def __init__(self, c: Container) -> None:
        self.col = c.mongo["user_blocks"]
        self.c = c

    async def block(self, user: CurrentUser, other: ObjectId) -> None:
        if other == user.id:
            raise ValidationFailed("You can't block yourself")
        if not await self.c.mongo["users"].find_one({"_id": other}, {"_id": 1}):
            raise NotFound("User not found")
        await self.col.update_one(
            {"user_id": user.id, "blocked_id": other}, {"$setOnInsert": {"at": utcnow()}}, upsert=True
        )

    async def unblock(self, user: CurrentUser, other: ObjectId) -> None:
        await self.col.delete_one({"user_id": user.id, "blocked_id": other})

    async def mine(self, user: CurrentUser) -> list[BlockedUserOut]:
        rows = [b async for b in self.col.find({"user_id": user.id}).sort("at", -1)]
        users = {
            u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": [b["blocked_id"] for b in rows]}})
        }
        return [
            BlockedUserOut(user=public_user(users[b["blocked_id"]]), blocked_at=b["at"])
            for b in rows
            if b["blocked_id"] in users
        ]
