"""Availability management.

Conflicts: a player cannot hold two slots whose time ranges overlap (any status).
Concurrent submissions are serialised per player by bumping ``player_profiles._lock`` inside
the transaction: two concurrent transactions touching the same document produce a write
conflict, so one retries and then sees the other's slot.
"""

from datetime import datetime, timedelta
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.enums import AvailabilityStatus
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, NotFound, ValidationFailed
from app.modules.availability.schemas import (
    MAX_SLOT_HOURS,
    AvailabilityIn,
    AvailabilityOut,
    AvailabilityUpdateIn,
)


def to_out(d: dict[str, Any]) -> AvailabilityOut:
    lng, lat = d["location"]["coordinates"]
    return AvailabilityOut(
        id=str(d["_id"]),
        start_at=d["start_at"],
        end_at=d["end_at"],
        timezone=d["timezone"],
        status=d["status"],
        location_label=d.get("location_label"),
        lat=lat,
        lng=lng,
        max_travel_km=d["max_travel_km"],
        note=d.get("note"),
        visibility=d.get("visibility", "discoverable"),
    )


class AvailabilityService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.col = c.mongo["availability"]
        self.profiles = c.mongo["player_profiles"]

    async def _profile(self, user_id: ObjectId) -> dict[str, Any]:
        prof = await self.profiles.find_one({"user_id": user_id})
        if not prof:
            raise BusinessRuleViolation("Create your player profile first", code="PLAYER_PROFILE_MISSING")
        return prof

    async def _conflict(
        self, player_id: ObjectId, start: datetime, end: datetime, exclude: ObjectId | None, s: AsyncClientSession
    ) -> dict[str, Any] | None:
        q: dict[str, Any] = {"player_id": player_id, "start_at": {"$lt": end}, "end_at": {"$gt": start}}
        if exclude:
            q["_id"] = {"$ne": exclude}
        return await self.col.find_one(q, session=s)

    async def create(self, user: CurrentUser, data: AvailabilityIn) -> list[AvailabilityOut]:
        prof = await self._profile(user.id)
        if data.location is not None:
            location = data.location.to_geojson()
        elif prof.get("home_location"):
            location = prof["home_location"]
        else:
            raise ValidationFailed(
                "Share your location or choose a preferred location for this slot", code="LOCATION_REQUIRED"
            )
        now = utcnow()
        base = {
            "player_id": user.id,
            "timezone": data.timezone,
            "status": data.status.value,
            "location": location,
            "location_label": data.location_label,
            "max_travel_km": data.max_travel_km,
            "note": data.note,
            "visibility": prof.get("availability_visibility", "discoverable"),
            "created_at": now,
            "updated_at": now,
        }
        docs = [
            {**base, "start_at": data.start_at + timedelta(weeks=w), "end_at": data.end_at + timedelta(weeks=w)}
            for w in range(data.repeat_weeks + 1)
        ]

        async def txn(s: AsyncClientSession) -> list[dict[str, Any]]:
            await self.profiles.update_one({"user_id": user.id}, {"$inc": {"_lock": 1}}, session=s)
            for d in docs:
                clash = await self._conflict(user.id, d["start_at"], d["end_at"], None, s)
                if clash:
                    raise Conflict(
                        "This slot overlaps an existing availability slot",
                        code="AVAILABILITY_CONFLICT",
                        details=[
                            {
                                "conflicting_slot_id": str(clash["_id"]),
                                "start_at": ensure_utc(clash["start_at"]).isoformat(),
                                "end_at": ensure_utc(clash["end_at"]).isoformat(),
                            }
                        ],
                    )
            try:
                res = await self.col.insert_many([dict(d) for d in docs], session=s)
            except DuplicateKeyError as exc:
                raise Conflict("Duplicate availability slot", code="AVAILABILITY_DUPLICATE") from exc
            return [{**d, "_id": i} for d, i in zip(docs, res.inserted_ids, strict=True)]

        created = await self.c.mongo.transaction(txn)
        return [to_out(d) for d in created]

    async def list_mine(
        self, user: CurrentUser, start: datetime | None, end: datetime | None, include_past: bool
    ) -> list[AvailabilityOut]:
        q: dict[str, Any] = {"player_id": user.id}
        lower = None if include_past else utcnow()
        if start:
            lower = max(start, lower) if lower else start
        if lower:
            q["end_at"] = {"$gt": lower}
        if end:
            q["start_at"] = {"$lt": end}
        return [to_out(d) async for d in self.col.find(q).sort("start_at", 1).limit(500)]

    async def update(self, user: CurrentUser, slot_id: ObjectId, data: AvailabilityUpdateIn) -> AvailabilityOut:
        current = await self.col.find_one({"_id": slot_id, "player_id": user.id})
        if not current:
            raise NotFound("Availability slot not found")
        fields = data.model_dump(exclude_unset=True, mode="json", exclude={"location", "start_at", "end_at"})
        start = data.start_at or ensure_utc(current["start_at"])
        end = data.end_at or ensure_utc(current["end_at"])
        if end <= start:
            raise ValidationFailed("end_at must be after start_at")
        if end - start > timedelta(hours=MAX_SLOT_HOURS):
            raise ValidationFailed(f"a slot can be at most {MAX_SLOT_HOURS} hours long")
        fields.update({"start_at": start, "end_at": end, "updated_at": utcnow()})
        if data.location is not None:
            fields["location"] = data.location.to_geojson()

        async def txn(s: AsyncClientSession) -> None:
            await self.profiles.update_one({"user_id": user.id}, {"$inc": {"_lock": 1}}, session=s)
            if await self._conflict(user.id, start, end, slot_id, s):
                raise Conflict("This slot overlaps an existing availability slot", code="AVAILABILITY_CONFLICT")
            await self.col.update_one({"_id": slot_id}, {"$set": fields}, session=s)

        await self.c.mongo.transaction(txn)
        doc = await self.col.find_one({"_id": slot_id})
        assert doc is not None
        return to_out(doc)

    async def delete(self, user: CurrentUser, slot_id: ObjectId) -> None:
        res = await self.col.delete_one({"_id": slot_id, "player_id": user.id})
        if res.deleted_count == 0:
            raise NotFound("Availability slot not found")

    # ------------------------------------------------------------- queries
    async def status_for_window(self, player_id: ObjectId, start: datetime, end: datetime) -> dict[str, Any]:
        """Summarise a player's declared availability for a time window.

        Returns ``{"state": "available"|"tentative"|"unavailable"|"partial"|"unknown", "coverage": float}``.
        """
        from app.modules.availability.overlap import merged_coverage

        slots = [
            d async for d in self.col.find({"player_id": player_id, "start_at": {"$lt": end}, "end_at": {"$gt": start}})
        ]
        if not slots:
            return {"state": "unknown", "coverage": 0.0}
        if any(s["status"] == AvailabilityStatus.UNAVAILABLE for s in slots):
            return {"state": "unavailable", "coverage": 0.0}
        positive = [(ensure_utc(s["start_at"]), ensure_utc(s["end_at"])) for s in slots]
        coverage = merged_coverage(positive, start, end)
        if coverage < 0.999:
            return {"state": "partial", "coverage": round(coverage, 2)}
        state = "tentative" if any(s["status"] == AvailabilityStatus.TENTATIVE for s in slots) else "available"
        return {"state": state, "coverage": 1.0}
