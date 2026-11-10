"""Captain invite links ("add yourself to the squad"). See service.py for the flow."""

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.dependencies import ContainerDep, MatchmakerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import parse_object_id
from app.core.exceptions import AppError
from app.modules.auth.schemas import TokenOut
from app.modules.joinlinks.schemas import InviteLinkOut, InviteRegisterIn, JoinIn, JoinPreviewOut, JoinResultOut
from app.modules.joinlinks.service import JoinLinkService

router = APIRouter(tags=["Invite links"], responses=ERROR_RESPONSES)


def _svc(c: ContainerDep) -> JoinLinkService:
    return JoinLinkService(c)


Svc = Annotated[JoinLinkService, Depends(_svc)]


@router.post(
    "/matches/{match_id}/invite-link",
    response_model=Envelope[InviteLinkOut],
    summary="Get (or create) the squad invite link for WhatsApp groups",
)
async def invite_link(match_id: str, user: MatchmakerDep, svc: Svc, rotate: bool = False) -> Envelope[InviteLinkOut]:
    return ok(await svc.get_or_create(user, parse_object_id(match_id, field="match", not_found=True), rotate))


@router.delete("/matches/{match_id}/invite-link", status_code=204, summary="Turn off the squad invite link")
async def revoke_invite_link(match_id: str, user: UserDep, svc: Svc) -> None:
    await svc.revoke(user, parse_object_id(match_id, field="match", not_found=True))


@router.get(
    "/join/{code}", response_model=Envelope[JoinPreviewOut], summary="Public preview of an invite link (no exact venue)"
)
async def join_preview(code: str, svc: Svc) -> Envelope[JoinPreviewOut]:
    return ok(await svc.preview(code))


@router.post("/join/{code}", response_model=Envelope[JoinResultOut], summary="Add myself to the team and match squad")
async def join(code: str, data: JoinIn, user: MatchmakerDep, svc: Svc) -> Envelope[JoinResultOut]:
    return ok(await svc.join(user, code, data))


@router.post(
    "/auth/invite-register",
    status_code=201,
    response_model=Envelope[TokenOut],
    summary="Register via a captain's invite link (password account)",
)
async def invite_register(data: InviteRegisterIn, request: Request, svc: Svc) -> Envelope[TokenOut]:
    if not svc.c.settings.invite_register_enabled:
        raise AppError(
            "Sign up with your mobile number to join. Your invite opens straight after.",
            code="INVITE_REGISTER_DISABLED",
            status_code=410,
        )
    return ok(await svc.register(data, request.headers.get("user-agent")))
