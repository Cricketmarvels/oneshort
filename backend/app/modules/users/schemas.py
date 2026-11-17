from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import AfterValidator, BaseModel, EmailStr, Field

from app.common.enums import NotificationType, PlayingRole
from app.common.media import OwnMediaUrl
from app.common.types import StrictModel
from app.common.validators import DateOfBirth, Name, Password, ShortText, Timezone, UpiId


class NotificationPrefs(BaseModel):
    in_app: bool = True
    push: bool = True
    email: bool = False
    whatsapp: bool | None = Field(
        default=None,
        description=(
            "WhatsApp updates (invites, match changes, fee reminders). null = not chosen: updates are ON by default. "
            "false = switched off. Only an explicit true also lets accepted teammates open a WhatsApp chat with you."
        ),
    )
    muted_types: list[NotificationType] = Field(default_factory=list, max_length=50)


class AgreementState(BaseModel):
    accepted_version: int | None
    required_version: int | None
    satisfied: bool


class UserOut(BaseModel):
    """The authenticated user's own view (includes contact details)."""

    id: str
    full_name: str
    mobile_number: str | None
    email: str | None
    mobile_verified: bool = Field(description="Deprecated alias of phone_verified")
    phone_verified: bool = Field(default=False, description="Mobile number proven with an SMS/WhatsApp OTP")
    phone_verified_at: datetime | None = None
    email_verified: bool = Field(default=False, description="Always false for now: email verification is deferred")
    email_verified_at: datetime | None = None
    registration_completed_at: datetime | None = Field(
        default=None, description="Set by the server once sign-up is finished; null means show registration"
    )
    profile_image: str | None
    roles: list[str]
    city: str | None
    timezone: str
    account_status: str
    has_password: bool
    has_player_profile: bool
    has_captain_profile: bool
    agreement: AgreementState
    notification_prefs: NotificationPrefs
    preferred_sport: Literal["cricket", "badminton", "pickleball"] = "cricket"
    date_of_birth: date | None = Field(default=None, description="Never shown to other users")
    playing_roles: list[str] = Field(default_factory=list, description="Cricket roles the player can fill, in order")
    auth_providers: list[str] = Field(default_factory=list, description="How this account signs in: password, google")
    onboarding_completed: bool = Field(default=False, description="True once registration is finished")
    fee_upi_id: str | None = Field(default=None, description="UPI ID last used to collect match fees (prefills splits)")
    created_at: datetime


class PublicUserOut(BaseModel):
    """What other users may see. No contact details, no location."""

    id: str
    full_name: str
    profile_image: str | None
    city: str | None


class UpdateMeIn(StrictModel):
    full_name: Name | None = None
    email: EmailStr | None = None
    profile_image: OwnMediaUrl | None = None
    city: ShortText | None = None
    timezone: Timezone | None = None
    notification_prefs: NotificationPrefs | None = None
    preferred_sport: Literal["cricket", "badminton", "pickleball"] | None = None
    fee_upi_id: UpiId | None = Field(default=None, description="Where players pay my match fees")


def _unique_roles(v: list[PlayingRole]) -> list[PlayingRole]:
    if len(set(v)) != len(v):
        raise ValueError("each playing role at most once")
    return v


PlayingRoles = Annotated[list[PlayingRole], Field(min_length=1, max_length=4), AfterValidator(_unique_roles)]


class ProfilePatchIn(StrictModel):
    """Partial update of the player profile fields that live on the account."""

    player_name: Name | None = None
    date_of_birth: DateOfBirth | None = None
    playing_roles: PlayingRoles | None = None


class CompleteRegistrationIn(StrictModel):
    """Last step of sign-up, after the mobile number is verified. Verification flags are never accepted
    from the client (StrictModel rejects unknown fields)."""

    full_name: Name
    email: EmailStr = Field(description="Collected now, verified in a later release (email_verified stays false)")
    play_as: Literal["player", "captain"]
    sport: Literal["cricket", "badminton", "pickleball"] | None = Field(
        default=None, description="Sport chosen before sign-in; the beta sport wins when one is set"
    )
    primary_role: Literal["batsman", "bowler", "all_rounder", "wicketkeeper"] | None = Field(
        default=None, description="Cricket only: creates the player profile so nearby captains can find you"
    )
    profile_image: OwnMediaUrl | None = None
    date_of_birth: DateOfBirth | None = Field(default=None, description="Asked at sign-up; 18+ only")
    playing_roles: PlayingRoles | None = Field(
        default=None, description="Cricket roles the player can fill (several allowed); replaces primary_role"
    )
    password: Password | None = Field(default=None, description="Test mode only: lets a tester log back in by email")


class DeviceIn(StrictModel):
    platform: Literal["ios", "android", "web"]
    push_token: str = Field(min_length=10, max_length=4096)


class DeleteAccountIn(StrictModel):
    confirm: Literal["DELETE"]
    reason: ShortText | None = None


def public_user(doc: dict[str, Any]) -> PublicUserOut:
    return PublicUserOut(
        id=str(doc["_id"]),
        full_name=doc.get("full_name", "Player"),
        profile_image=doc.get("profile_image"),
        city=doc.get("city"),
    )
