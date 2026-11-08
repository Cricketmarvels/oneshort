from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.common.enums import CommunityKind, CommunityPostType, CommunityRole
from app.common.types import GeoPointIn, ObjectIdStr, StrictModel
from app.common.validators import LongText, ShortText
from app.modules.competition.schemas import PlayerLeaderboardEntry, TeamCard
from app.modules.users.schemas import PublicUserOut

PLATFORM_DISCLAIMER = (
    "PlayR helps cricketers find each other. Matches and meet-ups are organised by members, not by PlayR. "
    "PlayR does not supervise matches and is not responsible for members' conduct, injuries, payments or "
    "offline disputes. Play safely, respect the ground and each other, and report anything inappropriate."
)


class CommunityIn(StrictModel):
    name: str = Field(min_length=3, max_length=60)
    description: LongText | None = None
    kind: CommunityKind
    visibility: Literal["public", "private"] = "public"
    area: ShortText | None = None
    city: ShortText
    location: GeoPointIn | None = Field(default=None, description="Used for discovery only; never returned")
    guidelines: LongText | None = None


class CommunityUpdateIn(StrictModel):
    description: LongText | None = None
    visibility: Literal["public", "private"] | None = None
    guidelines: LongText | None = None


class JoinIn(StrictModel):
    accept_guidelines: bool = Field(description="Must be true: the member accepts the community guidelines")
    message: ShortText | None = None


class MemberRoleIn(StrictModel):
    role: Literal["admin", "moderator", "member"]


class CommunityOut(BaseModel):
    id: str
    name: str
    slug: str
    description: str | None
    kind: CommunityKind
    visibility: Literal["public", "private"]
    area: str | None
    city: str
    distance_km: float | None
    guidelines: str | None
    disclaimer: str
    member_count: int
    team_count: int
    created_by: PublicUserOut | None
    my_role: CommunityRole | None
    my_status: Literal["active", "pending", "banned"] | None
    can_moderate: bool
    can_admin: bool
    created_at: datetime


class CommunityMemberOut(BaseModel):
    user: PublicUserOut
    role: CommunityRole
    status: str
    joined_at: datetime | None


class CommunityTeamOut(BaseModel):
    team: TeamCard
    status: str


class PollOptionIn(StrictModel):
    text: str = Field(min_length=1, max_length=80)


class PostIn(StrictModel):
    type: CommunityPostType = CommunityPostType.POST
    body: str = Field(min_length=1, max_length=2000)
    poll_options: list[PollOptionIn] = Field(default_factory=list, max_length=6)
    event_at: datetime | None = Field(default=None, description="For match / tournament posts")

    @model_validator(mode="after")
    def _poll(self) -> "PostIn":
        if self.type == CommunityPostType.POLL and len(self.poll_options) < 2:
            raise ValueError("a poll needs at least two options")
        if self.type != CommunityPostType.POLL and self.poll_options:
            raise ValueError("only polls have options")
        return self


class VoteIn(StrictModel):
    option: int = Field(ge=0, le=5)


class ReportPostIn(StrictModel):
    reason: str = Field(min_length=3, max_length=300)


class PollOptionOut(BaseModel):
    text: str
    votes: int


class PostOut(BaseModel):
    id: str
    community_id: str
    type: CommunityPostType
    author: PublicUserOut
    author_role: CommunityRole | None
    body: str
    poll: list[PollOptionOut] | None
    my_vote: int | None
    event_at: datetime | None
    report_count: int | None = Field(description="Only shown to moderators")
    can_remove: bool
    created_at: datetime
    community_name: str | None = Field(default=None, description="Set in the combined feed")
    community_area: str | None = None
    community_joined: bool | None = None
    approx_distance_km: float | None = Field(
        default=None, description="Community distance, rounded; never a member's location"
    )


class FeedOut(BaseModel):
    data: list[PostOut]
    has_next: bool


class CommunityLeaderboardOut(BaseModel):
    players: list[PlayerLeaderboardEntry]
    teams: list[TeamCard]


class TeamLinkIn(StrictModel):
    team_id: ObjectIdStr


class BlockedUserOut(BaseModel):
    user: PublicUserOut
    blocked_at: datetime
