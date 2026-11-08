from typing import Annotated, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, Query

from app.api.dependencies import ContainerDep, MatchmakerDep, UserDep
from app.common.enums import CommunityKind
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import GeoPointIn, parse_object_id
from app.modules.communities.schemas import (
    BlockedUserOut,
    CommunityIn,
    CommunityLeaderboardOut,
    CommunityMemberOut,
    CommunityOut,
    CommunityTeamOut,
    CommunityUpdateIn,
    FeedOut,
    JoinIn,
    MemberRoleIn,
    PostIn,
    PostOut,
    ReportPostIn,
    TeamLinkIn,
    VoteIn,
)
from app.modules.communities.service import BlockService, CommunityService

router = APIRouter(prefix="/communities", tags=["Communities"], responses=ERROR_RESPONSES)
blocks_router = APIRouter(prefix="/users", tags=["Safety"], responses=ERROR_RESPONSES)


def _svc(c: ContainerDep) -> CommunityService:
    return CommunityService(c)


Svc = Annotated[CommunityService, Depends(_svc)]


def _id(v: str, field: str = "community") -> ObjectId:
    return parse_object_id(v, field=field, not_found=True)


@router.post(
    "", status_code=201, response_model=Envelope[CommunityOut], summary="Create a community (you become its owner)"
)
async def create(data: CommunityIn, user: MatchmakerDep, svc: Svc) -> Envelope[CommunityOut]:
    return ok(await svc.create(user, data))


@router.get("/discover", response_model=Envelope[list[CommunityOut]], summary="Find communities near you")
async def discover(
    user: UserDep,
    svc: Svc,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
    radius_km: Annotated[int, Query(ge=1, le=200)] = 50,
    city: Annotated[str | None, Query(max_length=60)] = None,
    kind: CommunityKind | None = None,
    q: Annotated[str | None, Query(max_length=60)] = None,
    mine: bool = False,
) -> Envelope[list[CommunityOut]]:
    at = GeoPointIn(lat=lat, lng=lng) if lat is not None and lng is not None else None
    return ok(await svc.discover(user, at, radius_km, city, kind.value if kind else None, q, mine))


@router.get("/feed", response_model=FeedOut, summary="Combined feed: for_you | nearby | following")
async def combined_feed(
    user: UserDep,
    svc: Svc,
    scope: Literal["for_you", "nearby", "following"] = "for_you",
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lng: Annotated[float | None, Query(ge=-180, le=180)] = None,
    radius_km: Annotated[int, Query(ge=1, le=100)] = 25,
    before: Annotated[str | None, Query(max_length=24)] = None,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> FeedOut:
    at = GeoPointIn(lat=lat, lng=lng) if lat is not None and lng is not None else None
    return await svc.combined_feed(user, scope, at, radius_km, before, limit)


@router.post("/posts/{post_id}/hide", status_code=204, summary="Hide a post from my feeds")
async def hide_post(post_id: str, user: UserDep, svc: Svc) -> None:
    await svc.hide_post(user, _id(post_id, "post"))


@router.delete("/posts/{post_id}/hide", status_code=204, summary="Show a hidden post again")
async def unhide_post(post_id: str, user: UserDep, svc: Svc) -> None:
    await svc.unhide_post(user, _id(post_id, "post"))


@router.get("/{community_id}", response_model=Envelope[CommunityOut], summary="Community profile")
async def get(community_id: str, user: UserDep, svc: Svc) -> Envelope[CommunityOut]:
    return ok(await svc.get(user, _id(community_id)))


@router.put("/{community_id}", response_model=Envelope[CommunityOut], summary="Update community (admins)")
async def update(community_id: str, data: CommunityUpdateIn, user: MatchmakerDep, svc: Svc) -> Envelope[CommunityOut]:
    return ok(await svc.update(user, _id(community_id), data))


@router.post(
    "/{community_id}/join", response_model=Envelope[CommunityOut], summary="Join (public) or request to join (private)"
)
async def join(community_id: str, data: JoinIn, user: MatchmakerDep, svc: Svc) -> Envelope[CommunityOut]:
    return ok(await svc.join(user, _id(community_id), data.accept_guidelines))


@router.post("/{community_id}/leave", status_code=204, summary="Leave the community")
async def leave(community_id: str, user: UserDep, svc: Svc) -> None:
    await svc.leave(user, _id(community_id))


@router.get("/{community_id}/members", response_model=Envelope[list[CommunityMemberOut]], summary="Member directory")
async def members(
    community_id: str, user: UserDep, svc: Svc, status: Literal["active", "pending"] = "active"
) -> Envelope[list[CommunityMemberOut]]:
    return ok(await svc.list_members(user, _id(community_id), status))


@router.post(
    "/{community_id}/members/{user_id}/approve", status_code=204, summary="Approve a join request (moderators)"
)
async def approve(community_id: str, user_id: str, user: MatchmakerDep, svc: Svc) -> None:
    await svc.decide_request(user, _id(community_id), _id(user_id, "user"), True)


@router.post(
    "/{community_id}/members/{user_id}/decline", status_code=204, summary="Decline a join request (moderators)"
)
async def decline(community_id: str, user_id: str, user: MatchmakerDep, svc: Svc) -> None:
    await svc.decide_request(user, _id(community_id), _id(user_id, "user"), False)


@router.delete(
    "/{community_id}/members/{user_id}", status_code=204, summary="Remove (moderators) or ban (admins) a member"
)
async def remove(community_id: str, user_id: str, user: MatchmakerDep, svc: Svc, ban: bool = False) -> None:
    await svc.remove_member(user, _id(community_id), _id(user_id, "user"), ban)


@router.put("/{community_id}/members/{user_id}/role", status_code=204, summary="Change a member's role (admins)")
async def set_role(community_id: str, user_id: str, data: MemberRoleIn, user: MatchmakerDep, svc: Svc) -> None:
    await svc.set_role(user, _id(community_id), _id(user_id, "user"), data.role)


@router.get("/{community_id}/teams", response_model=Envelope[list[CommunityTeamOut]], summary="Teams in the community")
async def teams(community_id: str, user: UserDep, svc: Svc) -> Envelope[list[CommunityTeamOut]]:
    return ok(await svc.teams(user, _id(community_id)))


@router.post(
    "/{community_id}/teams", status_code=201, response_model=Envelope[CommunityTeamOut], summary="Add your team"
)
async def link_team(community_id: str, data: TeamLinkIn, user: MatchmakerDep, svc: Svc) -> Envelope[CommunityTeamOut]:
    return ok(await svc.link_team(user, _id(community_id), ObjectId(data.team_id)))


@router.post("/{community_id}/teams/{team_id}/approve", status_code=204, summary="Approve a team (moderators)")
async def approve_team(community_id: str, team_id: str, user: MatchmakerDep, svc: Svc) -> None:
    await svc.approve_team(user, _id(community_id), _id(team_id, "team"))


@router.get("/{community_id}/feed", response_model=FeedOut, summary="Community feed")
async def feed(
    community_id: str, user: UserDep, svc: Svc, before: Annotated[str | None, Query(max_length=24)] = None
) -> FeedOut:
    return await svc.feed(user, _id(community_id), before)


@router.post(
    "/{community_id}/posts", status_code=201, response_model=Envelope[PostOut], summary="Post to the community"
)
async def post(community_id: str, data: PostIn, user: MatchmakerDep, svc: Svc) -> Envelope[PostOut]:
    return ok(await svc.post(user, _id(community_id), data))


@router.post("/{community_id}/posts/{post_id}/vote", response_model=Envelope[PostOut], summary="Vote in a poll")
async def vote(community_id: str, post_id: str, data: VoteIn, user: MatchmakerDep, svc: Svc) -> Envelope[PostOut]:
    return ok(await svc.vote(user, _id(community_id), _id(post_id, "post"), data.option))


@router.delete("/{community_id}/posts/{post_id}", status_code=204, summary="Remove a post (author or moderators)")
async def remove_post(community_id: str, post_id: str, user: UserDep, svc: Svc) -> None:
    await svc.remove_post(user, _id(community_id), _id(post_id, "post"))


@router.post("/{community_id}/posts/{post_id}/report", status_code=204, summary="Report a post")
async def report_post(community_id: str, post_id: str, data: ReportPostIn, user: UserDep, svc: Svc) -> None:
    await svc.report_post(user, _id(community_id), _id(post_id, "post"), data.reason)


@router.get(
    "/{community_id}/leaderboard", response_model=Envelope[CommunityLeaderboardOut], summary="Community rankings"
)
async def leaderboard(community_id: str, user: UserDep, svc: Svc) -> Envelope[CommunityLeaderboardOut]:
    return ok(await svc.leaderboard(user, _id(community_id)))


@blocks_router.get("/me/blocks", response_model=Envelope[list[BlockedUserOut]], summary="People I've blocked")
async def my_blocks(user: UserDep, c: ContainerDep) -> Envelope[list[BlockedUserOut]]:
    return ok(await BlockService(c).mine(user))


@blocks_router.post("/{user_id}/block", status_code=204, summary="Block a user (hides their posts from you)")
async def block(user_id: str, user: UserDep, c: ContainerDep) -> None:
    await BlockService(c).block(user, _id(user_id, "user"))


@blocks_router.delete("/{user_id}/block", status_code=204, summary="Unblock a user")
async def unblock(user_id: str, user: UserDep, c: ContainerDep) -> None:
    await BlockService(c).unblock(user, _id(user_id, "user"))
