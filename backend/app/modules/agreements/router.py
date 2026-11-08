from typing import Annotated

from fastapi import APIRouter, Depends, Request

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.modules.agreements.service import (
    AcceptIn,
    AgreementOut,
    AgreementService,
    MyAgreementsOut,
)

router = APIRouter(prefix="/agreements", tags=["Agreements"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> AgreementService:
    return AgreementService(c)


Svc = Annotated[AgreementService, Depends(service)]


@router.get("/current", response_model=Envelope[AgreementOut], summary="Current Platform User Agreement")
async def current(svc: Svc) -> Envelope[AgreementOut]:
    return ok(svc.to_out(await svc.current()))


@router.post("/acceptance", response_model=Envelope[MyAgreementsOut], summary="Accept the agreement")
async def accept(data: AcceptIn, request: Request, user: UserDep, svc: Svc) -> Envelope[MyAgreementsOut]:
    ip = request.client.host if request.client else None
    return ok(await svc.accept(user, data, ip, request.headers.get("user-agent")))


@router.get("/me", response_model=Envelope[MyAgreementsOut], summary="My agreement acceptances")
async def mine(user: UserDep, svc: Svc) -> Envelope[MyAgreementsOut]:
    return ok(await svc.mine(user))
