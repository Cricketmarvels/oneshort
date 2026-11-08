from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import ContainerDep, MatchmakerDep
from app.common.response import ERROR_RESPONSES
from app.modules.discovery.schemas import (
    PlayerSearchIn,
    PlayerSearchOut,
    TeamSearchIn,
    TeamSearchOut,
)
from app.modules.discovery.service import DiscoveryService

router = APIRouter(prefix="/discovery", tags=["Discovery"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> DiscoveryService:
    return DiscoveryService(c)


Svc = Annotated[DiscoveryService, Depends(service)]


@router.post(
    "/players",
    response_model=PlayerSearchOut,
    summary="Find a Player: available players within the radius of the match venue, ranked",
)
async def find_players(req: PlayerSearchIn, user: MatchmakerDep, svc: Svc) -> PlayerSearchOut:
    return await svc.find_players(user, req)


@router.post("/teams", response_model=TeamSearchOut, summary="Find a Team: open matches with vacancies near you")
async def find_teams(req: TeamSearchIn, user: MatchmakerDep, svc: Svc) -> TeamSearchOut:
    return await svc.find_teams(user, req)
