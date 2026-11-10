from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field

from app.common.types import StrictModel
from app.common.validators import MobileNumber, Name, Otp, Password, ShortText, Timezone
from app.modules.users.schemas import UserOut

OtpPurpose = Literal["register", "login", "reset_password"]
OtpChannel = Literal["sms", "whatsapp"]


class RegisterIn(StrictModel):
    full_name: Name
    mobile_number: MobileNumber
    email: EmailStr
    city: ShortText | None = None
    timezone: Timezone = "Asia/Kolkata"
    password: Password | None = Field(default=None, description="Optional; enables email login")
    otp_channel: OtpChannel = Field(default="sms", description="Where to send the verification code")


class SendOtpIn(StrictModel):
    mobile_number: MobileNumber
    purpose: OtpPurpose = "login"
    channel: OtpChannel = Field(default="sms", description="sms or whatsapp")


class AuthOptionsOut(BaseModel):
    sms_otp: bool = Field(description="A real SMS provider is configured (or the dev adapter is active)")
    whatsapp_otp: bool = Field(description="WhatsApp codes can be delivered (provider configured)")
    whatsapp_simulator: bool = Field(
        default=False, description="Test mode: WhatsApp messages go to the in-app simulator"
    )
    beta_sport: str | None = Field(default=None, description="Set during a single-sport beta: the only sport offered")
    tester_signup_prefix: str | None = Field(
        default=None, description="Test mode: sign up with a number starting with this; the code shows on screen"
    )


class OtpSentOut(BaseModel):
    sent: bool
    expires_in: int
    resend_after: int
    dev_otp: str | None = Field(
        default=None, description="Only present with the development OTP adapter (never in production)"
    )


class SignupProfileIn(StrictModel):
    """Sign-up details, sent WITH the code by the person holding the phone. Only used when the number has
    no verified account yet; an existing account is opened as-is."""

    full_name: Name
    email: EmailStr | None = None
    city: ShortText | None = None
    timezone: Timezone = "Asia/Kolkata"
    password: Password | None = None


class VerifyOtpIn(StrictModel):
    mobile_number: MobileNumber
    code: Otp
    purpose: Literal["register", "login"] = "login"
    profile: SignupProfileIn | None = Field(default=None, description="Sign-up details for a new account")


class PasswordLoginIn(StrictModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshIn(StrictModel):
    refresh_token: str = Field(min_length=20, max_length=200)


class ResetPasswordIn(StrictModel):
    mobile_number: MobileNumber
    code: Otp
    new_password: Password


class TokenOut(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - token scheme name, not a secret
    expires_in: int
    user: UserOut
    is_new_user: bool = Field(default=False, description="True when this sign-in created the account: show onboarding")


class SessionOut(BaseModel):
    id: str = Field(description="Device session (refresh-token family) id")
    user_agent: str
    started_at: datetime
    last_used_at: datetime
    current: bool = Field(description="True for the session making this request")


class RegisterOut(BaseModel):
    user_id: str | None = Field(
        default=None, description="Deprecated, always null: the account is created when the code is verified"
    )
    otp: OtpSentOut
