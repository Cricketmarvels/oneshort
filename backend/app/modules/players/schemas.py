from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field, model_validator

from app.common.enums import (
    BattingStyle,
    BowlingStyle,
    MatchFormat,
    PlayingRole,
    TimeOfDay,
    Visibility,
    Weekday,
)
from app.common.types import GeoPointIn, GeoPointOut, StrictModel
from app.common.validators import LongText, ShortText, Url


def _cricheroes(v: str) -> str:
    if "cricheroes" not in v.lower():
        raise ValueError("must be a CricHeroes profile URL")
    return v


CricHeroesUrl = Annotated[Url, AfterValidator(_cricheroes)]


class PlayerProfileIn(StrictModel):
    primary_role: PlayingRole
    secondary_roles: list[PlayingRole] = Field(default_factory=list, max_length=3)
    batting_style: BattingStyle | None = None
    bowling_style: BowlingStyle | None = None
    experience_years: int | None = Field(default=None, ge=0, le=60)
    preferred_formats: list[MatchFormat] = Field(default_factory=list, max_length=4)
    preferred_days: list[Weekday] = Field(default_factory=list, max_length=7)
    preferred_timing: list[TimeOfDay] = Field(default_factory=list, max_length=4)
    cricheroes_url: CricHeroesUrl | None = None
    previous_teams: list[ShortText] = Field(default_factory=list, max_length=10)
    bio: LongText | None = None
    locality: ShortText | None = Field(default=None, description="Neighbourhood shown publicly, e.g. 'Sector 18'")
    home_location: GeoPointIn | None = Field(
        default=None, description="Device location (with permission). Never shown to other users."
    )
    availability_visibility: Visibility = Visibility.DISCOVERABLE

    @model_validator(mode="after")
    def _secondary_excludes_primary(self) -> "PlayerProfileIn":
        self.secondary_roles = [r for r in dict.fromkeys(self.secondary_roles) if r != self.primary_role]
        return self


class PlayerStats(BaseModel):
    matches_played: int = 0
    attended: int = 0
    no_shows: int = 0
    late_withdrawals: int = 0
    invitations_received: int = 0
    invitations_responded: int = 0
    response_rate: float | None = None


class PlayerPublicOut(BaseModel):
    """Profile as visible to other users: no location, no contact details."""

    user_id: str
    full_name: str
    profile_image: str | None
    city: str | None
    primary_role: PlayingRole
    secondary_roles: list[PlayingRole]
    batting_style: BattingStyle | None
    bowling_style: BowlingStyle | None
    experience_years: int | None
    preferred_formats: list[MatchFormat]
    preferred_days: list[Weekday]
    preferred_timing: list[TimeOfDay]
    cricheroes_url: str | None
    previous_teams: list[str]
    bio: str | None
    locality: str | None = None
    average_rating: float | None
    rating_count: int
    rating_breakdown: dict[str, float]
    reliability_score: float
    stats: PlayerStats
    member_since: datetime


class PlayerSelfOut(PlayerPublicOut):
    home_location: GeoPointOut | None
    availability_visibility: Visibility
    missing_fields: list[str]
