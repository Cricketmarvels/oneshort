from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator

from app.common.enums import ContributionType, InvitationDirection, InvitationStatus, PlayingRole
from app.common.types import ObjectIdStr, StrictModel
from app.common.validators import ShortText
from app.modules.users.schemas import PublicUserOut


class InviteItem(StrictModel):
    player_id: ObjectIdStr
    contribution_type: ContributionType | None = Field(
        default=None, description="Defaults to the match's default contribution type"
    )
    proposed_role: PlayingRole | None = None


class CreateInvitationsIn(StrictModel):
    invites: list[InviteItem] = Field(min_length=1, max_length=22)
    message: ShortText | None = None


Commitment = Literal["confirmed", "tentative"]


class CommitmentIn(StrictModel):
    """How sure the player is. Tentative needs a note saying by when they can confirm."""

    commitment: Commitment = "confirmed"
    commitment_note: ShortText | None = Field(default=None, description="Required when tentative")

    @model_validator(mode="after")
    def _note_for_tentative(self) -> "CommitmentIn":
        if self.commitment == "tentative" and not (self.commitment_note or "").strip():
            raise ValueError("Say by when you can confirm")
        if self.commitment == "confirmed":
            self.commitment_note = None
        return self


class JoinRequestIn(CommitmentIn):
    proposed_role: PlayingRole | None = None
    message: ShortText | None = None


class RespondIn(StrictModel):
    reason: ShortText | None = None


class InvitationResultItem(BaseModel):
    player_id: str
    ok: bool
    invitation_id: str | None = None
    error_code: str | None = None
    message: str | None = None
    whatsapp_status: str | None = Field(
        default=None, description="sent | failed | not_configured | opted_out | no_number"
    )


class MatchBriefOut(BaseModel):
    id: str
    match_code: str
    title: str
    team_name: str
    team_logo: str | None
    start_at: datetime
    end_at: datetime
    timezone: str
    format: str
    category: str
    area: str | None
    city: str | None
    match_status: str
    per_head_fee_paise: int
    venue_name: str | None = None


class InvitationOut(BaseModel):
    id: str
    direction: InvitationDirection
    invitation_status: InvitationStatus
    contribution_type: ContributionType
    proposed_role: PlayingRole | None
    message: str | None
    is_substitute: bool
    player: PublicUserOut
    captain: PublicUserOut
    match: MatchBriefOut
    availability_state: str | None = Field(
        default=None, description="Player's declared availability for the match window (captain view)"
    )
    invited_at: datetime
    responded_at: datetime | None
    confirmed_at: datetime | None
    expires_at: datetime
    can_accept: bool
    can_reject: bool
    can_cancel: bool
    can_confirm: bool
    whatsapp_status: str | None = Field(
        default=None, description="WhatsApp delivery for this invitation (captain view only)"
    )
    commitment: Commitment = Field(default="confirmed", description="confirmed, or tentative with a note")
    commitment_note: str | None = None
    can_chat: bool = Field(default=False, description="Captain and player can chat once the invitation is accepted")
