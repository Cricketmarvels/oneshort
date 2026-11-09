"""Data principal requests under the DPDP Act, 2023 (ss. 11-14): access, correction, erasure, withdrawal of consent,
nomination and grievances. Each request gets a reference, the legal deadline (90 days under the DPDP Rules, 2025) and
an internal target (30 days), and every step is audited. Admins work the queue at /admin/privacy-requests."""

import secrets
from datetime import datetime, timedelta
from typing import Annotated, Any, Literal

from bson import ObjectId
from fastapi import APIRouter, Query
from pydantic import BaseModel, Field, model_validator

from app.api.dependencies import AdminDep, ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import ObjectIdStr, StrictModel, utcnow
from app.core.exceptions import BusinessRuleViolation, NotFound

RequestType = Literal["access", "correction", "erasure", "withdraw_consent", "nomination", "grievance"]
Status = Literal["open", "in_progress", "resolved", "rejected", "closed"]
LEGAL_DAYS = 90
TARGET_DAYS = 30
MAX_OPEN = 10

router = APIRouter(prefix="/privacy", tags=["Privacy"], responses=ERROR_RESPONSES)
admin_router = APIRouter(prefix="/admin/privacy-requests", tags=["Admin moderation"], responses=ERROR_RESPONSES)


class PrivacyRequestIn(StrictModel):
    type: RequestType
    details: str = Field(min_length=10, max_length=2000)
    nominee_name: str | None = Field(default=None, max_length=120)
    nominee_contact: str | None = Field(default=None, max_length=120)

    @model_validator(mode="after")
    def _nominee(self) -> "PrivacyRequestIn":
        if self.type == "nomination" and not (self.nominee_name and self.nominee_contact):
            raise ValueError("A nomination needs the nominee's name and a phone number or email")
        return self


class PrivacyRequestOut(BaseModel):
    id: str
    reference: str
    type: RequestType
    details: str
    status: Status
    resolution: str | None
    created_at: datetime
    respond_by: datetime = Field(description="Internal target (30 days)")
    legal_deadline: datetime = Field(description="Latest response date under the DPDP Rules (90 days)")
    resolved_at: datetime | None


class ResolveIn(StrictModel):
    status: Literal["in_progress", "resolved", "rejected"]
    resolution: str = Field(min_length=5, max_length=2000)


def _out(d: dict[str, Any]) -> PrivacyRequestOut:
    return PrivacyRequestOut(
        id=str(d["_id"]),
        reference=d["reference"],
        type=d["type"],
        details=d["details"],
        status=d["status"],
        resolution=d.get("resolution"),
        created_at=d["created_at"],
        respond_by=d["respond_by"],
        legal_deadline=d["legal_deadline"],
        resolved_at=d.get("resolved_at"),
    )


@router.post("/requests", response_model=Envelope[PrivacyRequestOut], status_code=201, summary="Make a privacy request")
async def create_request(data: PrivacyRequestIn, user: UserDep, c: ContainerDep) -> Envelope[PrivacyRequestOut]:
    col = c.mongo["privacy_requests"]
    if await col.count_documents({"user_id": user.id, "status": {"$in": ["open", "in_progress"]}}) >= MAX_OPEN:
        raise BusinessRuleViolation("You have several open requests. We'll reply to those first.", code="TOO_MANY_OPEN")
    now = utcnow()
    doc = {
        "user_id": user.id,
        "reference": "PR-" + secrets.token_hex(4).upper(),
        "type": data.type,
        "details": data.details,
        "nominee": {"name": data.nominee_name, "contact": data.nominee_contact} if data.type == "nomination" else None,
        "status": "open",
        "created_at": now,
        "respond_by": now + timedelta(days=TARGET_DAYS),
        "legal_deadline": now + timedelta(days=LEGAL_DAYS),
    }
    res = await col.insert_one(doc)
    doc["_id"] = res.inserted_id
    await c.audit.log(
        actor_id=user.id,
        action="privacy.request_created",
        entity_type="privacy_request",
        entity_id=res.inserted_id,
        new_value={"type": data.type, "reference": doc["reference"]},
        request_id=user.request_id,
    )
    return ok(_out(doc))


@router.get("/requests/me", response_model=Envelope[list[PrivacyRequestOut]], summary="My privacy requests")
async def my_requests(user: UserDep, c: ContainerDep) -> Envelope[list[PrivacyRequestOut]]:
    rows = c.mongo["privacy_requests"].find({"user_id": user.id}).sort("created_at", -1).limit(50)
    return ok([_out(d) async for d in rows])


class AdminPrivacyRequestOut(PrivacyRequestOut):
    user_id: str
    nominee: dict[str, Any] | None
    overdue: bool


@admin_router.get("", response_model=Envelope[list[AdminPrivacyRequestOut]], summary="Privacy request queue")
async def queue(
    _: AdminDep, c: ContainerDep, status: Annotated[Status | None, Query()] = None
) -> Envelope[list[AdminPrivacyRequestOut]]:
    q: dict[str, Any] = {"status": status} if status else {"status": {"$in": ["open", "in_progress"]}}
    now = utcnow()
    rows = c.mongo["privacy_requests"].find(q).sort("legal_deadline", 1).limit(200)
    return ok(
        [
            AdminPrivacyRequestOut(
                **_out(d).model_dump(),
                user_id=str(d["user_id"]),
                nominee=d.get("nominee"),
                overdue=d["status"] in ("open", "in_progress") and d["respond_by"].replace(tzinfo=now.tzinfo) < now,
            )
            async for d in rows
        ]
    )


@admin_router.post(
    "/{request_id}/resolve", response_model=Envelope[PrivacyRequestOut], summary="Update a privacy request"
)
async def resolve(
    request_id: ObjectIdStr, data: ResolveIn, admin: AdminDep, c: ContainerDep
) -> Envelope[PrivacyRequestOut]:
    col = c.mongo["privacy_requests"]
    rid = ObjectId(request_id)
    now = utcnow()
    upd: dict[str, Any] = {"status": data.status, "resolution": data.resolution, "updated_at": now}
    if data.status != "in_progress":
        upd |= {"resolved_at": now, "resolved_by": admin.id}
    doc = await col.find_one_and_update({"_id": rid}, {"$set": upd}, return_document=True)
    if not doc:
        raise NotFound("Request not found")
    await c.audit.log(
        actor_id=admin.id,
        action="privacy.request_updated",
        entity_type="privacy_request",
        entity_id=rid,
        new_value={"status": data.status},
        request_id=admin.request_id,
    )
    return ok(_out(doc))
