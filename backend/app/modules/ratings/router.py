from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import ContainerDep, MatchmakerDep, UserDep
from app.common.enums import RatingType
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import parse_object_id
from app.modules.ratings.service import (
    RateableOut,
    RatingIn,
    RatingOut,
    RatingService,
    ReputationOut,
)

router = APIRouter(tags=["Ratings & Reputation"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> RatingService:
    return RatingService(c)


Svc = Annotated[RatingService, Depends(service)]


@router.post(
    "/matches/{match_id}/ratings",
    status_code=201,
    response_model=Envelope[RatingOut],
    summary="Rate a verified participant of a completed match",
)
async def rate(match_id: str, data: RatingIn, user: MatchmakerDep, svc: Svc) -> Envelope[RatingOut]:
    return ok(await svc.rate(user, parse_object_id(match_id, field="match", not_found=True), data))


@router.get(
    "/matches/{match_id}/ratings/pending",
    response_model=Envelope[list[RateableOut]],
    summary="Participants I can rate for this match",
)
async def rateable(match_id: str, user: UserDep, svc: Svc) -> Envelope[list[RateableOut]]:
    return ok(await svc.rateable(user, parse_object_id(match_id, field="match", not_found=True)))


@router.get(
    "/users/{user_id}/ratings", response_model=Envelope[ReputationOut], summary="Reputation (player or captain)"
)
async def reputation(
    user_id: str, _: UserDep, svc: Svc, type: RatingType = RatingType.PLAYER
) -> Envelope[ReputationOut]:  # noqa: A002
    return ok(await svc.reputation(parse_object_id(user_id, field="user", not_found=True), type))
