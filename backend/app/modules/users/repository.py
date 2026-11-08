from typing import Any

from bson import ObjectId
from pymongo import ReturnDocument
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError

from app.common.types import utcnow
from app.core.exceptions import Conflict
from app.infrastructure.database.mongo import Mongo


class UserRepository:
    def __init__(self, mongo: Mongo) -> None:
        self.col = mongo["users"]

    async def get(self, user_id: ObjectId) -> dict[str, Any] | None:
        return await self.col.find_one({"_id": user_id})

    async def by_mobile(self, mobile: str) -> dict[str, Any] | None:
        return await self.col.find_one({"mobile_number": mobile})

    async def by_email(self, email: str) -> dict[str, Any] | None:
        return await self.col.find_one({"email": email.lower()})

    async def insert(self, doc: dict[str, Any]) -> dict[str, Any]:
        try:
            res = await self.col.insert_one(doc)
        except DuplicateKeyError as exc:
            field = "email" if "email" in str(exc) else "mobile number"
            raise Conflict(f"An account with this {field} already exists", code="ACCOUNT_EXISTS") from exc
        doc["_id"] = res.inserted_id
        return doc

    async def update(
        self, user_id: ObjectId, fields: dict[str, Any], session: AsyncClientSession | None = None
    ) -> dict[str, Any] | None:
        fields = {**fields, "updated_at": utcnow()}
        try:
            return await self.col.find_one_and_update(
                {"_id": user_id},
                {"$set": fields},
                return_document=ReturnDocument.AFTER,
                session=session,
            )
        except DuplicateKeyError as exc:
            raise Conflict("Email already in use", code="EMAIL_IN_USE") from exc

    async def add_role(self, user_id: ObjectId, role: str, session: AsyncClientSession | None = None) -> None:
        await self.col.update_one({"_id": user_id}, {"$addToSet": {"roles": role}}, session=session)

    async def names(self, ids: list[ObjectId]) -> dict[ObjectId, dict[str, Any]]:
        cursor = self.col.find({"_id": {"$in": ids}}, {"full_name": 1, "profile_image": 1, "city": 1})
        return {d["_id"]: d async for d in cursor}
