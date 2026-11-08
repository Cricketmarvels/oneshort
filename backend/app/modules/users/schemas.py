from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, EmailStr, Field

from app.common.enums import NotificationType
from app.common.types import StrictModel
from app.common.validators import Name, ShortText, Timezone, Url


class NotificationPrefs(BaseModel):
    in_app: bool = True
    push: bool = True
    email: bool = False
    whatsapp: bool = Field(
        default=False,
        description="Opt-in: match invitations on WhatsApp; lets accepted teammates open a WhatsApp chat",
    )
    muted_types: list[NotificationType] = Field(default_factory=list)


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
    mobile_verified: bool
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
    profile_image: Url | None = None
    city: ShortText | None = None
    timezone: Timezone | None = None
    notification_prefs: NotificationPrefs | None = None
    preferred_sport: Literal["cricket", "badminton", "pickleball"] | None = None


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
