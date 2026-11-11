"""Match, invitation-for-match, roster and Build-a-Team suggestion endpoints."""

from typing import Annotated, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, Query

from app.api.dependencies import ContainerDep, MatchmakerDep, UserDep
from app.common.enums import InvitationStatus, MatchStatus, PlayingRole
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
from app.core.exceptions import NotFound
from app.modules.invitations.schemas import (
    CommitmentIn,
    CreateInvitationsIn,
    InvitationOut,
    InvitationResultItem,
    JoinRequestIn,
)
from app.modules.invitations.service import InvitationService
from app.modules.matches.schemas import (
    CancelIn,
    CompleteIn,
    MatchIn,
    MatchOut,
    MatchUpdateIn,
    TransitionIn,
)
from app.modules.matches.service import MatchService
from app.modules.squads.service import (
    ConfirmIn,
    ReplaceIn,
    RosterOut,
    RosterUpdateIn,
    SquadService,
    SuggestionOut,
    WithdrawIn,
)

router = APIRouter(prefix="/matches", tags=["Matches"], responses=ERROR_RESPONSES)
Page = Annotated[PageParams, Depends(page_params)]


def match_service(c: ContainerDep) -> MatchService:
    return MatchService(c)


def invitation_service(c: ContainerDep) -> InvitationService:
    return InvitationService(c)


def squad_service(c: ContainerDep) -> SquadService:
    return SquadService(c)


Matches = Annotated[MatchService, Depends(match_service)]
Invites = Annotated[InvitationService, Depends(invitation_service)]
Squads = Annotated[SquadService, Depends(squad_service)]


def _mid(match_id: str) -> ObjectId:
    return parse_object_id(match_id, field="match", not_found=True)


@router.post("", status_code=201, response_model=Envelope[MatchOut], summary="Create a match (Build a Team)")
async def create_match(data: MatchIn, user: MatchmakerDep, svc: Matches) -> Envelope[MatchOut]:
    return ok(await svc.create(user, data))


@router.get("", response_model=PagedEnvelope[MatchOut], summary="My matches (as captain and/or player)")
async def list_matches(
    user: UserDep,
    svc: Matches,
    page: Page,
    role: Literal["captain", "player", "all"] = "all",
    when: Literal["upcoming", "past", "all"] = "upcoming",
    team_id: Annotated[str | None, Query()] = None,
    status: MatchStatus | None = None,
) -> PagedEnvelope[MatchOut]:
    tid = parse_object_id(team_id, field="team") if team_id else None
    items, total = await svc.list_matches(user, role, when, tid, status, page)
    return paged(items, page, total)


@router.get("/{match_id}", response_model=Envelope[MatchOut], summary="Match details")
async def get_match(match_id: str, user: UserDep, svc: Matches) -> Envelope[MatchOut]:
    return ok(await svc.get(user, _mid(match_id)))


@router.put("/{match_id}", response_model=Envelope[MatchOut], summary="Update or reschedule a match")
async def update_match(match_id: str, data: MatchUpdateIn, user: MatchmakerDep, svc: Matches) -> Envelope[MatchOut]:
    return ok(await svc.update(user, _mid(match_id), data))


@router.post("/{match_id}/transition", response_model=Envelope[MatchOut], summary="Advance the match lifecycle")
async def transition(match_id: str, data: TransitionIn, user: MatchmakerDep, svc: Matches) -> Envelope[MatchOut]:
    return ok(await svc.transition(user, _mid(match_id), MatchStatus(data.to), data.allow_short_squad))


@router.post("/{match_id}/cancel", response_model=Envelope[MatchOut], summary="Cancel a match")
async def cancel_match(match_id: str, data: CancelIn, user: UserDep, svc: Matches) -> Envelope[MatchOut]:
    return ok(await svc.cancel(user, _mid(match_id), data.reason))


@router.post(
    "/{match_id}/complete", response_model=Envelope[MatchOut], summary="Complete a match and record attendance"
)
async def complete_match(match_id: str, data: CompleteIn, user: UserDep, svc: Matches) -> Envelope[MatchOut]:
    return ok(await svc.complete(user, _mid(match_id), data))


# ---------------------------------------------------------------- invitations
@router.post(
    "/{match_id}/invitations",
    status_code=201,
    response_model=Envelope[list[InvitationResultItem]],
    summary="Invite one or more players (per-player result)",
)
async def invite(
    match_id: str, data: CreateInvitationsIn, user: MatchmakerDep, svc: Invites
) -> Envelope[list[InvitationResultItem]]:
    return ok(await svc.invite(user, _mid(match_id), data))


@router.get(
    "/{match_id}/invitations",
    response_model=Envelope[list[InvitationOut]],
    summary="Invitations and join requests for a match (managers)",
)
async def match_invitations(
    match_id: str, user: UserDep, svc: Invites, status: InvitationStatus | None = None
) -> Envelope[list[InvitationOut]]:
    return ok(await svc.list_for_match(user, _mid(match_id), status))


@router.post(
    "/{match_id}/join-requests",
    status_code=201,
    response_model=Envelope[InvitationOut],
    summary="Request to join a match (Find a Team)",
)
async def join_request(
    match_id: str, data: JoinRequestIn, user: MatchmakerDep, svc: Invites
) -> Envelope[InvitationOut]:
    return ok(await svc.request_join(user, _mid(match_id), data))


# --------------------------------------------------------------------- roster
@router.get("/{match_id}/roster", response_model=Envelope[RosterOut], summary="Squad and composition")
async def get_roster(match_id: str, user: UserDep, svc: Squads) -> Envelope[RosterOut]:
    return ok(await svc.roster(user, _mid(match_id)))


@router.post(
    "/{match_id}/roster",
    response_model=Envelope[RosterOut],
    summary="Confirm an accepted invitation / approve a join request into the squad",
)
async def confirm_into_roster(
    match_id: str, data: ConfirmIn, user: MatchmakerDep, invites: Invites, squads: Squads
) -> Envelope[RosterOut]:
    inv_id = parse_object_id(data.invitation_id, field="invitation", not_found=True)
    inv = await invites.col.find_one({"_id": inv_id, "match_id": _mid(match_id)}, {"_id": 1})
    if not inv:
        raise NotFound("Invitation not found for this match")
    await invites.confirm(user, inv_id)
    return ok(await squads.roster(user, _mid(match_id)))


@router.put(
    "/{match_id}/roster/{player_id}",
    response_model=Envelope[RosterOut],
    summary="Update a squad entry (role, payee status) or remove the player",
)
async def update_roster(
    match_id: str, player_id: str, data: RosterUpdateIn, user: MatchmakerDep, svc: Squads
) -> Envelope[RosterOut]:
    return ok(await svc.update_entry(user, _mid(match_id), parse_object_id(player_id, field="player"), data))


@router.post(
    "/{match_id}/roster/{player_id}/replace",
    response_model=Envelope[list[InvitationResultItem]],
    summary="Replace a squad player and send a substitute invitation",
)
async def replace_player(
    match_id: str, player_id: str, data: ReplaceIn, user: MatchmakerDep, svc: Squads
) -> Envelope[list[InvitationResultItem]]:
    return ok(await svc.replace(user, _mid(match_id), parse_object_id(player_id, field="player"), data))


@router.post("/{match_id}/commitment", status_code=204, summary="Mark myself tentative or confirmed in the squad")
async def set_commitment(match_id: str, data: CommitmentIn, user: UserDep, svc: Squads) -> None:
    await svc.set_commitment(user, _mid(match_id), data.commitment, data.commitment_note)


@router.post("/{match_id}/withdraw", status_code=204, summary="Withdraw myself from the squad")
async def withdraw(match_id: str, data: WithdrawIn, user: UserDep, svc: Squads) -> None:
    await svc.withdraw(user, _mid(match_id), data.reason)


# ---------------------------------------------------------------- suggestions
@router.get(
    "/{match_id}/suggestions/members",
    response_model=Envelope[list[SuggestionOut]],
    summary="Build a Team, method A: team members with availability",
)
async def suggest_members(
    match_id: str,
    user: UserDep,
    svc: Squads,
    role: PlayingRole | None = None,
    q: Annotated[str | None, Query(max_length=60)] = None,
) -> Envelope[list[SuggestionOut]]:
    return ok(await svc.suggest_members(user, _mid(match_id), role.value if role else None, q))


@router.get(
    "/{match_id}/suggestions/previous",
    response_model=Envelope[list[SuggestionOut]],
    summary="Build a Team, method C: previous participants who are available",
)
async def suggest_previous(
    match_id: str,
    user: UserDep,
    svc: Squads,
    role: PlayingRole | None = None,
    q: Annotated[str | None, Query(max_length=60)] = None,
) -> Envelope[list[SuggestionOut]]:
    return ok(await svc.suggest_previous(user, _mid(match_id), role.value if role else None, q))
