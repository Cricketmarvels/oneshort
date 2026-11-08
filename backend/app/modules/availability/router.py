from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.api.dependencies import ContainerDep, MatchmakerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import AwareDatetime, parse_object_id
from app.modules.availability.schemas import AvailabilityIn, AvailabilityOut, AvailabilityUpdateIn
from app.modules.availability.service import AvailabilityService

router = APIRouter(prefix="/availability", tags=["Availability"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> AvailabilityService:
    return AvailabilityService(c)


Svc = Annotated[AvailabilityService, Depends(service)]


@router.post(
    "",
    status_code=201,
    response_model=Envelope[list[AvailabilityOut]],
    summary="Declare availability (optionally repeating weekly)",
)
async def create(data: AvailabilityIn, user: MatchmakerDep, svc: Svc) -> Envelope[list[AvailabilityOut]]:
    return ok(await svc.create(user, data))


@router.get("/me", response_model=Envelope[list[AvailabilityOut]], summary="My availability slots")
async def mine(
    user: UserDep,
    svc: Svc,
    start: Annotated[AwareDatetime | None, Query()] = None,
    end: Annotated[AwareDatetime | None, Query()] = None,
    include_past: bool = False,
) -> Envelope[list[AvailabilityOut]]:
    return ok(await svc.list_mine(user, start, end, include_past))


@router.put("/{availability_id}", response_model=Envelope[AvailabilityOut], summary="Update a slot")
async def update(
    availability_id: str, data: AvailabilityUpdateIn, user: MatchmakerDep, svc: Svc
) -> Envelope[AvailabilityOut]:
    return ok(await svc.update(user, parse_object_id(availability_id, field="availability", not_found=True), data))


@router.delete("/{availability_id}", status_code=204, summary="Delete a slot")
async def delete(availability_id: str, user: UserDep, svc: Svc) -> None:
    await svc.delete(user, parse_object_id(availability_id, field="availability", not_found=True))
