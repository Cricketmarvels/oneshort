"""Shared Pydantic types: ObjectId parsing, GeoJSON points, time helpers."""

from datetime import UTC, datetime
from typing import Annotated, Any, Literal

from bson import ObjectId
from bson.errors import InvalidId
from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from app.core.exceptions import NotFound, ValidationFailed


def parse_object_id(value: str, *, field: str = "id", not_found: bool = False) -> ObjectId:
    try:
        return ObjectId(value)
    except (InvalidId, TypeError) as exc:
        if not_found:
            raise NotFound(f"{field} not found") from exc
        raise ValidationFailed(f"Invalid {field}", code="INVALID_ID") from exc


def _validate_oid_str(v: str) -> str:
    if not ObjectId.is_valid(v):
        raise ValueError("must be a 24-character hex ObjectId")
    return v


ObjectIdStr = Annotated[str, AfterValidator(_validate_oid_str)]


def utcnow() -> datetime:
    return datetime.now(UTC)


def ensure_utc(dt: datetime) -> datetime:
    """Normalise to aware UTC. Naive datetimes are rejected upstream; Mongo returns naive UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _require_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        raise ValueError("datetime must include a timezone offset (e.g. 2026-11-08T07:00:00+05:30)")
    return dt.astimezone(UTC)


AwareDatetime = Annotated[datetime, AfterValidator(_require_aware)]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class GeoPointIn(StrictModel):
    """Client-supplied coordinate. Stored as GeoJSON with longitude first."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)

    def to_geojson(self) -> dict[str, Any]:
        return {"type": "Point", "coordinates": [self.lng, self.lat]}


class GeoPointOut(BaseModel):
    lat: float
    lng: float

    @classmethod
    def from_geojson(cls, doc: dict[str, Any] | None) -> "GeoPointOut | None":
        if not doc:
            return None
        lng, lat = doc["coordinates"]
        return cls(lat=lat, lng=lng)


def approx_km(distance_m: float) -> float:
    """Round a distance to the nearest 0.5 km (minimum 0.5) for privacy."""
    km = distance_m / 1000.0
    return max(0.5, round(km * 2) / 2)


Currency = Literal["INR"]


def oid(value: Any) -> str:
    return str(value) if value is not None else ""
