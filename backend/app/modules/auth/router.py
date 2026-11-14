from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.modules.auth.accounts import google_link, google_sign_in, register_with_email
from app.modules.auth.email_codes import (
    finish_email_reset,
    finish_email_signup,
    finish_email_verify,
    start_email_reset,
    start_email_signup,
    start_email_verify,
)
from app.modules.auth.schemas import (
    AuthOptionsOut,
    EmailRegisterIn,
    EmailResetStartIn,
    EmailResetVerifyIn,
    EmailSignupStartIn,
    EmailSignupVerifyIn,
    EmailVerifyIn,
    GoogleSignInIn,
    OtpSentOut,
    PasswordLoginIn,
    RefreshIn,
    RegisterIn,
    RegisterOut,
    ResetPasswordIn,
    SendOtpIn,
    SessionOut,
    TokenOut,
    VerifyOtpIn,
)
from app.modules.auth.service import AuthService
from app.modules.users.schemas import UserOut
from app.modules.users.service import UserService

router = APIRouter(prefix="/auth", tags=["Authentication"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> AuthService:
    return AuthService(c)


Svc = Annotated[AuthService, Depends(service)]


def _ua(request: Request) -> str | None:
    return request.headers.get("user-agent")


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


@router.post(
    "/register",
    status_code=201,
    response_model=Envelope[RegisterOut],
    summary="Register with mobile number; sends an OTP to verify it",
)
async def register(data: RegisterIn, request: Request, svc: Svc) -> Envelope[RegisterOut]:
    return ok(await svc.register(data, _ip(request)))


@router.post("/email-signup/start", response_model=Envelope[OtpSentOut], summary="Create account: email a 6-digit code")
async def email_signup_start(data: EmailSignupStartIn, request: Request, c: ContainerDep) -> Envelope[OtpSentOut]:
    return ok(await start_email_signup(c, str(data.email), data.mobile_number, _ip(request)))


@router.post(
    "/email-signup/verify",
    status_code=201,
    response_model=Envelope[TokenOut],
    summary="Create account: verify the email code (mobile stays unverified)",
)
async def email_signup_verify(data: EmailSignupVerifyIn, request: Request, c: ContainerDep) -> Envelope[TokenOut]:
    return ok(
        await finish_email_signup(
            c,
            full_name=data.full_name,
            email=str(data.email),
            mobile=data.mobile_number,
            password=data.password,
            city=data.city,
            code=data.code,
            user_agent=_ua(request),
        )
    )


@router.post("/email-reset/start", response_model=Envelope[OtpSentOut], summary="Email a password-reset code")
async def email_reset_start(data: EmailResetStartIn, request: Request, c: ContainerDep) -> Envelope[OtpSentOut]:
    return ok(await start_email_reset(c, str(data.email), _ip(request)))


@router.post("/email-reset/verify", status_code=204, summary="Reset password with an email code")
async def email_reset_verify(data: EmailResetVerifyIn, c: ContainerDep) -> None:
    await finish_email_reset(c, str(data.email), data.code, data.new_password)


@router.get("/options", response_model=Envelope[AuthOptionsOut], summary="Which login channels are available")
async def options(c: ContainerDep) -> Envelope[AuthOptionsOut]:
    return ok(
        AuthOptionsOut(
            sms_otp=True,
            email_otp=c.email.configured,
            email_test_mode=c.email.configured and c.email.exposes_code,
            whatsapp_otp=c.whatsapp.configured,
            whatsapp_simulator=c.settings.whatsapp_provider == "simulator",
            tester_signup_prefix=c.settings.tester_signup_prefix
            if c.settings.app_env not in ("beta", "production")
            else None,
            beta_sport=c.settings.oneshort_beta_sport,
            google=c.google.configured,
        )
    )


@router.post("/send-otp", response_model=Envelope[OtpSentOut], summary="Send an OTP")
async def send_otp(data: SendOtpIn, request: Request, svc: Svc) -> Envelope[OtpSentOut]:
    return ok(await svc.send_otp(data.mobile_number, data.purpose, data.channel, _ip(request)))


@router.post(
    "/verify-otp",
    response_model=Envelope[TokenOut],
    summary="Verify OTP (completes registration or logs in) and issue tokens",
)
async def verify_otp(data: VerifyOtpIn, request: Request, svc: Svc) -> Envelope[TokenOut]:
    return ok(await svc.verify_otp(data.mobile_number, data.code, data.purpose, _ua(request), data.profile))


@router.post("/login", response_model=Envelope[TokenOut], summary="Email + password login")
async def login(data: PasswordLoginIn, request: Request, svc: Svc) -> Envelope[TokenOut]:
    return ok(await svc.password_login(str(data.email), data.password, _ua(request)))


@router.post(
    "/register/email",
    status_code=201,
    response_model=Envelope[TokenOut],
    summary="Create an account with email + password, date of birth and playing roles",
)
async def register_email(data: EmailRegisterIn, request: Request, c: ContainerDep) -> Envelope[TokenOut]:
    return ok(await register_with_email(c, data, _ua(request)))


@router.post("/google", response_model=Envelope[TokenOut], summary="Sign in or sign up with a Google ID token")
async def google(data: GoogleSignInIn, request: Request, c: ContainerDep) -> Envelope[TokenOut]:
    return ok(await google_sign_in(c, data.id_token, _ua(request)))


@router.post("/google/link", response_model=Envelope[UserOut], summary="Link a Google account to the signed-in user")
async def google_link_route(data: GoogleSignInIn, user: UserDep, c: ContainerDep) -> Envelope[UserOut]:
    return ok(await UserService(c).to_out(await google_link(c, user, data.id_token)))


@router.post("/email-verify/start", response_model=Envelope[OtpSentOut], summary="Email a code to verify my address")
async def email_verify_start(request: Request, user: UserDep, c: ContainerDep) -> Envelope[OtpSentOut]:
    return ok(await start_email_verify(c, user, _ip(request)))


@router.post("/email-verify", response_model=Envelope[UserOut], summary="Verify my email with the code")
async def email_verify(data: EmailVerifyIn, user: UserDep, c: ContainerDep) -> Envelope[UserOut]:
    return ok(await UserService(c).to_out(await finish_email_verify(c, user, data.code)))


@router.post("/refresh", response_model=Envelope[TokenOut], summary="Rotate refresh token")
async def refresh(data: RefreshIn, request: Request, svc: Svc) -> Envelope[TokenOut]:
    return ok(await svc.refresh(data.refresh_token, _ua(request)))


@router.post("/logout", status_code=204, summary="Revoke the refresh token family")
async def logout(data: RefreshIn, svc: Svc) -> None:
    await svc.logout(data.refresh_token)


@router.post("/reset-password", status_code=204, summary="Reset password using an OTP")
async def reset_password(data: ResetPasswordIn, svc: Svc) -> None:
    await svc.reset_password(data.mobile_number, data.code, data.new_password)


@router.get("/sessions", response_model=Envelope[list[SessionOut]], summary="Devices signed in to my account")
async def sessions(user: UserDep, svc: Svc) -> Envelope[list[SessionOut]]:
    return ok(await svc.list_sessions(user.id, user.session_family))


@router.delete("/sessions/{family_id}", status_code=204, summary="Sign out one device")
async def revoke_session(family_id: str, user: UserDep, svc: Svc) -> None:
    await svc.revoke_session(user.id, family_id)


@router.post("/logout-all", status_code=204, summary="Sign out everywhere (all devices, immediately)")
async def logout_all(user: UserDep, svc: Svc) -> None:
    await svc.logout_all(user)
