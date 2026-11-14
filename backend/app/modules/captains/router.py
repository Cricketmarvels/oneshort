from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import CaptainDep, ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import parse_object_id
from app.modules.captains.service import CaptainOut, CaptainProfileIn, CaptainService

router = APIRouter(prefix="/captains", tags=["Captains"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> CaptainService:
    return CaptainService(c)


Svc = Annotated[CaptainService, Depends(service)]


@router.get("/me", response_model=Envelope[CaptainOut], summary="My captain profile")
async def get_me(user: UserDep, svc: Svc) -> Envelope[CaptainOut]:
    return ok(await svc.get(user.id))


@router.put("/me", response_model=Envelope[CaptainOut], summary="Create or update my captain profile")
async def put_me(data: CaptainProfileIn, user: CaptainDep, svc: Svc) -> Envelope[CaptainOut]:
    return ok(await svc.upsert_me(user, data))


@router.get("/{captain_id}", response_model=Envelope[CaptainOut], summary="Public captain profile")
async def get_captain(captain_id: str, _: UserDep, svc: Svc) -> Envelope[CaptainOut]:
    return ok(await svc.get(parse_object_id(captain_id, field="captain", not_found=True)))
