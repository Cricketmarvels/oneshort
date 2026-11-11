from typing import Annotated, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends

from app.api.dependencies import ContainerDep, MatchmakerDep, UserDep
from app.common.enums import InvitationDirection, InvitationStatus
from app.common.response import (
    ERROR_RESPONSES,
    Envelope,
    PagedEnvelope,
    PageParams,
    ok,
    page_params,
    paged,
)
from app.common.types import parse_object_id
from app.modules.invitations.schemas import CommitmentIn, InvitationOut, RespondIn
from app.modules.invitations.service import InvitationService

router = APIRouter(prefix="/invitations", tags=["Invitations"], responses=ERROR_RESPONSES)
Page = Annotated[PageParams, Depends(page_params)]


def service(c: ContainerDep) -> InvitationService:
    return InvitationService(c)


Svc = Annotated[InvitationService, Depends(service)]


def _iid(invitation_id: str) -> ObjectId:
    return parse_object_id(invitation_id, field="invitation", not_found=True)


@router.get(
    "/me", response_model=PagedEnvelope[InvitationOut], summary="My invitations (received) and join requests (sent)"
)
async def mine(
    user: UserDep,
    svc: Svc,
    page: Page,
    box: Literal["received", "sent", "all"] = "all",
    status: InvitationStatus | None = None,
) -> PagedEnvelope[InvitationOut]:
    items, total = await svc.list_mine(user, box, status, page)
    return paged(items, page, total)


@router.get(
    "/managed",
    response_model=PagedEnvelope[InvitationOut],
    summary="Invitations and join requests across matches I manage",
)
async def managed(
    user: UserDep,
    svc: Svc,
    page: Page,
    direction: InvitationDirection | None = None,
    status: InvitationStatus | None = None,
) -> PagedEnvelope[InvitationOut]:
    items, total = await svc.list_for_captain(user, direction, status, page)
    return paged(items, page, total)


@router.post("/{invitation_id}/accept", response_model=Envelope[InvitationOut], summary="Accept an invitation")
async def accept(
    invitation_id: str, user: MatchmakerDep, svc: Svc, data: CommitmentIn | None = None
) -> Envelope[InvitationOut]:
    return ok(await svc.accept(user, _iid(invitation_id), data))


@router.post(
    "/{invitation_id}/reject",
    response_model=Envelope[InvitationOut],
    summary="Reject an invitation (player) or a join request (captain)",
)
async def reject(invitation_id: str, data: RespondIn, user: UserDep, svc: Svc) -> Envelope[InvitationOut]:
    return ok(await svc.reject(user, _iid(invitation_id), data.reason))


@router.post("/{invitation_id}/cancel", response_model=Envelope[InvitationOut], summary="Cancel an invitation")
async def cancel(invitation_id: str, data: RespondIn, user: UserDep, svc: Svc) -> Envelope[InvitationOut]:
    return ok(await svc.cancel(user, _iid(invitation_id), data.reason))


@router.post(
    "/{invitation_id}/confirm",
    response_model=Envelope[InvitationOut],
    summary="Confirm an accepted invitation or approve a join request (captain)",
)
async def confirm(invitation_id: str, user: MatchmakerDep, svc: Svc) -> Envelope[InvitationOut]:
    return ok(await svc.confirm(user, _iid(invitation_id)))
