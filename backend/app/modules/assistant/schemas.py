from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.common.types import StrictModel

IntentKind = Literal["play_match", "find_players", "find_team", "find_opponent", "find_community"]
TimeOfDay = Literal["morning", "afternoon", "evening", "night"]
Weekday = Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


class SearchIn(StrictModel):
    query: str = Field(min_length=2, max_length=300)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lng: float | None = Field(default=None, ge=-180, le=180)
    radius_km: int = Field(default=10, ge=1, le=100)


class Intent(BaseModel):
    """What the user is asking for, in structured form."""

    kind: IntentKind = Field(
        description=(
            "play_match: wants a game to play in; find_players: needs players; find_team: wants a team to join; "
            "find_opponent: a captain wants a team to play against; find_community: wants a group"
        )
    )
    weekdays: list[Weekday] = Field(
        default_factory=list, description="Days mentioned, e.g. ['sat'] for Saturday, ['sat','sun'] for the weekend"
    )
    dates: list[str] = Field(
        default_factory=list,
        description="Specific dates as YYYY-MM-DD ('today', 'tomorrow', 'this Sunday' resolved from the current date)",
    )
    times_of_day: list[TimeOfDay] = Field(default_factory=list)
    role: Literal["batsman", "bowler", "all_rounder", "wicketkeeper"] | None = None
    format: Literal["T10", "T15", "T20", "30_OVER", "40_OVER"] | None = None
    max_distance_km: int | None = Field(default=None, ge=1, le=100)
    summary: str = Field(description="Short restatement of the request, e.g. 'A game to play on Saturday morning'")


class SearchResultOut(BaseModel):
    kind: Literal["match", "fixture", "player", "team", "community"]
    id: str
    title: str
    subtitle: str
    when: datetime | None
    distance_km: float | None
    reason: str = Field(description="Why this is a good fit, based only on its listed facts")
    cta: str
    image_name: str | None = Field(description="Name used for the illustrated avatar or crest")


class SearchOut(BaseModel):
    query: str
    intent: Intent
    window_label: str | None = Field(description="Human label of the time window searched, e.g. 'Sat 8 Nov, morning'")
    results: list[SearchResultOut]
    engine: Literal["claude", "rules"] = Field(
        description="claude when a language model interpreted and ranked; rules otherwise"
    )
    note: str | None
