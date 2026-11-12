"""Split a Fee: expenses, settlements and manual payment tracking. No gateway endpoints (MVP)."""

from typing import Annotated

from bson import ObjectId
from fastapi import APIRouter, Depends, Query

from app.api.dependencies import ContainerDep, MatchmakerDep, UserDep
from app.common.enums import PaymentStatus
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import parse_object_id
from app.modules.payments.service import PaymentService
from app.modules.settlements.fee_sides import FeeSideOut, FeeSideService, SquadIn
from app.modules.settlements.schemas import (
    CaptainDashboardOut,
    CorrectIn,
    DiscussionIn,
    DiscussionOut,
    DisputeIn,
    ExpenseIn,
    ExpenseOut,
    MarkPaidIn,
    PaymentRecordOut,
    PlayerDashboardOut,
    RemarksIn,
    SettlementDraftIn,
    SettlementOut,
    ShareOut,
    SpendOut,
)
from app.modules.settlements.service import SettlementService

router = APIRouter(tags=["Split a Fee"], responses=ERROR_RESPONSES)


def settlements(c: ContainerDep) -> SettlementService:
    return SettlementService(c)


def payments(c: ContainerDep) -> PaymentService:
    return PaymentService(c)


St = Annotated[SettlementService, Depends(settlements)]
Pay = Annotated[PaymentService, Depends(payments)]


def _id(v: str, field: str) -> ObjectId:
    return parse_object_id(v, field=field, not_found=True)


# ------------------------------------------------------------------ expenses
@router.post(
    "/matches/{match_id}/expenses", status_code=201, response_model=Envelope[ExpenseOut], summary="Add a match expense"
)
async def add_expense(match_id: str, data: ExpenseIn, user: MatchmakerDep, svc: St) -> Envelope[ExpenseOut]:
    return ok(await svc.add_expense(user, _id(match_id, "match"), data))


@router.get("/matches/{match_id}/expenses", response_model=Envelope[list[ExpenseOut]], summary="Match expenses")
async def list_expenses(match_id: str, user: UserDep, svc: St) -> Envelope[list[ExpenseOut]]:
    return ok(await svc.list_expenses(user, _id(match_id, "match")))


@router.delete("/matches/{match_id}/expenses/{expense_id}", status_code=204, summary="Remove an expense")
async def delete_expense(match_id: str, expense_id: str, user: MatchmakerDep, svc: St) -> None:
    await svc.delete_expense(user, _id(match_id, "match"), _id(expense_id, "expense"))


# --------------------------------------------------------------- settlements
@router.post(
    "/matches/{match_id}/settlements",
    status_code=201,
    response_model=Envelope[SettlementOut],
    summary="Create or refresh the draft settlement (captain reviews before publishing)",
)
async def create_settlement(
    match_id: str, data: SettlementDraftIn, user: MatchmakerDep, svc: St
) -> Envelope[SettlementOut]:
    return ok(await svc.create_draft(user, _id(match_id, "match"), data))


@router.get(
    "/matches/{match_id}/settlements",
    response_model=Envelope[list[SettlementOut]],
    summary="Settlement versions for a match",
)
async def list_settlements(match_id: str, user: UserDep, svc: St) -> Envelope[list[SettlementOut]]:
    return ok(await svc.list_for_match(user, _id(match_id, "match")))


@router.post(
    "/settlements/{settlement_id}/publish",
    response_model=Envelope[SettlementOut],
    summary="Publish a draft (immutable afterwards; revisions create a new version)",
)
async def publish(settlement_id: str, user: MatchmakerDep, svc: St) -> Envelope[SettlementOut]:
    return ok(await svc.publish(user, _id(settlement_id, "settlement")))


@router.get(
    "/settlements/me", response_model=Envelope[PlayerDashboardOut], summary="Player payment dashboard across all teams"
)
async def my_payments(user: UserDep, svc: Pay, status: PaymentStatus | None = None) -> Envelope[PlayerDashboardOut]:
    return ok(await svc.player_dashboard(user, status))


@router.get(
    "/settlements/me/spend",
    response_model=Envelope[SpendOut],
    responses=ERROR_RESPONSES,
    summary="My match-fee spend by team and month (what I owe, what I've paid)",
)
async def my_spend(
    user: UserDep,
    svc: Pay,
    year: Annotated[int | None, Query(ge=2020, le=2100)] = None,
    month: Annotated[int | None, Query(ge=1, le=12)] = None,
) -> Envelope[SpendOut]:
    return ok(await svc.spend(user, year, month))


@router.get(
    "/settlements/{settlement_id}/payments",
    response_model=Envelope[CaptainDashboardOut],
    summary="Captain payment dashboard (participants see the same transparency view)",
)
async def payments_dashboard(settlement_id: str, user: UserDep, svc: Pay) -> Envelope[CaptainDashboardOut]:
    return ok(await svc.captain_dashboard(user, _id(settlement_id, "settlement")))


@router.post(
    "/settlements/{settlement_id}/payments/{player_id}/mark-paid",
    response_model=Envelope[PaymentRecordOut],
    summary="Mark a player's contribution as paid (manually confirmed by captain)",
)
async def mark_paid(
    settlement_id: str, player_id: str, data: MarkPaidIn, user: MatchmakerDep, svc: Pay
) -> Envelope[PaymentRecordOut]:
    return ok(
        await svc.mark(
            user,
            _id(settlement_id, "settlement"),
            _id(player_id, "player"),
            PaymentStatus.PAID,
            data.remarks,
            data.method.value,
        )
    )


@router.post(
    "/settlements/{settlement_id}/payments/{player_id}/mark-exempted",
    response_model=Envelope[PaymentRecordOut],
    summary="Exempt a player from paying",
)
async def mark_exempted(
    settlement_id: str, player_id: str, data: RemarksIn, user: MatchmakerDep, svc: Pay
) -> Envelope[PaymentRecordOut]:
    return ok(
        await svc.mark(
            user, _id(settlement_id, "settlement"), _id(player_id, "player"), PaymentStatus.EXEMPTED, data.remarks
        )
    )


@router.post(
    "/settlements/{settlement_id}/payments/{player_id}/correct",
    response_model=Envelope[PaymentRecordOut],
    summary="Correct an incorrectly recorded status (reason required, audited)",
)
async def correct(
    settlement_id: str, player_id: str, data: CorrectIn, user: MatchmakerDep, svc: Pay
) -> Envelope[PaymentRecordOut]:
    return ok(
        await svc.correct(user, _id(settlement_id, "settlement"), _id(player_id, "player"), data.status, data.reason)
    )


@router.post(
    "/settlements/{settlement_id}/payments/{player_id}/dispute",
    response_model=Envelope[PaymentRecordOut],
    summary="Raise a payment dispute (player, own record)",
)
async def dispute(
    settlement_id: str, player_id: str, data: DisputeIn, user: UserDep, svc: Pay
) -> Envelope[PaymentRecordOut]:
    return ok(await svc.dispute(user, _id(settlement_id, "settlement"), _id(player_id, "player"), data.reason))


@router.post(
    "/settlements/{settlement_id}/payments/{player_id}/remind",
    response_model=Envelope[ShareOut],
    summary="Send an in-app reminder and get a WhatsApp reminder link",
)
async def remind(settlement_id: str, player_id: str, user: MatchmakerDep, svc: Pay) -> Envelope[ShareOut]:
    return ok(await svc.remind(user, _id(settlement_id, "settlement"), _id(player_id, "player")))


@router.get(
    "/settlements/{settlement_id}/share",
    response_model=Envelope[ShareOut],
    summary="Settlement summary text + WhatsApp share link",
)
async def share(settlement_id: str, user: UserDep, svc: Pay) -> Envelope[ShareOut]:
    return ok(await svc.share_summary(user, _id(settlement_id, "settlement")))


@router.get(
    "/payments/{record_id}/discussion", response_model=Envelope[list[DiscussionOut]], summary="Fee discussion thread"
)
async def get_discussion(record_id: str, user: UserDep, svc: Pay) -> Envelope[list[DiscussionOut]]:
    return ok(await svc.list_discussion(user, _id(record_id, "payment")))


@router.post(
    "/payments/{record_id}/discussion",
    status_code=201,
    response_model=Envelope[DiscussionOut],
    summary="Post to the fee discussion thread",
)
async def post_discussion(record_id: str, data: DiscussionIn, user: UserDep, svc: Pay) -> Envelope[DiscussionOut]:
    return ok(await svc.add_discussion(user, _id(record_id, "payment"), data.message))


# ------------------------------------------------------------------ team-vs-team match fees
@router.post(
    "/fixtures/{fixture_id}/fees/{team_id}",
    response_model=Envelope[FeeSideOut],
    summary="Open your team's match-fee ledger for a team-vs-team match (creates it for captains)",
    description="The returned `id` is used as `match_id` with the expense and settlement endpoints above.",
)
async def open_fee_side(fixture_id: str, team_id: str, user: UserDep, c: ContainerDep) -> Envelope[FeeSideOut]:
    return ok(await FeeSideService(c).open(user, _id(fixture_id, "match"), _id(team_id, "team")))


@router.put(
    "/fees/{ledger_id}/squad",
    response_model=Envelope[FeeSideOut],
    summary="Choose who shares the fee (captain/vice-captain)",
)
async def set_fee_squad(ledger_id: str, data: SquadIn, user: MatchmakerDep, c: ContainerDep) -> Envelope[FeeSideOut]:
    return ok(await FeeSideService(c).set_squad(user, _id(ledger_id, "ledger"), data))


@router.get("/fees/{ledger_id}", response_model=Envelope[FeeSideOut], summary="A team-vs-team fee ledger")
async def get_fee_side(ledger_id: str, user: UserDep, c: ContainerDep) -> Envelope[FeeSideOut]:
    return ok(await FeeSideService(c).get(user, _id(ledger_id, "ledger")))
