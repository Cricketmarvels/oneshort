from datetime import datetime
from typing import Annotated

from pydantic import AfterValidator, BaseModel, Field

from app.common.enums import FixtureFormat, MatchCategory, PlayingRole, TeamMemberRole
from app.common.media import OwnMediaUrl
from app.common.types import GeoPointIn, ObjectIdStr, StrictModel
from app.common.validators import LongText, MobileNumber, ShortText
from app.modules.cricheroes.urls import normalize_profile_url
from app.modules.users.schemas import PublicUserOut


def _ch_team(v: str) -> str:
    """Strict: https, exact cricheroes.com host, /team-profile/<id>/… — returns the normalised link."""
    return normalize_profile_url(v, "team")[0]


CricHeroesTeamUrl = Annotated[str, AfterValidator(_ch_team)]


class TeamIn(StrictModel):
    team_name: str = Field(min_length=2, max_length=60)
    logo: OwnMediaUrl | None = None
    cover_image: OwnMediaUrl | None = None
    description: LongText | None = None
    location: GeoPointIn
    area: ShortText = Field(description="Neighbourhood shown publicly, e.g. 'Koramangala'")
    city: ShortText
    category: MatchCategory = MatchCategory.FRIENDLY
    looking_for_opponents: bool = True
    preferred_formats: list[FixtureFormat] = Field(default_factory=list, max_length=6)
    cricheroes_team_url: CricHeroesTeamUrl | None = Field(
        default=None, description="Optional CricHeroes team profile link"
    )


class TeamUpdateIn(StrictModel):
    team_name: str | None = Field(default=None, min_length=2, max_length=60)
    logo: OwnMediaUrl | None = None
    cover_image: OwnMediaUrl | None = Field(default=None, description="Team cover photo (uploaded); null removes")
    description: LongText | None = None
    location: GeoPointIn | None = None
    area: ShortText | None = None
    city: ShortText | None = None
    category: MatchCategory | None = None
    looking_for_opponents: bool | None = None
    preferred_formats: list[FixtureFormat] | None = Field(default=None, max_length=6)
    cricheroes_team_url: CricHeroesTeamUrl | None = Field(default=None, description="Omit to keep, null to remove")


class AddMemberIn(StrictModel):
    user_id: ObjectIdStr | None = None
    mobile_number: MobileNumber | None = None
    member_role: TeamMemberRole = TeamMemberRole.MEMBER


class UpdateMemberIn(StrictModel):
    member_role: TeamMemberRole


class TeamMemberOut(BaseModel):
    user: PublicUserOut
    member_role: TeamMemberRole
    status: str
    primary_role: PlayingRole | None
    average_rating: float | None
    reliability_score: float | None
    joined_at: datetime | None


class UpcomingMatchBrief(BaseModel):
    id: str
    match_code: str
    title: str
    start_at: datetime
    end_at: datetime
    format: str
    category: str
    area: str | None
    vacancies: int
    required_roles: dict[str, int]
    per_head_fee_paise: int
    match_status: str


class TeamOut(BaseModel):
    id: str
    team_name: str
    logo: str | None
    cover_image: str | None = None
    description: str | None
    area: str | None
    city: str | None
    category: MatchCategory
    captain: PublicUserOut
    captain_rating: float | None
    member_count: int
    average_rating: float | None
    team_status: str
    my_membership: str | None = Field(description="captain | admin | member | invited | requested | None")
    looking_for_opponents: bool = True
    preferred_formats: list[FixtureFormat] = Field(default_factory=list)
    can_manage: bool
    cricheroes_team_url: str | None = None
    cricheroes_team_id: str | None = None
    upcoming_matches: list[UpcomingMatchBrief]
    created_at: datetime
