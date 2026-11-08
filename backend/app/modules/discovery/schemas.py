from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.common.enums import (
    BattingStyle,
    BowlingStyle,
    MatchCategory,
    MatchFormat,
    PlayingRole,
)
from app.common.response import PageMeta
from app.common.types import AwareDatetime, GeoPointIn, ObjectIdStr, StrictModel
from app.modules.users.schemas import PublicUserOut

Radius = Literal[5, 10, 15, 20]


class PlayerSearchIn(StrictModel):
    match_id: ObjectIdStr | None = Field(default=None, description="Use the match's venue and time window")
    start_at: AwareDatetime | None = None
    end_at: AwareDatetime | None = None
    location: GeoPointIn | None = Field(default=None, description="Search origin (venue) when no match_id")
    radius_km: Radius = 10
    roles: list[PlayingRole] = Field(default_factory=list, max_length=4)
    players_needed: int | None = Field(default=None, ge=1, le=22)
    role_counts: dict[PlayingRole, int] = Field(
        default_factory=dict,
        description="How many of each role you need, e.g. {bowler: 1, wicket_keeper: 1, batsman: 3}. "
        "Implies roles and (if unset) players_needed = total.",
    )
    min_rating: float | None = Field(default=None, ge=1, le=5)
    include_tentative: bool = True
    allow_partial: bool = False
    page: int = Field(default=1, ge=1, le=100)
    page_size: int = Field(default=20, ge=1, le=50)

    @model_validator(mode="after")
    def _origin(self) -> "PlayerSearchIn":
        if any(n < 1 or n > 11 for n in self.role_counts.values()):
            raise ValueError("each role count must be between 1 and 11")
        if self.role_counts:
            self.roles = list(dict.fromkeys([*self.roles, *self.role_counts]))
            if self.players_needed is None:
                self.players_needed = min(22, sum(self.role_counts.values()))
        if self.match_id is None:
            if self.start_at is None or self.end_at is None or self.location is None:
                raise ValueError("provide match_id, or start_at + end_at + location")
            if self.end_at <= self.start_at:
                raise ValueError("end_at must be after start_at")
        return self


class PlayerResultOut(BaseModel):
    player: PublicUserOut
    primary_role: PlayingRole
    secondary_roles: list[PlayingRole]
    role_match: Literal["primary", "secondary", "any"]
    matched_role: PlayingRole | None = Field(
        default=None, description="Which requested role this player fills (primary role preferred)"
    )
    batting_style: BattingStyle | None
    bowling_style: BowlingStyle | None
    experience_years: int | None
    approx_distance_km: float = Field(description="Rounded to 0.5 km; exact location is never disclosed")
    availability_status: Literal["available", "tentative"]
    coverage: float
    average_rating: float | None
    rating_count: int
    reliability_score: float
    matches_played: int
    is_team_member: bool
    score: float
    score_breakdown: dict[str, float]


class PlayerSearchMeta(PageMeta):
    radius_km: int
    ranker: str
    players_needed: int | None
    role_counts: dict[str, int] = Field(default_factory=dict)
    role_supply: dict[str, int] = Field(
        default_factory=dict, description="Available players found per requested role (all pages)"
    )


class PlayerSearchOut(BaseModel):
    data: list[PlayerResultOut]
    meta: PlayerSearchMeta


class TeamSearchIn(StrictModel):
    location: GeoPointIn | None = Field(default=None, description="Defaults to your profile location")
    radius_km: Radius = 10
    start_at: AwareDatetime | None = Field(default=None, description="Window start (match must start after)")
    end_at: AwareDatetime | None = Field(default=None, description="Window end (match must end before)")
    use_my_availability: bool = Field(default=False, description="Only matches inside my declared slots")
    role: PlayingRole | None = None
    format: MatchFormat | None = None
    category: MatchCategory | None = None
    max_fee_paise: int | None = Field(default=None, ge=0)
    page: int = Field(default=1, ge=1, le=100)
    page_size: int = Field(default=20, ge=1, le=50)


class TeamBrief(BaseModel):
    id: str
    team_name: str
    logo: str | None
    category: MatchCategory
    area: str | None
    average_rating: float | None
    captain: PublicUserOut
    captain_rating: float | None


class OpportunityOut(BaseModel):
    match_id: str
    match_code: str
    title: str
    start_at: datetime
    end_at: datetime
    timezone: str
    format: MatchFormat
    category: MatchCategory
    area: str | None
    city: str | None
    approx_distance_km: float
    vacancies: int
    squad_capacity: int
    roles_needed: dict[str, int]
    per_head_fee_paise: int
    default_contribution_type: str
    team: TeamBrief
    my_status: str | None


class TeamSearchOut(BaseModel):
    data: list[OpportunityOut]
    meta: PageMeta
