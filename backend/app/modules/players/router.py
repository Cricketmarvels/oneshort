from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import parse_object_id
from app.modules.players.schemas import PlayerProfileIn, PlayerPublicOut, PlayerSelfOut
from app.modules.players.service import PlayerService

router = APIRouter(prefix="/players", tags=["Players"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> PlayerService:
    return PlayerService(c)


Svc = Annotated[PlayerService, Depends(service)]


@router.get("/me", response_model=Envelope[PlayerSelfOut], summary="My player profile")
async def get_me(user: UserDep, svc: Svc) -> Envelope[PlayerSelfOut]:
    return ok(await svc.me(user))


@router.put("/me", response_model=Envelope[PlayerSelfOut], summary="Create or update my player profile")
async def put_me(data: PlayerProfileIn, user: UserDep, svc: Svc) -> Envelope[PlayerSelfOut]:
    return ok(await svc.upsert_me(user, data))


@router.get(
    "/{player_id}",
    response_model=Envelope[PlayerPublicOut],
    summary="Public player profile (no location or contact details)",
)
async def get_player(player_id: str, _: UserDep, svc: Svc) -> Envelope[PlayerPublicOut]:
    return ok(await svc.public(parse_object_id(player_id, field="player", not_found=True)))
