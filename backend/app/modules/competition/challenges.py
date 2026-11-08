"""Team-versus-team challenges.

Workflow
    draft ──send──▶ pending ──accept──▶ accepted ──confirm──▶ confirmed ──result──▶ completed
                       │  ▲                │
                 counter│  │counter        └─(either side) cancel
                       ▼  │
                 counter_proposed ──accept──▶ accepted
    pending / counter_proposed ──reject──▶ rejected

* The team that did NOT make the latest proposal accepts, counters or rejects it.
* After acceptance the team that made that proposal confirms it ("both captains confirm"),
  which creates the fixture in both teams' schedules.
* Only one active challenge per pair of teams per (IST) match day, enforced by a unique
  partial index on ``slot_key`` so concurrent requests cannot create duplicates.
* Neither team may already have a fixture within ``CLASH_HOURS`` of the proposed start.
"""

import secrets
from datetime import timedelta
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.enums import ChallengeStatus, FixtureStatus, NotificationType
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, Forbidden, NotFound, ValidationFailed
from app.modules.competition.common import (
    managed_team_ids,
    overs_for,
    proposal_out,
    team_briefs,
    team_manager_ids,
)
from app.modules.competition.schemas import (
    ChallengeAction,
    ChallengeIn,
    ChallengeOut,
    ProposalEntry,
    ProposalIn,
)
from app.modules.users.schemas import public_user

CLASH_HOURS = 4
IST = timedelta(hours=5, minutes=30)
OPEN = (ChallengeStatus.PENDING, ChallengeStatus.COUNTER_PROPOSED)
TERMINAL = (ChallengeStatus.REJECTED, ChallengeStatus.CANCELLED, ChallengeStatus.COMPLETED)


def _proposal_doc(p: ProposalIn) -> dict[str, Any]:
    venue: dict[str, Any] = {"name": p.venue.name, "area": p.venue.area, "city": p.venue.city}
    if p.venue.location:
        venue["location"] = p.venue.location.to_geojson()
    return {
        "start_at": p.start_at,
        "venue": venue,
        "format": p.format.value,
        "overs": overs_for(p.format.value, p.overs),
        "conditions": p.conditions,
    }


def _slot_key(a: ObjectId, b: ObjectId, start: Any) -> str:
    x, y = sorted([str(a), str(b)])
    return f"{x}:{y}:{(ensure_utc(start) + IST).date().isoformat()}"


def allowed_actions(ch: dict[str, Any], side: str | None) -> list[ChallengeAction]:
    """Pure state-machine rules: what the given side (from/to/None) may do."""
    if side is None:
        return []
    st = ChallengeStatus(ch["status"])
    proposer = "from" if ch["last_proposed_by"] == ch["from_team_id"] else "to"
    if st == ChallengeStatus.DRAFT:
        return ["send", "cancel"] if side == "from" else []
    if st in OPEN:
        return ["cancel"] if side == proposer else ["accept", "counter", "reject"]
    if st == ChallengeStatus.ACCEPTED:
        return ["confirm", "cancel"] if side == proposer else ["cancel"]
    if st == ChallengeStatus.CONFIRMED:
        return ["cancel"]
    return []


class ChallengeService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["team_challenges"]
        self.teams = c.mongo["teams"]

    # ------------------------------------------------------------ helpers
    async def _get(self, cid: ObjectId) -> dict[str, Any]:
        ch = await self.col.find_one({"_id": cid})
        if not ch:
            raise NotFound("Challenge not found")
        return ch

    async def _side(self, ch: dict[str, Any], user: CurrentUser) -> str | None:
        mine = await managed_team_ids(self.c, user.id)
        if ch["from_team_id"] in mine:
            return "from"
        if ch["to_team_id"] in mine:
            return "to"
        return None

    async def _ensure_no_clash(
        self, team_ids: list[ObjectId], start: Any, session: AsyncClientSession | None = None
    ) -> None:
        start = ensure_utc(start)
        clash = await self.c.mongo["fixtures"].find_one(
            {
                "status": FixtureStatus.SCHEDULED,
                "$or": [{"home_team_id": {"$in": team_ids}}, {"away_team_id": {"$in": team_ids}}],
                "start_at": {"$gt": start - timedelta(hours=CLASH_HOURS), "$lt": start + timedelta(hours=CLASH_HOURS)},
            },
            session=session,
        )
        if clash:
            raise Conflict("One of the teams already has a match within 4 hours of that time", code="SCHEDULE_CONFLICT")

    def _validate_time(self, p: ProposalIn) -> None:
        if p.start_at < utcnow() + timedelta(hours=1):
            raise ValidationFailed("Propose a start time at least an hour from now", code="START_TOO_SOON")
        if p.start_at > utcnow() + timedelta(days=120):
            raise ValidationFailed("Propose a date within the next 4 months", code="START_TOO_FAR")

    async def _notify(self, ch: dict[str, Any], to_side: str, ntype: NotificationType, title: str, body: str) -> None:
        team_id = ch["from_team_id"] if to_side == "from" else ch["to_team_id"]
        await self.c.notifications.notify(
            await team_manager_ids(self.c, [team_id]), ntype, title, body, {"challenge_id": ch["_id"]}
        )

    async def out(self, ch: dict[str, Any], user: CurrentUser, side: str | None = None) -> ChallengeOut:
        if side is None:
            side = await self._side(ch, user)
        briefs = await team_briefs(self.c, [ch["from_team_id"], ch["to_team_id"]])
        uids = [h["by_user_id"] for h in ch["history"] if h.get("by_user_id")]
        users = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": uids}})}
        st = ChallengeStatus(ch["status"])
        awaiting: ObjectId | None = None
        if st in OPEN:
            awaiting = ch["to_team_id"] if ch["last_proposed_by"] == ch["from_team_id"] else ch["from_team_id"]
        elif st == ChallengeStatus.ACCEPTED:
            awaiting = ch["last_proposed_by"]
        return ChallengeOut(
            id=str(ch["_id"]),
            status=st,
            from_team=briefs[ch["from_team_id"]],
            to_team=briefs[ch["to_team_id"]],
            proposal=proposal_out(ch["proposal"]),
            history=[
                ProposalEntry(
                    by_team_id=str(h["by_team_id"]),
                    by_user=public_user(users[h["by_user_id"]]) if h.get("by_user_id") in users else None,
                    proposal=proposal_out(h["proposal"]),
                    message=h.get("message"),
                    at=h["at"],
                )
                for h in ch["history"]
            ],
            awaiting_team_id=str(awaiting) if awaiting else None,
            my_side=side,
            actions=allowed_actions(ch, side),
            fixture_id=str(ch["fixture_id"]) if ch.get("fixture_id") else None,
            created_at=ch["created_at"],
            updated_at=ch["updated_at"],
        )

    async def _transition(
        self,
        ch: dict[str, Any],
        user: CurrentUser,
        action: ChallengeAction,
        update: dict[str, Any],
        session: AsyncClientSession | None = None,
    ) -> dict[str, Any]:
        side = await self._side(ch, user)
        if action not in allowed_actions(ch, side):
            if side is None:
                raise Forbidden("Only the captain or vice-captain of either team can do this", code="NOT_TEAM_MANAGER")
            raise BusinessRuleViolation(
                f"You can't {action} this challenge while it is {ch['status'].replace('_', ' ')}",
                code="INVALID_CHALLENGE_TRANSITION",
            )
        update.setdefault("$set", {})["updated_at"] = utcnow()
        try:
            new = await self.col.find_one_and_update(
                {"_id": ch["_id"], "status": ch["status"], "updated_at": ch["updated_at"]},
                update,
                return_document=True,
                session=session,
            )
        except DuplicateKeyError as exc:
            raise Conflict(
                "These teams already have an active challenge on that day", code="DUPLICATE_CHALLENGE"
            ) from exc
        if not new:
            raise Conflict("The challenge changed meanwhile; refresh and try again", code="STALE_CHALLENGE")
        await self.c.audit.log(
            actor_id=user.id,
            action=f"challenge.{action}",
            entity_type="team_challenge",
            entity_id=ch["_id"],
            previous_value={"status": ch["status"]},
            new_value={"status": new["status"]},
            request_id=user.request_id,
            session=session,
        )
        return dict(new)

    # ------------------------------------------------------------ commands
    async def create(self, user: CurrentUser, data: ChallengeIn) -> ChallengeOut:
        from_id, to_id = ObjectId(data.from_team_id), ObjectId(data.to_team_id)
        if from_id == to_id:
            raise ValidationFailed("A team can't challenge itself", code="SAME_TEAM")
        if from_id not in await managed_team_ids(self.c, user.id):
            raise Forbidden("Only your team's captain or vice-captain can send challenges", code="NOT_TEAM_MANAGER")
        target = await self.teams.find_one({"_id": to_id, "team_status": "active"})
        if not target:
            raise NotFound("Team not found")
        self._validate_time(data.proposal)
        await self._ensure_no_clash([from_id, to_id], data.proposal.start_at)
        now = utcnow()
        prop = _proposal_doc(data.proposal)
        status = ChallengeStatus.PENDING if data.send else ChallengeStatus.DRAFT
        doc = {
            "from_team_id": from_id,
            "to_team_id": to_id,
            "status": status.value,
            "proposal": prop,
            "last_proposed_by": from_id,
            "history": [
                {"by_team_id": from_id, "by_user_id": user.id, "proposal": prop, "message": data.message, "at": now}
            ],
            "slot_key": _slot_key(from_id, to_id, prop["start_at"]),
            "fixture_id": None,
            "created_by": user.id,
            "created_at": now,
            "updated_at": now,
        }
        try:
            res = await self.col.insert_one(doc)
        except DuplicateKeyError as exc:
            raise Conflict(
                "These teams already have an active challenge on that day", code="DUPLICATE_CHALLENGE"
            ) from exc
        doc["_id"] = res.inserted_id
        await self.c.audit.log(
            actor_id=user.id,
            action="challenge.created",
            entity_type="team_challenge",
            entity_id=res.inserted_id,
            new_value={"from": from_id, "to": to_id, "status": status.value},
            request_id=user.request_id,
        )
        if data.send:
            await self._announce(doc, user)
        return await self.out(doc, user, "from")

    async def _announce(self, ch: dict[str, Any], user: CurrentUser) -> None:
        briefs = await team_briefs(self.c, [ch["from_team_id"]])
        await self._notify(
            ch,
            "to",
            NotificationType.TEAM_CHALLENGE,
            f"{briefs[ch['from_team_id']].team_name} challenged you",
            f"{user.full_name} proposed a {ch['proposal']['format'].replace('_', '-')} match. "
            "Accept, counter or decline.",
        )

    async def send(self, user: CurrentUser, cid: ObjectId) -> ChallengeOut:
        ch = await self._get(cid)
        new = await self._transition(ch, user, "send", {"$set": {"status": ChallengeStatus.PENDING.value}})
        await self._announce(new, user)
        return await self.out(new, user)

    async def accept(self, user: CurrentUser, cid: ObjectId) -> ChallengeOut:
        ch = await self._get(cid)
        await self._ensure_no_clash([ch["from_team_id"], ch["to_team_id"]], ch["proposal"]["start_at"])
        new = await self._transition(ch, user, "accept", {"$set": {"status": ChallengeStatus.ACCEPTED.value}})
        await self._notify(
            new,
            "from" if new["last_proposed_by"] == new["from_team_id"] else "to",
            NotificationType.CHALLENGE_ACCEPTED,
            "Challenge accepted",
            "Confirm the schedule to lock in the match.",
        )
        return await self.out(new, user)

    async def counter(
        self, user: CurrentUser, cid: ObjectId, proposal: ProposalIn, message: str | None
    ) -> ChallengeOut:
        ch = await self._get(cid)
        side = await self._side(ch, user)
        self._validate_time(proposal)
        await self._ensure_no_clash([ch["from_team_id"], ch["to_team_id"]], proposal.start_at)
        by_team = ch["from_team_id"] if side == "from" else ch["to_team_id"]
        prop = _proposal_doc(proposal)
        new = await self._transition(
            ch,
            user,
            "counter",
            {
                "$set": {
                    "status": ChallengeStatus.COUNTER_PROPOSED.value,
                    "proposal": prop,
                    "last_proposed_by": by_team,
                    "slot_key": _slot_key(ch["from_team_id"], ch["to_team_id"], prop["start_at"]),
                },
                "$push": {
                    "history": {
                        "by_team_id": by_team,
                        "by_user_id": user.id,
                        "proposal": prop,
                        "message": message,
                        "at": utcnow(),
                    }
                },
            },
        )
        await self._notify(
            new,
            "to" if side == "from" else "from",
            NotificationType.CHALLENGE_COUNTER,
            "New match proposal",
            f"{user.full_name} proposed different match details.",
        )
        return await self.out(new, user, side)

    async def reject(self, user: CurrentUser, cid: ObjectId, message: str | None) -> ChallengeOut:
        ch = await self._get(cid)
        new = await self._transition(
            ch,
            user,
            "reject",
            {
                "$set": {"status": ChallengeStatus.REJECTED.value, "closing_message": message},
                "$unset": {"slot_key": ""},
            },
        )
        proposer = "from" if new["last_proposed_by"] == new["from_team_id"] else "to"
        await self._notify(
            new,
            proposer,
            NotificationType.CHALLENGE_REJECTED,
            "Challenge declined",
            message or "The other team declined.",
        )
        return await self.out(new, user)

    async def cancel(self, user: CurrentUser, cid: ObjectId, message: str | None) -> ChallengeOut:
        ch = await self._get(cid)
        side = await self._side(ch, user)

        async def txn(s: AsyncClientSession) -> dict[str, Any]:
            if ch.get("fixture_id"):
                fx = await self.c.mongo["fixtures"].find_one({"_id": ch["fixture_id"]}, session=s)
                if fx and fx.get("result"):
                    raise BusinessRuleViolation(
                        "A result has been submitted; this match can't be cancelled", code="RESULT_EXISTS"
                    )
                await self.c.mongo["fixtures"].update_one(
                    {"_id": ch["fixture_id"]},
                    {"$set": {"status": FixtureStatus.CANCELLED.value, "updated_at": utcnow()}},
                    session=s,
                )
            return await self._transition(
                ch,
                user,
                "cancel",
                {
                    "$set": {"status": ChallengeStatus.CANCELLED.value, "closing_message": message},
                    "$unset": {"slot_key": ""},
                },
                session=s,
            )

        new = await self.c.mongo.transaction(txn)
        if ch["status"] != ChallengeStatus.DRAFT:
            await self._notify(
                new,
                "to" if side == "from" else "from",
                NotificationType.CHALLENGE_CANCELLED,
                "Challenge cancelled",
                message or f"{user.full_name} cancelled the match.",
            )
        return await self.out(new, user, side)

    async def confirm(self, user: CurrentUser, cid: ObjectId) -> ChallengeOut:
        ch = await self._get(cid)
        side = await self._side(ch, user)
        if "confirm" not in allowed_actions(ch, side):
            await self._transition(ch, user, "confirm", {})  # raises the right error
        p = ch["proposal"]

        async def txn(s: AsyncClientSession) -> dict[str, Any]:
            await self._ensure_no_clash([ch["from_team_id"], ch["to_team_id"]], p["start_at"], session=s)
            now = utcnow()
            fx = {
                "code": f"PR-{secrets.token_hex(3).upper()}",
                "challenge_id": ch["_id"],
                "home_team_id": ch["from_team_id"],
                "away_team_id": ch["to_team_id"],
                "start_at": p["start_at"],
                "venue": p["venue"],
                "format": p["format"],
                "overs": p["overs"],
                "conditions": p.get("conditions"),
                "status": FixtureStatus.SCHEDULED.value,
                "result": None,
                "ratings_applied": False,
                "is_demo": bool(ch.get("is_demo")),
                "created_at": now,
                "updated_at": now,
            }
            res = await self.c.mongo["fixtures"].insert_one(fx, session=s)
            return await self._transition(
                ch,
                user,
                "confirm",
                {"$set": {"status": ChallengeStatus.CONFIRMED.value, "fixture_id": res.inserted_id}},
                session=s,
            )

        new = await self.c.mongo.transaction(txn)
        members = [
            m["user_id"]
            async for m in self.c.mongo["team_members"].find(
                {"team_id": {"$in": [ch["from_team_id"], ch["to_team_id"]]}, "status": "active"}, {"user_id": 1}
            )
        ]
        briefs = await team_briefs(self.c, [ch["from_team_id"], ch["to_team_id"]])
        when = (ensure_utc(p["start_at"]) + IST).strftime("%a %d %b, %I:%M %p")
        await self.c.notifications.notify(
            members,
            NotificationType.CHALLENGE_CONFIRMED,
            f"{briefs[ch['from_team_id']].team_name} vs {briefs[ch['to_team_id']].team_name}",
            f"Match confirmed for {when} at {p['venue']['name']}.",
            {"fixture_id": new["fixture_id"]},
        )
        return await self.out(new, user, side)

    # ------------------------------------------------------------ queries
    async def get(self, user: CurrentUser, cid: ObjectId) -> ChallengeOut:
        ch = await self._get(cid)
        side = await self._side(ch, user)
        if side is None and not user.is_admin:
            raise NotFound("Challenge not found")
        if ch["status"] == ChallengeStatus.DRAFT and side != "from":
            raise NotFound("Challenge not found")
        return await self.out(ch, user, side)

    async def list(
        self, user: CurrentUser, box: str, status: str | None, team_id: ObjectId | None
    ) -> list[ChallengeOut]:
        mine = await managed_team_ids(self.c, user.id)
        if team_id:
            mine = mine & {team_id}
        if not mine:
            return []
        ids = list(mine)
        if box == "incoming":
            q: dict[str, Any] = {"to_team_id": {"$in": ids}, "status": {"$ne": ChallengeStatus.DRAFT.value}}
        elif box == "outgoing":
            q = {"from_team_id": {"$in": ids}}
        else:
            q = {
                "$or": [
                    {"from_team_id": {"$in": ids}},
                    {"to_team_id": {"$in": ids}, "status": {"$ne": ChallengeStatus.DRAFT.value}},
                ]
            }
        if status == "active":
            q["status"] = {
                "$in": [
                    s.value
                    for s in ChallengeStatus
                    if s not in TERMINAL and (box != "incoming" or s != ChallengeStatus.DRAFT)
                ]
            }
        elif status:
            q = {"$and": [q, {"status": status}]}
        rows = [ch async for ch in self.col.find(q).sort("updated_at", -1).limit(100)]
        return [await self.out(ch, user) for ch in rows]

    async def complete_for_fixture(self, fixture: dict[str, Any], session: AsyncClientSession | None = None) -> None:
        if fixture.get("challenge_id"):
            await self.col.update_one(
                {"_id": fixture["challenge_id"], "status": ChallengeStatus.CONFIRMED.value},
                {
                    "$set": {"status": ChallengeStatus.COMPLETED.value, "updated_at": utcnow()},
                    "$unset": {"slot_key": ""},
                },
                session=session,
            )
