from typing import Annotated

from bson import ObjectId
from fastapi import APIRouter, Depends

from app.api.dependencies import ContainerDep, MatchmakerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import parse_object_id
from app.modules.cricheroes.schemas import CricHeroesImportIn, CricHeroesLinkIn, CricHeroesProfileOut
from app.modules.cricheroes.service import CricHeroesService

router = APIRouter(prefix="/teams/{team_id}/cricheroes", tags=["CricHeroes"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> CricHeroesService:
    return CricHeroesService(c)


Svc = Annotated[CricHeroesService, Depends(service)]


def _tid(team_id: str) -> ObjectId:
    return parse_object_id(team_id, field="team", not_found=True)


@router.get("", response_model=Envelope[CricHeroesProfileOut], summary="Team's linked CricHeroes profile and data")
async def get_cricheroes(team_id: str, user: UserDep, svc: Svc) -> Envelope[CricHeroesProfileOut]:
    return ok(await svc.get(user, _tid(team_id)))


@router.put(
    "/link",
    response_model=Envelope[CricHeroesProfileOut],
    summary="Link the team to its CricHeroes team page (captain/admin)",
)
async def link_cricheroes(
    team_id: str, data: CricHeroesLinkIn, user: MatchmakerDep, svc: Svc
) -> Envelope[CricHeroesProfileOut]:
    return ok(await svc.link(user, _tid(team_id), data.url))


@router.post(
    "/import",
    response_model=Envelope[CricHeroesProfileOut],
    summary="Import CricHeroes team data from a file or manual entry (captain/admin)",
    description="Replaces the stored snapshot. Accepts the same JSON shape as the community `cricheroes` package's "
    "output (team_name, team_logo, players, matches, stats, leaderboard); unknown fields are ignored.",
)
async def import_cricheroes(
    team_id: str, data: CricHeroesImportIn, user: MatchmakerDep, svc: Svc
) -> Envelope[CricHeroesProfileOut]:
    return ok(await svc.import_snapshot(user, _tid(team_id), data.data, data.method))


@router.post(
    "/sync",
    response_model=Envelope[CricHeroesProfileOut],
    summary="Fetch the latest data from CricHeroes automatically (captain/admin)",
    description="Returns 503 INTEGRATION_NOT_CONFIGURED until an authorised CricHeroes data source is configured.",
)
async def sync_cricheroes(team_id: str, user: MatchmakerDep, svc: Svc) -> Envelope[CricHeroesProfileOut]:
    return ok(await svc.sync(user, _tid(team_id)))


@router.delete("", status_code=204, summary="Remove the CricHeroes link and data (captain/admin)")
async def delete_cricheroes(team_id: str, user: MatchmakerDep, svc: Svc) -> None:
    await svc.remove(user, _tid(team_id))
