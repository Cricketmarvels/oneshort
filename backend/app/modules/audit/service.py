"""Append-only audit trail shared by all modules."""

from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession

from app.common.types import utcnow
from app.core.logging import get_logger
from app.infrastructure.database.mongo import Mongo

log = get_logger("audit")


def _jsonable(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: _jsonable(v) for k, v in value.items() if k not in ("location", "home_location")}
    if isinstance(value, list):
        return [_jsonable(v) for v in value]
    return value


class AuditService:
    def __init__(self, mongo: Mongo) -> None:
        self.col = mongo["audit_logs"]

    async def log(
        self,
        *,
        actor_id: ObjectId | None,
        action: str,
        entity_type: str,
        entity_id: ObjectId | str,
        previous_value: Any = None,
        new_value: Any = None,
        request_id: str | None = None,
        session: AsyncClientSession | None = None,
    ) -> None:
        await self.col.insert_one(
            {
                "actor_id": actor_id,
                "action": action,
                "entity_type": entity_type,
                "entity_id": entity_id,
                "previous_value": _jsonable(previous_value),
                "new_value": _jsonable(new_value),
                "request_id": request_id,
                "timestamp": utcnow(),
            },
            session=session,
        )

    async def for_entity(self, entity_type: str, entity_id: ObjectId, limit: int = 100) -> list[dict[str, Any]]:
        cursor = self.col.find({"entity_type": entity_type, "entity_id": entity_id}).sort("timestamp", -1).limit(limit)
        return [d async for d in cursor]
