from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.modules.auth.schemas import (
    AuthOptionsOut,
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


@router.get("/options", response_model=Envelope[AuthOptionsOut], summary="Which login channels are available")
async def options(c: ContainerDep) -> Envelope[AuthOptionsOut]:
    return ok(
        AuthOptionsOut(
            sms_otp=True,
            whatsapp_otp=c.whatsapp.configured,
            whatsapp_simulator=c.settings.whatsapp_provider == "simulator",
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
    return ok(await svc.verify_otp(data.mobile_number, data.code, data.purpose, _ua(request)))


@router.post("/login", response_model=Envelope[TokenOut], summary="Email + password login")
async def login(data: PasswordLoginIn, request: Request, svc: Svc) -> Envelope[TokenOut]:
    return ok(await svc.password_login(str(data.email), data.password, _ua(request)))


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
