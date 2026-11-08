from typing import Annotated, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, Query

from app.api.dependencies import ContainerDep, MatchmakerDep, UserDep
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
from app.modules.teams.schemas import (
    AddMemberIn,
    TeamIn,
    TeamMemberOut,
    TeamOut,
    TeamUpdateIn,
    UpdateMemberIn,
)
from app.modules.teams.service import TeamService

router = APIRouter(prefix="/teams", tags=["Teams"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> TeamService:
    return TeamService(c)


Svc = Annotated[TeamService, Depends(service)]
Page = Annotated[PageParams, Depends(page_params)]


def _tid(team_id: str) -> ObjectId:
    return parse_object_id(team_id, field="team", not_found=True)


@router.post("", status_code=201, response_model=Envelope[TeamOut], summary="Create a team (you become its captain)")
async def create_team(data: TeamIn, user: MatchmakerDep, svc: Svc) -> Envelope[TeamOut]:
    return ok(await svc.create(user, data))


@router.get("", response_model=PagedEnvelope[TeamOut], summary="List teams")
async def list_teams(
    user: UserDep,
    svc: Svc,
    page: Page,
    scope: Annotated[Literal["mine", "member", "all"], Query()] = "mine",
    q: Annotated[str | None, Query(max_length=60)] = None,
) -> PagedEnvelope[TeamOut]:
    items, total = await svc.list_teams(user, scope, q, page)
    return paged(items, page, total)


@router.get("/invitations", response_model=Envelope[list[TeamOut]], summary="Teams that invited me")
async def team_invites(user: UserDep, svc: Svc) -> Envelope[list[TeamOut]]:
    return ok(await svc.pending_invites(user))


@router.get("/{team_id}", response_model=Envelope[TeamOut], summary="Team profile")
async def get_team(team_id: str, user: UserDep, svc: Svc) -> Envelope[TeamOut]:
    return ok(await svc.get_out(_tid(team_id), user))


@router.put("/{team_id}", response_model=Envelope[TeamOut], summary="Update team (captain/admin)")
async def update_team(team_id: str, data: TeamUpdateIn, user: MatchmakerDep, svc: Svc) -> Envelope[TeamOut]:
    return ok(await svc.update(user, _tid(team_id), data))


@router.get("/{team_id}/members", response_model=Envelope[list[TeamMemberOut]], summary="Team members")
async def list_members(
    team_id: str,
    user: UserDep,
    svc: Svc,
    q: Annotated[str | None, Query(max_length=60)] = None,
    role: Annotated[str | None, Query(max_length=20)] = None,
) -> Envelope[list[TeamMemberOut]]:
    return ok(await svc.list_members(user, _tid(team_id), q, role))


@router.post("/{team_id}/members", status_code=204, summary="Invite a player to the team")
async def add_member(team_id: str, data: AddMemberIn, user: MatchmakerDep, svc: Svc) -> None:
    await svc.add_member(user, _tid(team_id), data)


@router.post("/{team_id}/membership/accept", status_code=204, summary="Accept a team invitation")
async def accept_membership(team_id: str, user: MatchmakerDep, svc: Svc) -> None:
    await svc.respond_membership(user, _tid(team_id), True)


@router.post("/{team_id}/membership/decline", status_code=204, summary="Decline a team invitation")
async def decline_membership(team_id: str, user: UserDep, svc: Svc) -> None:
    await svc.respond_membership(user, _tid(team_id), False)


@router.put("/{team_id}/members/{player_id}", status_code=204, summary="Change member role (captain)")
async def update_member(team_id: str, player_id: str, data: UpdateMemberIn, user: MatchmakerDep, svc: Svc) -> None:
    await svc.update_member_role(user, _tid(team_id), parse_object_id(player_id, field="player"), data.member_role)


@router.delete(
    "/{team_id}/members/{player_id}",
    status_code=204,
    summary="Remove a member (captain/admin) or leave the team (self)",
)
async def remove_member(team_id: str, player_id: str, user: UserDep, svc: Svc) -> None:
    await svc.remove_member(user, _tid(team_id), parse_object_id(player_id, field="player"))


@router.post("/{team_id}/join-requests", status_code=204, summary="Ask to join a team")
async def request_join(team_id: str, user: MatchmakerDep, svc: Svc) -> None:
    await svc.request_join(user, _tid(team_id))


@router.post(
    "/{team_id}/join-requests/{player_id}/approve",
    status_code=204,
    summary="Approve a join request (captain/vice-captain)",
)
async def approve_join(team_id: str, player_id: str, user: MatchmakerDep, svc: Svc) -> None:
    await svc.respond_join_request(user, _tid(team_id), parse_object_id(player_id, field="player"), True)


@router.post(
    "/{team_id}/join-requests/{player_id}/decline",
    status_code=204,
    summary="Decline a join request (captain/vice-captain)",
)
async def decline_join(team_id: str, player_id: str, user: MatchmakerDep, svc: Svc) -> None:
    await svc.respond_join_request(user, _tid(team_id), parse_object_id(player_id, field="player"), False)
