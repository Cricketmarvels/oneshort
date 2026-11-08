from typing import Annotated, Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, Query

from app.api.dependencies import AdminDep, ContainerDep, MatchmakerDep, UserDep
from app.common.enums import FixtureFormat
from app.common.response import ERROR_RESPONSES, Envelope, PagedEnvelope, PageParams, ok, page_params, paged
from app.common.types import GeoPointIn, parse_object_id
from app.modules.competition.challenges import ChallengeService
from app.modules.competition.fixtures import FixtureService
from app.modules.competition.home import HomeOut, build_home
from app.modules.competition.leaderboards import LeaderboardService
from app.modules.competition.schemas import (
    ChallengeIn,
    ChallengeOut,
    ChallengeReasonIn,
    CompareOut,
    CounterProposalIn,
    DisputeIn,
    FixtureOut,
    HeadToHeadOut,
    LeaderboardScope,
    NearbyPlayerOut,
    PlayerCategory,
    PlayerLeaderboardOut,
    PlayerRatingOut,
    RatingHistoryOut,
    ResolveIn,
    ResultIn,
    TeamCompareOut,
    TeamDashboardOut,
    TeamDiscoverEntry,
    TeamLeaderboardOut,
)

router = APIRouter(responses=ERROR_RESPONSES)


def _ch(c: ContainerDep) -> ChallengeService:
    return ChallengeService(c)


def _fx(c: ContainerDep) -> FixtureService:
    return FixtureService(c)


def _lb(c: ContainerDep) -> LeaderboardService:
    return LeaderboardService(c)


Ch = Annotated[ChallengeService, Depends(_ch)]
Fx = Annotated[FixtureService, Depends(_fx)]
Lb = Annotated[LeaderboardService, Depends(_lb)]
Page = Annotated[PageParams, Depends(page_params)]
Lat = Annotated[float | None, Query(ge=-90, le=90)]
Lng = Annotated[float | None, Query(ge=-180, le=180)]
Name = Annotated[str | None, Query(max_length=60)]


def _at(lat: float | None, lng: float | None) -> GeoPointIn | None:
    return GeoPointIn(lat=lat, lng=lng) if lat is not None and lng is not None else None


def _oid(v: str, field: str) -> ObjectId:
    return parse_object_id(v, field=field, not_found=True)


# ------------------------------------------------------------------ leaderboards & ratings
@router.get(
    "/players/leaderboard",
    response_model=PlayerLeaderboardOut,
    tags=["Leaderboards"],
    summary="Location-based player rankings",
    description="Radius scopes need lat/lng (or a saved home area). Distances are approximate (0.5 km).",
)
async def player_leaderboard(
    user: UserDep,
    svc: Lb,
    page: Page,
    scope: LeaderboardScope = "10km",
    category: PlayerCategory = "overall",
    format: FixtureFormat | None = None,  # noqa: A002
    lat: Lat = None,
    lng: Lng = None,
    city: Name = None,
    state: Name = None,
) -> PlayerLeaderboardOut:
    return await svc.players(user, scope, category, format.value if format else None, _at(lat, lng), city, state, page)


@router.get(
    "/players/compare", response_model=Envelope[CompareOut], tags=["Leaderboards"], summary="Compare two players"
)
async def compare_players(user: UserDep, svc: Lb, a: str, b: str) -> Envelope[CompareOut]:
    pa = await svc.player_rating(user, _oid(a, "player"))
    pb = await svc.player_rating(user, _oid(b, "player"))
    return ok(CompareOut(a=pa, b=pb))


@router.get(
    "/ratings/players/{player_id}",
    response_model=Envelope[PlayerRatingOut],
    tags=["Ratings"],
    summary="Player skill rating, confidence, trend and explanation",
)
async def player_rating(player_id: str, user: UserDep, svc: Lb) -> Envelope[PlayerRatingOut]:
    return ok(await svc.player_rating(user, _oid(player_id, "player")))


@router.get(
    "/ratings/players/{player_id}/history",
    response_model=PagedEnvelope[RatingHistoryOut],
    tags=["Ratings"],
    summary="Per-match rating changes with reasons",
)
async def player_rating_history(player_id: str, user: UserDep, svc: Lb, page: Page) -> PagedEnvelope[RatingHistoryOut]:
    items, total = await svc.history(user, _oid(player_id, "player"), page)
    return paged(items, page, total)


@router.get("/teams/leaderboard", response_model=TeamLeaderboardOut, tags=["Leaderboards"], summary="Team rankings")
async def team_leaderboard(
    user: UserDep,
    svc: Lb,
    page: Page,
    scope: LeaderboardScope = "20km",
    lat: Lat = None,
    lng: Lng = None,
    city: Name = None,
    state: Name = None,
) -> TeamLeaderboardOut:
    return await svc.teams(user, scope, _at(lat, lng), city, state, page)


@router.get(
    "/teams/discover",
    response_model=Envelope[list[TeamDiscoverEntry]],
    tags=["Challenges"],
    summary="Find teams to challenge, by distance, rating and format",
)
async def discover_teams(
    user: UserDep,
    svc: Lb,
    lat: Lat = None,
    lng: Lng = None,
    radius_km: Annotated[int, Query(ge=1, le=100)] = 20,
    from_team_id: str | None = None,
    min_rating: Annotated[float | None, Query(ge=0, le=4000)] = None,
    max_rating: Annotated[float | None, Query(ge=0, le=4000)] = None,
    format: FixtureFormat | None = None,  # noqa: A002
    q: Name = None,
    purpose: Literal["challenge", "join"] = "challenge",
    recruiting: bool = False,
) -> Envelope[list[TeamDiscoverEntry]]:
    ft = parse_object_id(from_team_id, field="team") if from_team_id else None
    return ok(
        await svc.discover_teams(
            user,
            _at(lat, lng),
            radius_km,
            ft,
            min_rating,
            max_rating,
            format.value if format else None,
            q,
            purpose=purpose,
            recruiting=recruiting,
        )
    )


@router.get(
    "/players/nearby",
    response_model=Envelope[list[NearbyPlayerOut]],
    tags=["Discovery"],
    summary="Find a Player: discoverable players near you (rated or not)",
    description="Distances are approximate (0.5 km); coordinates are never returned. Private profiles are excluded.",
)
async def nearby_players(
    user: UserDep,
    svc: Lb,
    lat: Lat = None,
    lng: Lng = None,
    radius_km: Annotated[int, Query(ge=1, le=100)] = 10,
    role: Literal["batsman", "bowler", "all_rounder", "wicketkeeper"] | None = None,
    min_rating: Annotated[float | None, Query(ge=0, le=4000)] = None,
    available: bool = False,
    q: Name = None,
    sort: Literal["distance", "rating"] = "distance",
) -> Envelope[list[NearbyPlayerOut]]:
    return ok(await svc.nearby_players(user, _at(lat, lng), radius_km, role, min_rating, available, q, sort))


@router.get(
    "/teams/{team_id}/dashboard",
    response_model=Envelope[TeamDashboardOut],
    tags=["Teams"],
    summary="Team leadership dashboard",
)
async def team_dashboard(team_id: str, user: UserDep, svc: Lb) -> Envelope[TeamDashboardOut]:
    return ok(await svc.dashboard(user, _oid(team_id, "team")))


@router.get(
    "/teams/{team_id}/head-to-head/{other_id}",
    response_model=Envelope[HeadToHeadOut],
    tags=["Teams"],
    summary="Head-to-head record",
)
async def head_to_head(team_id: str, other_id: str, user: UserDep, svc: Lb) -> Envelope[HeadToHeadOut]:
    return ok(await svc.head_to_head(user, _oid(team_id, "team"), _oid(other_id, "team")))


@router.get(
    "/teams/compare", response_model=Envelope[TeamCompareOut], tags=["Leaderboards"], summary="Compare two teams"
)
async def compare_teams(user: UserDep, svc: Lb, a: str, b: str) -> Envelope[TeamCompareOut]:
    ta, tb = _oid(a, "team"), _oid(b, "team")
    return ok(
        TeamCompareOut(
            a=await svc.team_record(ta),
            b=await svc.team_record(tb),
            head_to_head=await svc.head_to_head(user, ta, tb),
        )
    )


# ------------------------------------------------------------------ challenges
@router.post(
    "/challenges",
    status_code=201,
    response_model=Envelope[ChallengeOut],
    tags=["Challenges"],
    summary="Challenge a team",
)
async def create_challenge(data: ChallengeIn, user: MatchmakerDep, svc: Ch) -> Envelope[ChallengeOut]:
    return ok(await svc.create(user, data))


@router.get(
    "/challenges", response_model=Envelope[list[ChallengeOut]], tags=["Challenges"], summary="My teams' challenges"
)
async def list_challenges(
    user: UserDep,
    svc: Ch,
    box: Literal["all", "incoming", "outgoing"] = "all",
    status: Annotated[str | None, Query(max_length=20)] = None,
    team_id: str | None = None,
) -> Envelope[list[ChallengeOut]]:
    tid = parse_object_id(team_id, field="team") if team_id else None
    return ok(await svc.list(user, box, status, tid))


@router.get(
    "/challenges/{challenge_id}",
    response_model=Envelope[ChallengeOut],
    tags=["Challenges"],
    summary="Challenge details",
)
async def get_challenge(challenge_id: str, user: UserDep, svc: Ch) -> Envelope[ChallengeOut]:
    return ok(await svc.get(user, _oid(challenge_id, "challenge")))


@router.post(
    "/challenges/{challenge_id}/send",
    response_model=Envelope[ChallengeOut],
    tags=["Challenges"],
    summary="Send a draft",
)
async def send_challenge(challenge_id: str, user: MatchmakerDep, svc: Ch) -> Envelope[ChallengeOut]:
    return ok(await svc.send(user, _oid(challenge_id, "challenge")))


@router.post(
    "/challenges/{challenge_id}/accept",
    response_model=Envelope[ChallengeOut],
    tags=["Challenges"],
    summary="Accept the proposal",
)
async def accept_challenge(challenge_id: str, user: MatchmakerDep, svc: Ch) -> Envelope[ChallengeOut]:
    return ok(await svc.accept(user, _oid(challenge_id, "challenge")))


@router.post(
    "/challenges/{challenge_id}/counter-propose",
    response_model=Envelope[ChallengeOut],
    tags=["Challenges"],
    summary="Propose different date, venue, format or conditions",
)
async def counter_challenge(
    challenge_id: str, data: CounterProposalIn, user: MatchmakerDep, svc: Ch
) -> Envelope[ChallengeOut]:
    return ok(await svc.counter(user, _oid(challenge_id, "challenge"), data.proposal, data.message))


@router.post(
    "/challenges/{challenge_id}/reject", response_model=Envelope[ChallengeOut], tags=["Challenges"], summary="Decline"
)
async def reject_challenge(
    challenge_id: str, user: MatchmakerDep, svc: Ch, data: ChallengeReasonIn | None = None
) -> Envelope[ChallengeOut]:
    return ok(await svc.reject(user, _oid(challenge_id, "challenge"), data.message if data else None))


@router.post(
    "/challenges/{challenge_id}/confirm",
    response_model=Envelope[ChallengeOut],
    tags=["Challenges"],
    summary="Confirm the accepted schedule (creates the match)",
)
async def confirm_challenge(challenge_id: str, user: MatchmakerDep, svc: Ch) -> Envelope[ChallengeOut]:
    return ok(await svc.confirm(user, _oid(challenge_id, "challenge")))


@router.post(
    "/challenges/{challenge_id}/cancel", response_model=Envelope[ChallengeOut], tags=["Challenges"], summary="Cancel"
)
async def cancel_challenge(
    challenge_id: str, user: MatchmakerDep, svc: Ch, data: ChallengeReasonIn | None = None
) -> Envelope[ChallengeOut]:
    return ok(await svc.cancel(user, _oid(challenge_id, "challenge"), data.message if data else None))


# ------------------------------------------------------------------ fixtures
@router.get("/fixtures", response_model=Envelope[list[FixtureOut]], tags=["Fixtures"], summary="My teams' fixtures")
async def my_fixtures(
    user: UserDep, svc: Fx, when: Literal["upcoming", "awaiting", "past"] = "upcoming"
) -> Envelope[list[FixtureOut]]:
    return ok(await svc.mine(user, when))


@router.get("/fixtures/{fixture_id}", response_model=Envelope[FixtureOut], tags=["Fixtures"], summary="Match centre")
async def get_fixture(fixture_id: str, user: UserDep, svc: Fx) -> Envelope[FixtureOut]:
    return ok(await svc.get(user, _oid(fixture_id, "match")))


@router.post(
    "/fixtures/{fixture_id}/result",
    response_model=Envelope[FixtureOut],
    tags=["Fixtures"],
    summary="Submit the result and scorecard (captain/vice-captain of either team)",
)
async def submit_result(fixture_id: str, data: ResultIn, user: MatchmakerDep, svc: Fx) -> Envelope[FixtureOut]:
    return ok(await svc.submit_result(user, _oid(fixture_id, "match"), data))


@router.post(
    "/fixtures/{fixture_id}/verify",
    response_model=Envelope[FixtureOut],
    tags=["Fixtures"],
    summary="Confirm the other team's result (makes it official and updates ratings)",
)
async def verify_result(fixture_id: str, user: MatchmakerDep, svc: Fx) -> Envelope[FixtureOut]:
    return ok(await svc.verify(user, _oid(fixture_id, "match")))


@router.post(
    "/fixtures/{fixture_id}/dispute",
    response_model=Envelope[FixtureOut],
    tags=["Fixtures"],
    summary="Dispute the other team's result (held; ratings unchanged)",
)
async def dispute_result(fixture_id: str, data: DisputeIn, user: MatchmakerDep, svc: Fx) -> Envelope[FixtureOut]:
    return ok(await svc.dispute(user, _oid(fixture_id, "match"), data.reason))


@router.post(
    "/fixtures/{fixture_id}/cancel", response_model=Envelope[FixtureOut], tags=["Fixtures"], summary="Cancel a match"
)
async def cancel_fixture(fixture_id: str, user: MatchmakerDep, svc: Fx) -> Envelope[FixtureOut]:
    return ok(await svc.cancel(user, _oid(fixture_id, "match")))


@router.get(
    "/admin/fixtures/disputed", response_model=Envelope[list[FixtureOut]], tags=["Admin"], summary="Disputed results"
)
async def disputed_fixtures(admin: AdminDep, svc: Fx) -> Envelope[list[FixtureOut]]:
    return ok(await svc.disputed(admin))


@router.post(
    "/admin/fixtures/{fixture_id}/resolve",
    response_model=Envelope[FixtureOut],
    tags=["Admin"],
    summary="Resolve a disputed result (confirm, or void and recompute ratings)",
)
async def resolve_fixture(fixture_id: str, data: ResolveIn, admin: AdminDep, svc: Fx) -> Envelope[FixtureOut]:
    return ok(await svc.resolve(admin, _oid(fixture_id, "match"), data.action, data.reason))


@router.get(
    "/home", response_model=Envelope[HomeOut], tags=["Home"], summary="PlayR home: rating, rank, fixtures, challenges"
)
async def home(user: UserDep, c: ContainerDep, lat: Lat = None, lng: Lng = None) -> Envelope[HomeOut]:
    return ok(await build_home(c, user, _at(lat, lng)))
