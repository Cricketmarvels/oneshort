"""Misbehaviour reporting and admin moderation (FR-SAF-1/2).

AI triage (optional) is advisory only: it is stored on the report for admins and never
changes account state. All moderation actions are taken by a human admin and audited.
"""

import secrets
from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId
from pydantic import BaseModel, Field

from app.api.dependencies import CurrentUser
from app.common.enums import (
    AccountStatus,
    ModerationAction,
    NotificationType,
    ReportCategory,
    ReportStatus,
)
from app.common.response import PageParams
from app.common.types import ObjectIdStr, StrictModel, utcnow
from app.common.validators import ShortText, Url
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, NotFound
from app.core.logging import get_logger
from app.infrastructure.integrations.ai import TriageInput
from app.modules.users.schemas import PublicUserOut, public_user

log = get_logger("reports")


class ReportIn(StrictModel):
    target_user_id: ObjectIdStr
    match_id: ObjectIdStr | None = None
    category: ReportCategory
    description: str = Field(min_length=10, max_length=2000)
    evidence_urls: list[Url] = Field(default_factory=list, max_length=5)


class ActionIn(StrictModel):
    type: ModerationAction
    days: int | None = Field(default=None, ge=1, le=365, description="Required for temp_suspend")
    reason: ShortText


class ReportUpdateIn(StrictModel):
    status: ReportStatus | None = None
    note: str | None = Field(default=None, max_length=2000)
    action: ActionIn | None = None


class AITriageOut(BaseModel):
    severity: str
    summary: str
    suggested_action: str
    rationale: str
    model: str
    advisory: bool = True


class NoteOut(BaseModel):
    by: str
    note: str
    at: datetime


class ActionOut(BaseModel):
    action: str
    by: str
    at: datetime
    until: datetime | None
    reason: str


class ReportOut(BaseModel):
    id: str
    report_code: str
    category: ReportCategory
    description: str
    status: ReportStatus
    target: PublicUserOut
    match_id: str | None
    evidence_urls: list[str]
    created_at: datetime
    updated_at: datetime


class AdminReportOut(ReportOut):
    reporter: PublicUserOut
    target_account_status: str
    prior_reports_against_target: int
    ai_triage: AITriageOut | None
    investigation_notes: list[NoteOut]
    actions: list[ActionOut]


class ReportService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["reports"]

    async def create(self, user: CurrentUser, data: ReportIn) -> ReportOut:
        target = ObjectId(data.target_user_id)
        if target == user.id:
            raise BusinessRuleViolation("You cannot report yourself", code="SELF_REPORT")
        if not await self.c.mongo["users"].count_documents({"_id": target}, limit=1):
            raise NotFound("User not found")
        match_oid = ObjectId(data.match_id) if data.match_id else None
        dup = await self.col.count_documents(
            {
                "reporter_id": user.id,
                "target_user_id": target,
                "match_id": match_oid,
                "category": data.category.value,
                "status": {"$in": [ReportStatus.OPEN, ReportStatus.INVESTIGATING]},
            },
            limit=1,
        )
        if dup:
            raise Conflict("You already have an open report about this", code="DUPLICATE_REPORT")
        now = utcnow()
        doc: dict[str, Any] = {
            "report_code": "RP-" + secrets.token_hex(3).upper(),
            "reporter_id": user.id,
            "target_user_id": target,
            "match_id": match_oid,
            "category": data.category.value,
            "description": data.description,
            "evidence_urls": data.evidence_urls,
            "status": ReportStatus.OPEN.value,
            "ai_triage": None,
            "investigation_notes": [],
            "actions": [],
            "created_at": now,
            "updated_at": now,
        }
        res = await self.col.insert_one(doc)
        doc["_id"] = res.inserted_id
        await self.c.audit.log(
            actor_id=user.id,
            action="report.created",
            entity_type="report",
            entity_id=res.inserted_id,
            new_value={"category": data.category.value},
            request_id=user.request_id,
        )
        await self._triage(doc)
        return await self._out(doc)

    async def _triage(self, doc: dict[str, Any]) -> None:
        if not self.c.ai.enabled:
            return
        prior = await self.col.count_documents({"target_user_id": doc["target_user_id"], "_id": {"$ne": doc["_id"]}})
        upheld = await self.col.count_documents(
            {"target_user_id": doc["target_user_id"], "status": ReportStatus.RESOLVED, "actions.0": {"$exists": True}}
        )
        try:
            result = await self.c.ai.triage_report(
                TriageInput(
                    category=doc["category"],
                    description=doc["description"],
                    prior_reports_against_target=prior,
                    prior_upheld_reports_against_target=upheld,
                )
            )
        except Exception as exc:  # noqa: BLE001 - advisory feature must never block reporting
            log.warning("report.triage_failed", error=type(exc).__name__)
            return
        if result:
            await self.col.update_one(
                {"_id": doc["_id"]},
                {
                    "$set": {
                        "ai_triage": {
                            **result.model_dump(),
                            "model": self.c.ai.model,
                            "advisory": True,
                            "created_at": utcnow(),
                        }
                    }
                },
            )

    async def mine(self, user: CurrentUser) -> list[ReportOut]:
        return [await self._out(r) async for r in self.col.find({"reporter_id": user.id}).sort("created_at", -1)]

    async def admin_list(self, status: ReportStatus | None, params: PageParams) -> tuple[list[AdminReportOut], int]:
        q: dict[str, Any] = {}
        if status:
            q["status"] = status.value
        total = await self.col.count_documents(q)
        rows = [r async for r in self.col.find(q).sort("created_at", -1).skip(params.skip).limit(params.page_size)]
        return [await self._admin_out(r) for r in rows], total

    async def admin_update(self, admin: CurrentUser, report_id: ObjectId, data: ReportUpdateIn) -> AdminReportOut:
        report = await self.col.find_one({"_id": report_id})
        if not report:
            raise NotFound("Report not found")
        now = utcnow()
        update: dict[str, Any] = {"$set": {"updated_at": now}}
        pushes: dict[str, Any] = {}
        if data.note:
            pushes["investigation_notes"] = {"by": admin.id, "note": data.note, "at": now}
        if data.status:
            update["$set"]["status"] = data.status.value
        elif report["status"] == ReportStatus.OPEN:
            update["$set"]["status"] = ReportStatus.INVESTIGATING.value
        if data.action:
            until = await self._apply_action(admin, report["target_user_id"], data.action)
            pushes["actions"] = {
                "action": data.action.type.value,
                "by": admin.id,
                "at": now,
                "until": until,
                "reason": data.action.reason,
            }
        if pushes:
            update["$push"] = pushes
        await self.col.update_one({"_id": report_id}, update)
        await self.c.audit.log(
            actor_id=admin.id,
            action="report.updated",
            entity_type="report",
            entity_id=report_id,
            previous_value={"status": report["status"]},
            new_value={
                "status": update["$set"].get("status"),
                "action": data.action.type.value if data.action else None,
            },
            request_id=admin.request_id,
        )
        if data.status and data.status != report["status"]:
            await self.c.notifications.notify(
                [report["reporter_id"]],
                NotificationType.REPORT_UPDATE,
                f"Report {report['report_code']} update",
                f"Status: {data.status.value}. Thank you for helping keep the community safe.",
                {"report_id": report_id},
            )
        updated = await self.col.find_one({"_id": report_id})
        assert updated is not None
        return await self._admin_out(updated)

    async def _apply_action(self, admin: CurrentUser, target: ObjectId, action: ActionIn) -> datetime | None:
        now = utcnow()
        until: datetime | None = None
        t = action.type
        if t == ModerationAction.TEMP_SUSPEND:
            if not action.days:
                raise BusinessRuleViolation("days is required for a temporary suspension", code="DAYS_REQUIRED")
            until = now + timedelta(days=action.days)
            fields: dict[str, Any] = {"account_status": AccountStatus.SUSPENDED.value, "suspended_until": until}
        elif t == ModerationAction.PERMANENT_SUSPEND:
            fields = {"account_status": AccountStatus.SUSPENDED.value, "suspended_until": None}
        elif t == ModerationAction.RESTRICT_MATCHMAKING:
            fields = {"account_status": AccountStatus.RESTRICTED.value}
        elif t == ModerationAction.LIFT_RESTRICTIONS:
            fields = {"account_status": AccountStatus.ACTIVE.value, "suspended_until": None}
        else:
            fields = {}
        if fields:
            await self.c.mongo["users"].update_one(
                {"_id": target, "account_status": {"$ne": "deleted"}}, {"$set": {**fields, "updated_at": now}}
            )
        if t in (ModerationAction.TEMP_SUSPEND, ModerationAction.PERMANENT_SUSPEND):
            await self.c.mongo["refresh_tokens"].update_many(
                {"user_id": target, "revoked_at": None}, {"$set": {"revoked_at": now}}
            )
        await self.c.audit.log(
            actor_id=admin.id,
            action=f"moderation.{t.value}",
            entity_type="user",
            entity_id=target,
            new_value={"until": until, "reason": action.reason},
            request_id=admin.request_id,
        )
        messages = {
            ModerationAction.WARNING: "You have received a warning from the moderation team.",
            ModerationAction.TEMP_SUSPEND: f"Your account is suspended for {action.days} days.",
            ModerationAction.PERMANENT_SUSPEND: "Your account has been suspended.",
            ModerationAction.RESTRICT_MATCHMAKING: "Your matchmaking access has been restricted.",
            ModerationAction.LIFT_RESTRICTIONS: "Restrictions on your account have been lifted.",
        }
        await self.c.notifications.notify(
            [target], NotificationType.MODERATION, "Moderation notice", f"{messages[t]} Reason: {action.reason}", {}
        )
        return until

    async def _user(self, uid: ObjectId) -> dict[str, Any]:
        return await self.c.mongo["users"].find_one({"_id": uid}) or {"_id": uid, "full_name": "User"}

    async def _out(self, r: dict[str, Any]) -> ReportOut:
        return ReportOut(
            id=str(r["_id"]),
            report_code=r["report_code"],
            category=r["category"],
            description=r["description"],
            status=r["status"],
            target=public_user(await self._user(r["target_user_id"])),
            match_id=str(r["match_id"]) if r.get("match_id") else None,
            evidence_urls=r.get("evidence_urls", []),
            created_at=r["created_at"],
            updated_at=r["updated_at"],
        )

    async def _admin_out(self, r: dict[str, Any]) -> AdminReportOut:
        base = await self._out(r)
        target = await self._user(r["target_user_id"])
        triage = r.get("ai_triage")
        return AdminReportOut(
            **base.model_dump(),
            reporter=public_user(await self._user(r["reporter_id"])),
            target_account_status=target.get("account_status", "active"),
            prior_reports_against_target=await self.col.count_documents(
                {"target_user_id": r["target_user_id"], "_id": {"$ne": r["_id"]}}
            ),
            ai_triage=AITriageOut(
                **{k: triage[k] for k in ("severity", "summary", "suggested_action", "rationale", "model")}
            )
            if triage
            else None,
            investigation_notes=[
                NoteOut(by=str(n["by"]), note=n["note"], at=n["at"]) for n in r.get("investigation_notes", [])
            ],
            actions=[
                ActionOut(action=a["action"], by=str(a["by"]), at=a["at"], until=a.get("until"), reason=a["reason"])
                for a in r.get("actions", [])
            ],
        )
