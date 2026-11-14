from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.common.enums import PlayingRole
from app.common.types import StrictModel
from app.common.validators import MobileNumber, Name, Password, ShortText


class InviteLinkOut(BaseModel):
    code: str
    path: str = Field(description="App path to open, e.g. /join/AbC123xYz9")
    url: str | None = Field(description="Full link when the server knows the app's public address")
    message: str = Field(description="Ready-to-share WhatsApp group message (without the link if url is unknown)")
    expires_at: datetime
    uses: int
    max_uses: int
    active: bool
    joined: list[str] = Field(description="Names of players who joined via this link")


class JoinPreviewOut(BaseModel):
    team_name: str
    captain_name: str
    match_title: str
    start_at: datetime
    end_at: datetime
    timezone: str
    area: str | None
    city: str | None
    format: str
    capacity: int
    confirmed: int
    spots_left: int
    status: Literal["open", "full", "expired", "closed"]
    match_id: str
    viewer: Literal["guest", "captain", "in_squad", "not_in"] = Field(
        default="guest",
        description="How the link relates to the signed-in caller: anonymous, this match's captain, already in the "
        "squad, or not in it yet",
    )


class JoinIn(StrictModel):
    proposed_role: PlayingRole | None = None


class JoinResultOut(BaseModel):
    status: Literal["joined", "already_in"]
    match_id: str
    team_id: str
    team_name: str
    match_title: str


class InviteRegisterIn(StrictModel):
    code: str = Field(min_length=6, max_length=32)
    full_name: Name
    mobile_number: MobileNumber
    email: EmailStr
    password: Password
    city: ShortText | None = None
