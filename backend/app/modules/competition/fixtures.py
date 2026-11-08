"""Fixtures (team-vs-team matches created from confirmed challenges) and result verification.

Result workflow
    1. A captain/vice-captain of either team submits the result and scorecard   -> submitted
    2. The OTHER team's captain/vice-captain reviews it:
         verify   -> confirmed: official; team + player ratings update, records count
         dispute  -> disputed: held, never affects ratings
    3. A disputed result can be corrected and resubmitted by either team (back to 1),
       or resolved by a platform administrator (confirm or void).
Nobody can verify a result their own team submitted.
"""

from datetime import timedelta
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.dependencies import CurrentUser
from app.common.enums import FixtureStatus, NotificationType, ResultStatus, ResultType
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, Forbidden, NotFound, ValidationFailed
from app.modules.competition.challenges import ChallengeService
from app.modules.competition.common import managed_team_ids, member_team_ids, team_briefs, team_manager_ids
from app.modules.competition.schemas import (
    FixtureAction,
    FixtureOut,
    InningsOut,
    PlayerLineOut,
    ResultIn,
    ResultOut,
    VenueOut,
)
from app.modules.competition.skill import SkillRatingService
from app.modules.users.schemas import public_user


def _overs(balls: int) -> str:
    return f"{balls // 6}.{balls % 6}" if balls % 6 else str(balls // 6)


def result_summary(r: dict[str, Any], names: dict[ObjectId, str]) -> str:
    if r["result_type"] == ResultType.NO_RESULT:
        return "No result"
    if r["result_type"] == ResultType.TIED:
        return "Match tied"
    win = r["winner_team_id"]
    inns = r.get("innings") or []
    if len(inns) == 2:
        first, second = inns
        if second["batting_team_id"] == win:
            return f"{names.get(win, 'Winner')} won by {10 - second['wickets']} wickets"
        return f"{names.get(win, 'Winner')} won by {first['runs'] - second['runs']} runs"
    return f"{names.get(win, 'Winner')} won"


def validate_result(fx: dict[str, Any], data: ResultIn, members: dict[ObjectId, set[ObjectId]]) -> None:
    teams = {fx["home_team_id"], fx["away_team_id"]}
    max_balls = fx["overs"] * 6

    def bad(msg: str) -> None:
        raise ValidationFailed(msg, code="INVALID_SCORECARD")

    if data.winner_team_id and ObjectId(data.winner_team_id) not in teams:
        bad("The winner must be one of the two teams")
    inns = {ObjectId(i.batting_team_id): i for i in data.innings}
    if len(inns) != len(data.innings) or not set(inns) <= teams:
        bad("Each team can bat at most once, and only teams in this fixture can bat")
    if data.result_type != ResultType.NO_RESULT and len(inns) != 2:
        bad("Enter both innings for a completed match")
    for i in data.innings:
        if i.balls > max_balls:
            bad(f"An innings can't exceed {fx['overs']} overs")
    if data.result_type == ResultType.WON:
        win = ObjectId(data.winner_team_id)
        lose = next(iter(teams - {win}))
        if inns[win].runs <= inns[lose].runs:
            bad("The winning team must have scored more runs")
    if data.result_type == ResultType.TIED and len({i.runs for i in data.innings}) != 1:
        bad("A tie needs equal scores")

    seen: set[str] = set()
    for p in data.players:
        tid, uid = ObjectId(p.team_id), ObjectId(p.user_id)
        if p.user_id in seen:
            bad("A player appears twice in the scorecard")
        seen.add(p.user_id)
        if tid not in teams:
            bad("Scorecard players must belong to one of the two teams")
        if uid not in members.get(tid, set()):
            bad("Every scorecard player must be an active member of their team")
        other = next(iter(teams - {tid}))
        if p.batting and tid not in inns:
            bad("A player can only bat if their team batted")
        if p.bowling and other not in inns:
            bad("A player can only bowl if the other team batted")
    for tid, i in inns.items():
        other = next(iter(teams - {tid}))
        bats = [p.batting for p in data.players if ObjectId(p.team_id) == tid and p.batting]
        bowls = [p.bowling for p in data.players if ObjectId(p.team_id) == other and p.bowling]
        fields = [p.fielding for p in data.players if ObjectId(p.team_id) == other]
        if sum(b.runs for b in bats) > i.runs:
            bad("Batters' runs exceed the innings total")
        if sum(1 for b in bats if b.out) > i.wickets:
            bad("More batters are marked out than wickets fell")
        if sum(b.balls for b in bowls) > i.balls:
            bad("Balls bowled exceed the innings length")
        if sum(b.runs for b in bowls) > i.runs or sum(b.wickets for b in bowls) > i.wickets:
            bad("Bowling figures exceed the innings total")
        if sum(f.catches + f.run_outs + f.stumpings for f in fields) > i.wickets:
            bad("Fielding dismissals exceed wickets that fell")


class FixtureService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["fixtures"]

    async def _get(self, fid: ObjectId) -> dict[str, Any]:
        fx = await self.col.find_one({"_id": fid})
        if not fx:
            raise NotFound("Match not found")
        return fx

    async def out_many(self, rows: list[dict[str, Any]], user: CurrentUser) -> list[FixtureOut]:
        if not rows:
            return []
        managed = await managed_team_ids(self.c, user.id)
        member = await member_team_ids(self.c, user.id)
        tids = {t for f in rows for t in (f["home_team_id"], f["away_team_id"])}
        briefs = await team_briefs(self.c, tids)
        names = {k: v.team_name for k, v in briefs.items()}
        uids = set()
        for f in rows:
            r = f.get("result") or {}
            uids |= {p["user_id"] for p in r.get("players") or []}
            uids |= {u for u in (r.get("submitted_by"), r.get("verified_by")) if u}
        users = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": list(uids)}})}
        now = utcnow()
        out = []
        for f in rows:
            home, away = f["home_team_id"], f["away_team_id"]
            mine = home if home in (managed | member) else away if away in (managed | member) else None
            side_managed = {t for t in (home, away) if t in managed}
            r = f.get("result")
            actions: list[FixtureAction] = []
            if f["status"] == FixtureStatus.SCHEDULED and side_managed:
                started = ensure_utc(f["start_at"]) <= now
                if started and (not r or r["status"] == ResultStatus.DISPUTED):
                    actions.append("submit_result")
                if r and r["status"] == ResultStatus.SUBMITTED and (side_managed - {r["submitted_team_id"]}):
                    actions += ["verify", "dispute"]
                if not r:
                    actions.append("cancel")
            result = None
            if r:
                result = ResultOut(
                    status=r["status"],
                    result_type=r["result_type"],
                    winner_team_id=str(r["winner_team_id"]) if r.get("winner_team_id") else None,
                    summary=result_summary(r, names),
                    innings=[
                        InningsOut(
                            batting_team_id=str(i["batting_team_id"]),
                            runs=i["runs"],
                            wickets=i["wickets"],
                            balls=i["balls"],
                        )
                        for i in r.get("innings") or []
                    ],
                    players=[
                        PlayerLineOut(
                            user=public_user(users[p["user_id"]]),
                            team_id=str(p["team_id"]),
                            batting=p.get("batting"),
                            bowling=p.get("bowling"),
                            fielding=p.get("fielding") or {},
                        )
                        for p in r.get("players") or []
                        if p["user_id"] in users
                    ],
                    notes=r.get("notes"),
                    submitted_by=public_user(users[r["submitted_by"]]) if r.get("submitted_by") in users else None,
                    submitted_team_id=str(r["submitted_team_id"]),
                    submitted_at=r["submitted_at"],
                    verified_by=public_user(users[r["verified_by"]]) if r.get("verified_by") in users else None,
                    verified_at=r.get("verified_at"),
                    dispute_reason=r.get("dispute_reason"),
                    ratings_applied=bool(f.get("ratings_applied")),
                )
            v = f.get("venue") or {}
            out.append(
                FixtureOut(
                    id=str(f["_id"]),
                    code=f["code"],
                    home_team=briefs[home],
                    away_team=briefs[away],
                    start_at=f["start_at"],
                    venue=VenueOut(name=v.get("name", ""), area=v.get("area"), city=v.get("city")),
                    format=f["format"],
                    overs=f["overs"],
                    conditions=f.get("conditions"),
                    status=f["status"],
                    challenge_id=str(f["challenge_id"]) if f.get("challenge_id") else None,
                    result=result,
                    my_team_id=str(mine) if mine else None,
                    actions=actions,
                    is_demo=bool(f.get("is_demo")),
                )
            )
        return out

    async def get(self, user: CurrentUser, fid: ObjectId) -> FixtureOut:
        return (await self.out_many([await self._get(fid)], user))[0]

    async def list_for_teams(
        self, user: CurrentUser, team_ids: set[ObjectId], when: str, limit: int = 50
    ) -> list[FixtureOut]:
        if not team_ids:
            return []
        ids = list(team_ids)
        q: dict[str, Any] = {"$or": [{"home_team_id": {"$in": ids}}, {"away_team_id": {"$in": ids}}]}
        now = utcnow()
        if when == "upcoming":
            q.update(status=FixtureStatus.SCHEDULED.value, start_at={"$gte": now - timedelta(hours=6)})
            sort = 1
        elif when == "awaiting":
            q.update(status=FixtureStatus.SCHEDULED.value, start_at={"$lt": now})
            sort = -1
        else:
            q.update(status=FixtureStatus.COMPLETED.value)
            sort = -1
        rows = [f async for f in self.col.find(q).sort("start_at", sort).limit(limit)]
        return await self.out_many(rows, user)

    async def mine(self, user: CurrentUser, when: str) -> list[FixtureOut]:
        teams = await member_team_ids(self.c, user.id) | await managed_team_ids(self.c, user.id)
        return await self.list_for_teams(user, teams, when)

    async def _members(self, fx: dict[str, Any]) -> dict[ObjectId, set[ObjectId]]:
        out: dict[ObjectId, set[ObjectId]] = {fx["home_team_id"]: set(), fx["away_team_id"]: set()}
        async for m in self.c.mongo["team_members"].find(
            {"team_id": {"$in": list(out)}, "status": "active"}, {"team_id": 1, "user_id": 1}
        ):
            out[m["team_id"]].add(m["user_id"])
        return out

    async def submit_result(self, user: CurrentUser, fid: ObjectId, data: ResultIn) -> FixtureOut:
        fx = await self._get(fid)
        managed = await managed_team_ids(self.c, user.id) & {fx["home_team_id"], fx["away_team_id"]}
        if not managed:
            raise Forbidden(
                "Only a captain or vice-captain of either team can submit the result", code="NOT_TEAM_MANAGER"
            )
        if fx["status"] != FixtureStatus.SCHEDULED:
            raise BusinessRuleViolation("This match is not awaiting a result", code="FIXTURE_NOT_OPEN")
        if ensure_utc(fx["start_at"]) > utcnow():
            raise BusinessRuleViolation("Results can be submitted once the match has started", code="MATCH_NOT_STARTED")
        prev = fx.get("result")
        if prev and prev["status"] != ResultStatus.DISPUTED:
            raise Conflict("A result is already awaiting verification", code="RESULT_EXISTS")
        validate_result(fx, data, await self._members(fx))
        submitted_team = next(iter(managed)) if len(managed) == 1 else fx["home_team_id"]
        now = utcnow()
        result = {
            "status": ResultStatus.SUBMITTED.value,
            "result_type": data.result_type.value,
            "winner_team_id": ObjectId(data.winner_team_id) if data.winner_team_id else None,
            "innings": [{**i.model_dump(), "batting_team_id": ObjectId(i.batting_team_id)} for i in data.innings],
            "players": [
                {
                    "user_id": ObjectId(p.user_id),
                    "team_id": ObjectId(p.team_id),
                    "batting": p.batting.model_dump() if p.batting else None,
                    "bowling": p.bowling.model_dump() if p.bowling else None,
                    "fielding": p.fielding.model_dump(),
                }
                for p in data.players
            ],
            "notes": data.notes,
            "submitted_by": user.id,
            "submitted_team_id": submitted_team,
            "submitted_at": now,
            "verified_by": None,
            "verified_at": None,
            "dispute_reason": None,
        }
        filt: dict[str, Any] = {"_id": fid, "status": FixtureStatus.SCHEDULED.value}
        filt["result"] = None if not prev else {"$ne": None}
        if prev:
            filt["result.status"] = ResultStatus.DISPUTED.value
        res = await self.col.update_one(
            filt,
            {
                "$set": {"result": result, "updated_at": now},
                "$push": {"result_history": {"$each": [prev] if prev else []}},
            },
        )
        if res.modified_count == 0:
            raise Conflict("The result changed meanwhile; refresh and try again", code="STALE_RESULT")
        await self.c.audit.log(
            actor_id=user.id,
            action="fixture.result_submitted",
            entity_type="fixture",
            entity_id=fid,
            new_value={"result_type": data.result_type.value, "players": len(data.players)},
            request_id=user.request_id,
        )
        other = fx["away_team_id"] if submitted_team == fx["home_team_id"] else fx["home_team_id"]
        await self.c.notifications.notify(
            await team_manager_ids(self.c, [other]),
            NotificationType.RESULT_SUBMITTED,
            "Confirm the match result",
            f"{user.full_name} submitted the result. Verify it or raise a dispute.",
            {"fixture_id": fid},
        )
        return await self.get(user, fid)

    async def _reviewable(self, user: CurrentUser, fid: ObjectId) -> dict[str, Any]:
        fx = await self._get(fid)
        r = fx.get("result")
        if not r or r["status"] != ResultStatus.SUBMITTED:
            raise BusinessRuleViolation("There is no result awaiting verification", code="NO_PENDING_RESULT")
        managed = await managed_team_ids(self.c, user.id) & {fx["home_team_id"], fx["away_team_id"]}
        if not (managed - {r["submitted_team_id"]}):
            raise Forbidden(
                "Only the opposing team's captain or vice-captain can review this result", code="NOT_OPPOSING_MANAGER"
            )
        return fx

    async def _confirm(self, fx: dict[str, Any], actor: ObjectId | None, request_id: str | None, action: str) -> None:
        now = utcnow()

        async def txn(s: AsyncClientSession) -> dict[str, Any]:
            new = await self.col.find_one_and_update(
                {"_id": fx["_id"], "result.status": fx["result"]["status"]},
                {
                    "$set": {
                        "result.status": ResultStatus.CONFIRMED.value,
                        "result.verified_by": actor,
                        "result.verified_at": now,
                        "status": FixtureStatus.COMPLETED.value,
                        "updated_at": now,
                    }
                },
                return_document=True,
                session=s,
            )
            if not new:
                raise Conflict("The result changed meanwhile; refresh and try again", code="STALE_RESULT")
            await SkillRatingService(self.c).apply_fixture(new, session=s, notify=False)
            await ChallengeService(self.c).complete_for_fixture(new, session=s)
            await self.c.audit.log(
                actor_id=actor,
                action=action,
                entity_type="fixture",
                entity_id=fx["_id"],
                previous_value={"result_status": fx["result"]["status"]},
                new_value={"result_status": "confirmed"},
                request_id=request_id,
                session=s,
            )
            return dict(new)

        new = await self.c.mongo.transaction(txn)
        await SkillRatingService(self.c).notify_changes(new)
        members = [
            m["user_id"]
            async for m in self.c.mongo["team_members"].find(
                {"team_id": {"$in": [fx["home_team_id"], fx["away_team_id"]]}, "status": "active"}, {"user_id": 1}
            )
        ]
        await self.c.notifications.notify(
            members,
            NotificationType.RESULT_CONFIRMED,
            "Result confirmed",
            "The match result is now official.",
            {"fixture_id": fx["_id"]},
        )

    async def verify(self, user: CurrentUser, fid: ObjectId) -> FixtureOut:
        fx = await self._reviewable(user, fid)
        await self._confirm(fx, user.id, user.request_id, "fixture.result_verified")
        return await self.get(user, fid)

    async def dispute(self, user: CurrentUser, fid: ObjectId, reason: str) -> FixtureOut:
        fx = await self._reviewable(user, fid)
        res = await self.col.update_one(
            {"_id": fid, "result.status": ResultStatus.SUBMITTED.value},
            {
                "$set": {
                    "result.status": ResultStatus.DISPUTED.value,
                    "result.dispute_reason": reason,
                    "result.disputed_by": user.id,
                    "updated_at": utcnow(),
                }
            },
        )
        if res.modified_count == 0:
            raise Conflict("The result changed meanwhile; refresh and try again", code="STALE_RESULT")
        await self.c.audit.log(
            actor_id=user.id,
            action="fixture.result_disputed",
            entity_type="fixture",
            entity_id=fid,
            new_value={"reason": reason},
            request_id=user.request_id,
        )
        admins = [u["_id"] async for u in self.c.mongo["users"].find({"roles": "admin"}, {"_id": 1})]
        await self.c.notifications.notify(
            [*await team_manager_ids(self.c, [fx["result"]["submitted_team_id"]]), *admins],
            NotificationType.RESULT_DISPUTED,
            "Match result disputed",
            reason,
            {"fixture_id": fid},
        )
        return await self.get(user, fid)

    async def cancel(self, user: CurrentUser, fid: ObjectId) -> FixtureOut:
        fx = await self._get(fid)
        if not await managed_team_ids(self.c, user.id) & {fx["home_team_id"], fx["away_team_id"]}:
            raise Forbidden("Only a captain or vice-captain of either team can cancel", code="NOT_TEAM_MANAGER")
        if fx.get("challenge_id"):
            await ChallengeService(self.c).cancel(user, fx["challenge_id"], None)
        else:
            if fx.get("result"):
                raise BusinessRuleViolation(
                    "A result has been submitted; this match can't be cancelled", code="RESULT_EXISTS"
                )
            await self.col.update_one(
                {"_id": fid}, {"$set": {"status": FixtureStatus.CANCELLED.value, "updated_at": utcnow()}}
            )
        return await self.get(user, fid)

    # -------------------------------------------------------------- admin
    async def disputed(self, user: CurrentUser) -> list[FixtureOut]:
        rows = [
            f
            async for f in self.col.find({"result.status": ResultStatus.DISPUTED.value})
            .sort("updated_at", -1)
            .limit(100)
        ]
        return await self.out_many(rows, user)

    async def resolve(self, admin: CurrentUser, fid: ObjectId, action: str, reason: str) -> FixtureOut:
        fx = await self._get(fid)
        r = fx.get("result")
        if not r:
            raise BusinessRuleViolation("This match has no result", code="NO_RESULT")
        if action == "confirm":
            if r["status"] not in (ResultStatus.DISPUTED, ResultStatus.SUBMITTED):
                raise BusinessRuleViolation(
                    "Only a disputed or pending result can be confirmed", code="INVALID_RESOLUTION"
                )
            await self._confirm(fx, admin.id, admin.request_id, "fixture.result_confirmed_by_admin")
        else:
            was_applied = bool(fx.get("ratings_applied"))
            await self.col.update_one(
                {"_id": fid},
                {
                    "$set": {
                        "result.status": ResultStatus.VOIDED.value,
                        "result.void_reason": reason,
                        "status": FixtureStatus.CANCELLED.value,
                        "updated_at": utcnow(),
                    }
                },
            )
            await self.c.audit.log(
                actor_id=admin.id,
                action="fixture.result_voided",
                entity_type="fixture",
                entity_id=fid,
                previous_value={"result_status": r["status"]},
                new_value={"reason": reason},
                request_id=admin.request_id,
            )
            if was_applied:
                await SkillRatingService(self.c).rebuild_all()
        return await self.get(admin, fid)
