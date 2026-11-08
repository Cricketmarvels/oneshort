from datetime import datetime, timedelta

from pydantic import BaseModel, Field, model_validator

from app.common.enums import AvailabilityStatus
from app.common.types import AwareDatetime, GeoPointIn, StrictModel, utcnow
from app.common.validators import ShortText, Timezone

MAX_SLOT_HOURS = 16
MAX_DAYS_AHEAD = 120


class _SlotTimes(StrictModel):
    start_at: AwareDatetime
    end_at: AwareDatetime

    @model_validator(mode="after")
    def _check_times(self) -> "_SlotTimes":
        if self.end_at <= self.start_at:
            raise ValueError("end_at must be after start_at")
        if self.end_at - self.start_at > timedelta(hours=MAX_SLOT_HOURS):
            raise ValueError(f"a slot can be at most {MAX_SLOT_HOURS} hours long")
        now = utcnow()
        if self.end_at <= now:
            raise ValueError("slot must end in the future")
        if self.start_at > now + timedelta(days=MAX_DAYS_AHEAD):
            raise ValueError(f"slots can be at most {MAX_DAYS_AHEAD} days ahead")
        return self


class AvailabilityIn(_SlotTimes):
    timezone: Timezone = "Asia/Kolkata"
    status: AvailabilityStatus = AvailabilityStatus.AVAILABLE
    location: GeoPointIn | None = Field(
        default=None, description="Preferred location; defaults to the profile location"
    )
    location_label: ShortText | None = None
    max_travel_km: int = Field(default=10, ge=1, le=50)
    note: ShortText | None = None
    repeat_weeks: int = Field(default=0, ge=0, le=8, description="Also create the same slot for N following weeks")


class AvailabilityUpdateIn(StrictModel):
    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None
    timezone: Timezone | None = None
    status: AvailabilityStatus | None = None
    location: GeoPointIn | None = None
    location_label: ShortText | None = None
    max_travel_km: int | None = Field(default=None, ge=1, le=50)
    note: ShortText | None = None


class AvailabilityOut(BaseModel):
    """Owner's own view. Includes the location because it is their own data."""

    id: str
    start_at: datetime
    end_at: datetime
    timezone: str
    status: AvailabilityStatus
    location_label: str | None
    lat: float
    lng: float
    max_travel_km: int
    note: str | None
    visibility: str
