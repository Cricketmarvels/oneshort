"""Schemas for team challenges, fixtures, verified results, skill ratings and leaderboards."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.common.enums import ChallengeStatus, FixtureFormat, FixtureStatus, ResultStatus, ResultType
from app.common.types import AwareDatetime, GeoPointIn, ObjectIdStr, StrictModel
from app.common.validators import LongText, ShortText
from app.modules.competition.achievements import AchievementOut, AttendanceOut

# ---------------------------------------------------------------- shared briefs
from app.modules.players.schemas import CricHeroesStatsOut
from app.modules.users.schemas import PublicUserOut


class RatingBrief(BaseModel):
    rating: float
    rd: float
    confidence: float = Field(description="0..1, rises as verified match history grows")
    provisional: bool


class TeamCard(BaseModel):
    id: str
    team_name: str
    logo: str | None
    cover_image: str | None = None
    area: str | None
    city: str | None
    rating: RatingBrief | None = Field(description="None until the team has a verified result")
    matches: int


# ---------------------------------------------------------------- challenges


class VenueIn(StrictModel):
    name: ShortText
    area: ShortText | None = None
    city: ShortText | None = None
    location: GeoPointIn | None = Field(default=None, description="Ground location; never returned")


class VenueOut(BaseModel):
    name: str
    area: str | None
    city: str | None


class ProposalIn(StrictModel):
    start_at: AwareDatetime
    venue: VenueIn
    format: FixtureFormat
    overs: int | None = Field(default=None, ge=1, le=50, description="Required for CUSTOM; defaults from format")
    conditions: LongText | None = Field(default=None, description="Ball type, fee split, umpires, etc.")

    @model_validator(mode="after")
    def _overs(self) -> "ProposalIn":
        if self.format == FixtureFormat.CUSTOM and not self.overs:
            raise ValueError("overs is required for a custom format")
        return self


class ProposalOut(BaseModel):
    start_at: datetime
    venue: VenueOut
    format: FixtureFormat
    overs: int
    conditions: str | None


class ChallengeIn(StrictModel):
    from_team_id: ObjectIdStr
    to_team_id: ObjectIdStr
    proposal: ProposalIn
    message: ShortText | None = None
    send: bool = Field(default=True, description="false saves a draft")


class CounterProposalIn(StrictModel):
    proposal: ProposalIn
    message: ShortText | None = None


class ChallengeReasonIn(StrictModel):
    message: ShortText | None = None


class ProposalEntry(BaseModel):
    by_team_id: str
    by_user: PublicUserOut | None
    proposal: ProposalOut
    message: str | None
    at: datetime


ChallengeAction = Literal["send", "accept", "counter", "reject", "confirm", "cancel"]


class ChallengeOut(BaseModel):
    id: str
    status: ChallengeStatus
    from_team: TeamCard
    to_team: TeamCard
    proposal: ProposalOut
    history: list[ProposalEntry]
    awaiting_team_id: str | None = Field(description="Team whose captain must act next")
    my_side: Literal["from", "to"] | None
    actions: list[ChallengeAction] = Field(description="What the current user may do now")
    fixture_id: str | None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------- fixtures & results


class BattingIn(StrictModel):
    runs: int = Field(ge=0, le=400)
    balls: int = Field(ge=0, le=300)
    fours: int = Field(default=0, ge=0, le=100)
    sixes: int = Field(default=0, ge=0, le=100)
    out: bool = True

    @model_validator(mode="after")
    def _boundaries(self) -> "BattingIn":
        if 4 * self.fours + 6 * self.sixes > self.runs:
            raise ValueError("boundary runs exceed total runs")
        return self


class BowlingIn(StrictModel):
    balls: int = Field(ge=1, le=300)
    runs: int = Field(ge=0, le=400)
    wickets: int = Field(ge=0, le=10)
    maidens: int = Field(default=0, ge=0, le=50)


class FieldingIn(StrictModel):
    catches: int = Field(default=0, ge=0, le=10)
    run_outs: int = Field(default=0, ge=0, le=10)
    stumpings: int = Field(default=0, ge=0, le=10)


class PlayerLineIn(StrictModel):
    user_id: ObjectIdStr
    team_id: ObjectIdStr
    batting: BattingIn | None = Field(default=None, description="Omit if the player did not bat")
    bowling: BowlingIn | None = Field(default=None, description="Omit if the player did not bowl")
    fielding: FieldingIn = Field(default_factory=FieldingIn)


class InningsIn(StrictModel):
    batting_team_id: ObjectIdStr
    runs: int = Field(ge=0, le=1000)
    wickets: int = Field(ge=0, le=10)
    balls: int = Field(ge=0, le=300)


class ResultIn(StrictModel):
    result_type: ResultType
    winner_team_id: ObjectIdStr | None = None
    innings: list[InningsIn] = Field(min_length=0, max_length=2)
    players: list[PlayerLineIn] = Field(default_factory=list, max_length=40)
    notes: ShortText | None = None

    @model_validator(mode="after")
    def _winner(self) -> "ResultIn":
        if (self.result_type == ResultType.WON) != bool(self.winner_team_id):
            raise ValueError("winner_team_id is required for a win and only for a win")
        return self


class DisputeIn(StrictModel):
    reason: str = Field(min_length=5, max_length=500)


class ResolveIn(StrictModel):
    action: Literal["confirm", "void"]
    reason: ShortText


class PlayerLineOut(BaseModel):
    user: PublicUserOut
    team_id: str
    batting: BattingIn | None
    bowling: BowlingIn | None
    fielding: FieldingIn


class InningsOut(BaseModel):
    batting_team_id: str
    runs: int
    wickets: int
    balls: int


class ResultOut(BaseModel):
    status: ResultStatus
    result_type: ResultType
    winner_team_id: str | None
    summary: str
    innings: list[InningsOut]
    players: list[PlayerLineOut]
    notes: str | None
    submitted_by: PublicUserOut | None
    submitted_team_id: str
    submitted_at: datetime
    verified_by: PublicUserOut | None
    verified_at: datetime | None
    dispute_reason: str | None
    ratings_applied: bool


FixtureAction = Literal["submit_result", "verify", "dispute", "cancel"]


class FixtureOut(BaseModel):
    id: str
    code: str
    home_team: TeamCard
    away_team: TeamCard
    start_at: datetime
    venue: VenueOut
    format: FixtureFormat
    overs: int
    conditions: str | None
    status: FixtureStatus
    challenge_id: str | None
    result: ResultOut | None
    my_team_id: str | None
    actions: list[FixtureAction]
    is_demo: bool


# ---------------------------------------------------------------- skill ratings


class DisciplineOut(BaseModel):
    rating: float
    rd: float
    confidence: float
    matches: int


class PlayerRatingOut(BaseModel):
    user: PublicUserOut
    bio: str | None = None
    cricheroes_stats: CricHeroesStatsOut | None = None
    locality: str | None
    primary_role: str | None
    batting_style: str | None
    bowling_style: str | None
    overall: RatingBrief
    batting: DisciplineOut
    bowling: DisciplineOut
    fielding: DisciplineOut
    impact: DisciplineOut
    all_rounder_rating: float | None
    consistency: float | None
    verified_matches: int
    formats: dict[str, RatingBrief] = Field(description="Per-format overall rating (formats with data)")
    trend: list[float] = Field(description="Overall rating after each of the last verified matches, oldest first")
    recent_form: list[float] = Field(description="Match impact scores 0..1, oldest first")
    local_rank: int | None = Field(description="Overall rank in the player's city")
    local_rank_city: str | None
    summary: list[str] = Field(description="Explanations derived from the stored rating history")
    career: dict[str, float]
    teams: list[TeamCard]
    methodology: str
    includes_demo_data: bool
    achievements: list[AchievementOut] = Field(default_factory=list, description="From verified data only")
    cricheroes_profile_url: str | None = Field(
        default=None, description="Player-supplied CricHeroes link (not verified by OneShort)"
    )
    cricheroes_player_id: str | None = None
    attendance: AttendanceOut | None = Field(default=None, description="Pickup-game attendance (rate needs 3+ marked)")


class RatingHistoryOut(BaseModel):
    fixture_id: str
    at: datetime
    format: str
    opponent: TeamCard | None
    result: str
    before: dict[str, float]
    after: dict[str, float]
    performance: dict[str, float | None]
    reasons: list[str]
    is_demo: bool


# ---------------------------------------------------------------- leaderboards

LeaderboardScope = Literal["5km", "10km", "20km", "50km", "city", "state", "national"]
PlayerCategory = Literal["overall", "batting", "bowling", "all_rounder", "fielding", "consistency", "rising"]


class PlayerLeaderboardEntry(BaseModel):
    rank: int
    movement: int | None = Field(description="Places gained (+) or lost (−) since each player's last match")
    user: PublicUserOut
    locality: str | None
    distance_km: float | None = Field(description="Approximate (0.5 km), only for radius scopes")
    primary_role: str | None
    rating: float = Field(description="The value this category ranks by (rating, or a 0-100 score)")
    rating_label: str
    rd: float | None
    confidence: float
    provisional: bool
    matches: int
    trend: list[float]


class LeaderboardMeta(BaseModel):
    scope: LeaderboardScope
    scope_label: str
    category: str
    format: str | None
    total: int
    page: int
    page_size: int
    has_next: bool
    insufficient_data: bool = Field(description="True when too few verified players exist for this view")
    includes_demo_data: bool
    method: str


class PlayerLeaderboardOut(BaseModel):
    data: list[PlayerLeaderboardEntry]
    me: PlayerLeaderboardEntry | None
    meta: LeaderboardMeta


class TeamLeaderboardEntry(BaseModel):
    rank: int
    movement: int | None
    team: TeamCard
    distance_km: float | None
    rating: float
    rd: float
    confidence: float
    provisional: bool
    matches: int
    won: int
    lost: int
    tied: int
    win_pct: float | None
    form: list[str]


class TeamLeaderboardOut(BaseModel):
    data: list[TeamLeaderboardEntry]
    meta: LeaderboardMeta


class HeadToHeadOut(BaseModel):
    team_a: TeamCard
    team_b: TeamCard
    played: int
    a_wins: int
    b_wins: int
    tied: int
    no_result: int
    last: list[FixtureOut]


class CompareOut(BaseModel):
    a: PlayerRatingOut
    b: PlayerRatingOut


class TeamCompareOut(BaseModel):
    a: TeamLeaderboardEntry | None
    b: TeamLeaderboardEntry | None
    head_to_head: HeadToHeadOut


class TeamDiscoverEntry(BaseModel):
    team: TeamCard
    distance_km: float
    captain: PublicUserOut
    member_count: int
    rating_gap: float | None = Field(description="Their rating minus yours (when both are rated)")
    open_challenge_id: str | None
    open_spots: int = Field(default=0, description="Open places in this team's upcoming pickup matches")
    next_open_match_id: str | None = None
    next_open_match_at: datetime | None = None
    next_open_match_format: str | None = None
    open_roles: dict[str, int] = Field(
        default_factory=dict, description="Unfilled required roles in the next open match, e.g. {bowler: 1}"
    )
    my_membership: str | None = Field(default=None, description="member | invited | requested | None")


class NearbyPlayerOut(BaseModel):
    user: PublicUserOut
    locality: str | None
    distance_km: float = Field(description="Approximate (0.5 km)")
    primary_role: str | None
    secondary_roles: list[str]
    batting_style: str | None
    bowling_style: str | None
    rating: RatingBrief | None = Field(description="None until the player has a verified match")
    verified_matches: int
    available_this_week: bool
    teams: list[str]
    has_cricheroes: bool = Field(
        default=False, description="Player linked a CricHeroes profile (open their OneShort profile to view it)"
    )


class RosterEntry(BaseModel):
    user: PublicUserOut
    member_role: str
    member_status: str
    primary_role: str | None
    rating: RatingBrief | None
    available_next_7_days: bool | None


class ContributionOut(BaseModel):
    user: PublicUserOut
    matches: int
    runs: int
    wickets: int
    catches: int
    impact: float | None


class TeamDashboardOut(BaseModel):
    team: TeamCard
    description: str | None
    cricheroes_team_url: str | None = Field(default=None, description="Captain-supplied CricHeroes team link")
    cricheroes_team_id: str | None = None
    captain: PublicUserOut
    can_manage: bool
    is_captain: bool
    my_membership: str | None
    looking_for_opponents: bool
    rank_city: int | None
    record: TeamLeaderboardEntry | None
    streak: str | None
    rating_history: list[float]
    roster: list[RosterEntry]
    join_requests: list[RosterEntry]
    upcoming: list[FixtureOut]
    recent: list[FixtureOut]
    awaiting_action: list[FixtureOut]
    challenges: list[ChallengeOut]
    contributions: list[ContributionOut]
    head_to_head: list[HeadToHeadOut]
    includes_demo_data: bool
