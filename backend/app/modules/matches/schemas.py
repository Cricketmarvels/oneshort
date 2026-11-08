from datetime import datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.common.enums import (
    Attendance,
    ContributionType,
    MatchCategory,
    MatchFormat,
    MatchStatus,
    PlayingRole,
)
from app.common.types import AwareDatetime, GeoPointIn, ObjectIdStr, StrictModel, utcnow
from app.common.validators import LongText, ShortText, Timezone
from app.modules.users.schemas import PublicUserOut


class RequiredRoles(StrictModel):
    batsman: int = Field(default=0, ge=0, le=11)
    bowler: int = Field(default=0, ge=0, le=11)
    wicketkeeper: int = Field(default=0, ge=0, le=3)
    all_rounder: int = Field(default=0, ge=0, le=11)

    @property
    def total(self) -> int:
        return self.batsman + self.bowler + self.wicketkeeper + self.all_rounder


class VenueIn(StrictModel):
    venue_id: ObjectIdStr | None = None
    name: ShortText
    address: ShortText | None = None
    area: ShortText
    city: ShortText


def _check_window(start: datetime, end: datetime) -> None:
    if end <= start:
        raise ValueError("end_at must be after start_at")
    if end - start > timedelta(hours=12):
        raise ValueError("a match can be at most 12 hours long")
    if start < utcnow() - timedelta(minutes=5):
        raise ValueError("match must start in the future")
    if start > utcnow() + timedelta(days=180):
        raise ValueError("match can be scheduled at most 180 days ahead")


class MatchIn(StrictModel):
    team_id: ObjectIdStr
    title: ShortText = "Weekend match"
    description: LongText | None = None
    venue: VenueIn
    location: GeoPointIn
    start_at: AwareDatetime
    end_at: AwareDatetime
    timezone: Timezone = "Asia/Kolkata"
    format: MatchFormat = MatchFormat.T20
    category: MatchCategory = MatchCategory.FRIENDLY
    squad_capacity: int = Field(default=11, ge=2, le=22)
    required_roles: RequiredRoles = Field(default_factory=RequiredRoles)
    estimated_expenses_paise: int = Field(default=0, ge=0, le=10_000_000)
    default_contribution_type: ContributionType = ContributionType.PAYEE
    captain_plays: bool = True
    captain_role: PlayingRole | None = None
    publish: bool = True

    @model_validator(mode="after")
    def _validate(self) -> "MatchIn":
        _check_window(self.start_at, self.end_at)
        if self.required_roles.total > self.squad_capacity:
            raise ValueError("required_roles add up to more than squad_capacity")
        return self


class MatchUpdateIn(StrictModel):
    title: ShortText | None = None
    description: LongText | None = None
    venue: VenueIn | None = None
    location: GeoPointIn | None = None
    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None
    format: MatchFormat | None = None
    category: MatchCategory | None = None
    squad_capacity: int | None = Field(default=None, ge=2, le=22)
    required_roles: RequiredRoles | None = None
    estimated_expenses_paise: int | None = Field(default=None, ge=0, le=10_000_000)
    default_contribution_type: ContributionType | None = None
    reschedule_reason: ShortText | None = None


class TransitionIn(StrictModel):
    to: Literal["published", "recruiting", "squad_confirmed", "scheduled", "in_progress"]
    allow_short_squad: bool = False


class CancelIn(StrictModel):
    reason: ShortText


class AttendanceItem(StrictModel):
    player_id: ObjectIdStr
    attendance: Attendance


class CompleteIn(StrictModel):
    attendance: list[AttendanceItem] = Field(default_factory=list, max_length=30)


class VenueOut(BaseModel):
    name: str | None
    address: str | None
    area: str | None
    city: str | None
    lat: float | None
    lng: float | None
    restricted: bool = Field(description="True when the full address is hidden from this viewer")


class CompositionOut(BaseModel):
    required: dict[str, int]
    confirmed: dict[str, int]
    capacity: int
    confirmed_total: int
    vacancies: int


class MatchOut(BaseModel):
    id: str
    match_code: str
    team_id: str
    team_name: str
    team_logo: str | None
    captain: PublicUserOut
    title: str
    description: str | None
    venue: VenueOut
    start_at: datetime
    end_at: datetime
    timezone: str
    format: MatchFormat
    category: MatchCategory
    squad_capacity: int
    required_roles: dict[str, int]
    composition: CompositionOut
    estimated_expenses_paise: int
    per_head_fee_paise: int
    default_contribution_type: ContributionType
    match_status: MatchStatus
    allowed_transitions: list[str]
    viewer_relation: Literal["manager", "roster", "invitee", "public"]
    my_invitation_id: str | None
    my_invitation_status: str | None
    my_contribution_type: str | None
    cancelled_reason: str | None
    reschedule_count: int
    created_at: datetime
