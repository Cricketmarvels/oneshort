from datetime import datetime
from typing import Any

from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser, agreement_satisfied
from app.common.types import StrictModel, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, NotFound
from app.modules.agreements.content import AGREEMENT_V1


class AgreementSection(BaseModel):
    heading: str
    body: str


class AgreementOut(BaseModel):
    version: int
    title: str
    is_material: bool
    sections: list[AgreementSection]
    published_at: datetime


class AcceptIn(StrictModel):
    version: int
    accepted: bool


class AcceptanceOut(BaseModel):
    agreement_version: int
    accepted: bool
    accepted_at: datetime


class MyAgreementsOut(BaseModel):
    current_version: int
    satisfied: bool
    acceptances: list[AcceptanceOut]


class AgreementService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["agreements"]
        self.acc = c.mongo["user_agreements"]

    async def seed_default(self) -> None:
        if await self.col.count_documents({}, limit=1) == 0:
            await self.col.insert_one({**AGREEMENT_V1, "is_current": True, "published_at": utcnow()})

    async def current(self) -> dict[str, Any]:
        doc = await self.col.find_one({"is_current": True}, sort=[("version", -1)])
        if not doc:
            raise NotFound("No agreement published")
        return doc

    @staticmethod
    def to_out(doc: dict[str, Any]) -> AgreementOut:
        return AgreementOut(
            version=doc["version"],
            title=doc["title"],
            is_material=doc["is_material"],
            sections=[AgreementSection(**s) for s in doc["sections"]],
            published_at=doc["published_at"],
        )

    async def accept(self, user: CurrentUser, data: AcceptIn, ip: str | None, ua: str | None) -> MyAgreementsOut:
        if not data.accepted:
            raise BusinessRuleViolation(
                "You must accept the agreement to use matchmaking", code="AGREEMENT_NOT_ACCEPTED"
            )
        current = await self.current()
        if data.version != current["version"]:
            raise BusinessRuleViolation(
                "Please accept the current agreement version", code="AGREEMENT_VERSION_MISMATCH"
            )
        now = utcnow()
        try:
            await self.acc.insert_one(
                {
                    "user_id": user.id,
                    "agreement_version": data.version,
                    "accepted": True,
                    "accepted_at": now,
                    "ip": ip,
                    "user_agent": (ua or "")[:200],
                }
            )
        except DuplicateKeyError:
            pass  # idempotent
        await self.c.mongo["users"].update_one(
            {
                "_id": user.id,
                "$or": [{"agreement_version_accepted": None}, {"agreement_version_accepted": {"$lt": data.version}}],
            },
            {"$set": {"agreement_version_accepted": data.version, "updated_at": now}},
        )
        await self.c.audit.log(
            actor_id=user.id,
            action="agreement.accepted",
            entity_type="user",
            entity_id=user.id,
            new_value={"version": data.version},
            request_id=user.request_id,
        )
        return await self.mine(user)

    async def mine(self, user: CurrentUser) -> MyAgreementsOut:
        current = await self.current()
        user_doc = await self.c.mongo["users"].find_one({"_id": user.id}) or user.doc
        rows = [
            AcceptanceOut(
                agreement_version=d["agreement_version"], accepted=d["accepted"], accepted_at=d["accepted_at"]
            )
            async for d in self.acc.find({"user_id": user.id}).sort("accepted_at", -1)
        ]
        return MyAgreementsOut(
            current_version=current["version"], satisfied=await agreement_satisfied(self.c, user_doc), acceptances=rows
        )
