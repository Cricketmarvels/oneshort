from datetime import datetime

from pydantic import BaseModel, Field

from app.common.enums import FixtureFormat, MatchCategory, PlayingRole, TeamMemberRole
from app.common.types import GeoPointIn, ObjectIdStr, StrictModel
from app.common.validators import LongText, MobileNumber, ShortText, Url
from app.modules.users.schemas import PublicUserOut


class TeamIn(StrictModel):
    team_name: str = Field(min_length=2, max_length=60)
    logo: Url | None = None
    description: LongText | None = None
    location: GeoPointIn
    area: ShortText = Field(description="Neighbourhood shown publicly, e.g. 'Koramangala'")
    city: ShortText
    category: MatchCategory = MatchCategory.FRIENDLY
    looking_for_opponents: bool = True
    preferred_formats: list[FixtureFormat] = Field(default_factory=list, max_length=6)


class TeamUpdateIn(StrictModel):
    team_name: str | None = Field(default=None, min_length=2, max_length=60)
    logo: Url | None = None
    description: LongText | None = None
    location: GeoPointIn | None = None
    area: ShortText | None = None
    city: ShortText | None = None
    category: MatchCategory | None = None
    looking_for_opponents: bool | None = None
    preferred_formats: list[FixtureFormat] | None = Field(default=None, max_length=6)


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
    upcoming_matches: list[UpcomingMatchBrief]
    created_at: datetime
