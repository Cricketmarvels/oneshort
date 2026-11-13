import hashlib
import json
from datetime import datetime
from typing import Any

from pydantic import BaseModel
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser, agreement_satisfied
from app.common.types import StrictModel, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, NotFound
from app.modules.agreements.legal import PRIVACY_VERSION, privacy, terms


class AgreementSection(BaseModel):
    heading: str
    body: str


class AgreementOut(BaseModel):
    version: int
    title: str
    is_material: bool
    sections: list[AgreementSection]
    published_at: datetime
    effective_date: str | None = None
    privacy_version: int = PRIVACY_VERSION


class LegalDocOut(BaseModel):
    kind: str
    version: int
    title: str
    effective_date: str
    sections: list[AgreementSection]


class AcceptIn(StrictModel):
    version: int
    accepted: bool
    age_confirmed: bool = False  # "I am 18 or older" (DPDP: no children's data without verifiable parental consent)
    privacy_acknowledged: bool = False  # read the Privacy Notice and consent to the processing it describes


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
        """Publish the current Terms (rendered with this deployment's company details) and retire older versions."""
        doc = terms(self.c.settings)
        now = utcnow()
        await self.col.update_one(
            {"version": doc["version"]},
            {
                "$set": {k: doc[k] for k in ("title", "sections", "is_material", "effective_date")}
                | {"is_current": True},
                "$setOnInsert": {"published_at": now},
            },
            upsert=True,
        )
        await self.col.update_many({"version": {"$ne": doc["version"]}}, {"$set": {"is_current": False}})

    def legal_doc(self, kind: str) -> LegalDocOut:
        doc = terms(self.c.settings) if kind == "terms" else privacy(self.c.settings)
        return LegalDocOut(**{k: doc[k] for k in ("kind", "version", "title", "effective_date", "sections")})

    @staticmethod
    def fingerprint(doc: dict[str, Any]) -> str:
        """SHA-256 of the exact text shown, so an acceptance proves what the person agreed to."""
        body = json.dumps({"title": doc["title"], "sections": doc["sections"]}, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(body.encode()).hexdigest()

    async def current(self) -> dict[str, Any]:
        doc = await self.col.find_one({"is_current": True}, sort=[("version", -1)])
        if not doc:
            raise NotFound("No agreement published")
        return doc

    @staticmethod
    def to_out(doc: dict[str, Any]) -> AgreementOut:
        return AgreementOut(
            version=doc["version"],
            effective_date=doc.get("effective_date"),
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
        if data.version >= 2 and not data.age_confirmed:
            raise BusinessRuleViolation("OneShort is for people aged 18 or over", code="AGE_NOT_CONFIRMED")
        if data.version >= 2 and not data.privacy_acknowledged:
            raise BusinessRuleViolation(
                "Please read and accept the Privacy Notice to continue", code="PRIVACY_NOT_ACKNOWLEDGED"
            )
        now = utcnow()
        notice = privacy(self.c.settings)
        try:
            await self.acc.insert_one(
                {
                    "user_id": user.id,
                    "agreement_version": data.version,
                    "accepted": True,
                    "accepted_at": now,
                    "age_confirmed": data.age_confirmed,
                    "privacy_version": notice["version"] if data.privacy_acknowledged else None,
                    "terms_sha256": self.fingerprint(current),
                    "privacy_sha256": self.fingerprint(notice) if data.privacy_acknowledged else None,
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
            {
                "$set": {
                    "agreement_version_accepted": data.version,
                    "privacy_version_accepted": notice["version"] if data.privacy_acknowledged else None,
                    "age_confirmed_at": now if data.age_confirmed else None,
                    "updated_at": now,
                }
            },
        )
        await self.c.audit.log(
            actor_id=user.id,
            action="agreement.accepted",
            entity_type="user",
            entity_id=user.id,
            new_value={
                "version": data.version,
                "age_confirmed": data.age_confirmed,
                "privacy": data.privacy_acknowledged,
            },
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
