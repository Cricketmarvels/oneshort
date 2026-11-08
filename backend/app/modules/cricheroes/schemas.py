"""Schemas for CricHeroes team data.

The import shape (``CricHeroesSnapshotIn``) uses the same field names as the community
``cricheroes`` package's JSON output (team_name, team_logo, players, matches, stats,
leaderboard), so existing files can be imported unchanged. Unknown fields are ignored and
every list and string is size-capped.
"""

from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, StringConstraints

from app.common.types import StrictModel
from app.modules.users.schemas import PublicUserOut


def _to_str(v: Any) -> Any:
    return str(v) if isinstance(v, int | float) and not isinstance(v, bool) else v


Txt = Annotated[str, BeforeValidator(_to_str), StringConstraints(max_length=200, strip_whitespace=True)]
Name = Annotated[str, StringConstraints(min_length=1, max_length=80, strip_whitespace=True)]
UrlText = Annotated[str, StringConstraints(max_length=500, strip_whitespace=True)]


class _Lenient(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


class CricHeroesPlayerIn(_Lenient):
    name: Name
    sub_title: Txt | None = Field(default=None, description="Role line, e.g. 'Batsman · Right-hand bat'")
    profile_url: UrlText | None = None


class CricHeroesMatchIn(_Lenient):
    tournament: Txt | None = None
    info: Txt | None = Field(default=None, description="Venue, date and overs as shown on CricHeroes")
    score: list[Txt] = Field(default_factory=list, max_length=4)
    result: Txt | None = None
    url: UrlText | None = None
    date: Annotated[str, BeforeValidator(_to_str), StringConstraints(max_length=40)] | None = None
    venue: Txt | None = None


class CricHeroesStatIn(_Lenient):
    label: Annotated[str, StringConstraints(min_length=1, max_length=60, strip_whitespace=True)]
    value: Annotated[str, BeforeValidator(_to_str), StringConstraints(max_length=40, strip_whitespace=True)]


class CricHeroesLeaderIn(_Lenient):
    player_name: Name
    stat: Txt


class CricHeroesLeaderboardIn(_Lenient):
    batting: list[CricHeroesLeaderIn] = Field(default_factory=list, max_length=100)
    bowling: list[CricHeroesLeaderIn] = Field(default_factory=list, max_length=100)
    fielding: list[CricHeroesLeaderIn] = Field(default_factory=list, max_length=100)


class CricHeroesSnapshotIn(_Lenient):
    team_name: Txt | None = None
    team_logo: UrlText | None = None
    players: list[CricHeroesPlayerIn] = Field(default_factory=list, max_length=200)
    matches: list[CricHeroesMatchIn] = Field(default_factory=list, max_length=300)
    stats: list[CricHeroesStatIn] = Field(default_factory=list, max_length=50)
    leaderboard: CricHeroesLeaderboardIn = Field(default_factory=CricHeroesLeaderboardIn)


class CricHeroesLinkIn(StrictModel):
    url: str = Field(min_length=3, max_length=300, description="CricHeroes team link or '<id>/<slug>'")


class CricHeroesImportIn(StrictModel):
    method: Literal["file", "manual"] = "file"
    data: CricHeroesSnapshotIn


# ---- responses -------------------------------------------------------------


class CricHeroesLinkOut(BaseModel):
    external_team_id: int
    url: str
    linked_at: datetime


class CricHeroesPlayerOut(BaseModel):
    name: str
    role: str | None
    profile_url: str | None
    member_user_id: str | None = Field(description="Team member on this platform whose name matches, if any")


class CricHeroesMatchOut(BaseModel):
    tournament: str | None
    info: str | None
    score: list[str]
    result: str | None
    url: str | None
    played_on: date | None
    venue: str | None


class CricHeroesStatOut(BaseModel):
    label: str
    value: str


class CricHeroesLeaderOut(BaseModel):
    player_name: str
    stat: str


class CricHeroesLeaderboardOut(BaseModel):
    batting: list[CricHeroesLeaderOut]
    bowling: list[CricHeroesLeaderOut]
    fielding: list[CricHeroesLeaderOut]


class CricHeroesSnapshotOut(BaseModel):
    team_name: str | None
    team_logo: str | None
    players: list[CricHeroesPlayerOut]
    matches: list[CricHeroesMatchOut]
    stats: list[CricHeroesStatOut]
    leaderboard: CricHeroesLeaderboardOut
    method: Literal["file", "manual", "sync"]
    imported_at: datetime
    imported_by: PublicUserOut | None


class CricHeroesProfileOut(BaseModel):
    team_id: str
    link: CricHeroesLinkOut | None
    snapshot: CricHeroesSnapshotOut | None
    can_manage: bool
    auto_sync_available: bool
    auto_sync_note: str | None
