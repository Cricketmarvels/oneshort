"""Home dashboard: one call that powers the home screen sections (FR-HOME-2)."""

from datetime import timedelta
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.dependencies import ContainerDep, UserDep
from app.common.enums import InvitationDirection, InvitationStatus
from app.common.response import ERROR_RESPONSES, Envelope, PageParams, ok
from app.common.types import utcnow
from app.modules.availability.schemas import AvailabilityOut
from app.modules.availability.service import AvailabilityService
from app.modules.invitations.schemas import InvitationOut
from app.modules.invitations.service import InvitationService
from app.modules.matches.schemas import MatchOut
from app.modules.matches.service import MatchService
from app.modules.notifications.router import NotificationOut
from app.modules.payments.service import PaymentService
from app.modules.settlements.schemas import PaymentRecordOut
from app.modules.teams.schemas import TeamOut
from app.modules.teams.service import TeamService

router = APIRouter(prefix="/dashboard", tags=["Dashboard"], responses=ERROR_RESPONSES)


class DashboardOut(BaseModel):
    greeting_name: str
    upcoming_matches: list[MatchOut]
    my_teams: list[TeamOut]
    availability_next_7_days: list[AvailabilityOut]
    pending_invitations: list[InvitationOut]
    pending_invitations_count: int
    pending_join_requests: list[InvitationOut]
    pending_join_requests_count: int
    pending_payments: list[PaymentRecordOut]
    outstanding_paise: int
    recent_activity: list[NotificationOut]
    unread_notifications: int


@router.get("", response_model=Envelope[DashboardOut], summary="Home dashboard")
async def dashboard(user: UserDep, c: ContainerDep) -> Envelope[DashboardOut]:
    p3 = PageParams(page=1, page_size=3)
    p5 = PageParams(page=1, page_size=5)
    upcoming, _ = await MatchService(c).list_matches(user, "all", "upcoming", None, None, p5)
    teams_mine, _ = await TeamService(c).list_teams(user, "member", None, p5)
    now = utcnow()
    avail = await AvailabilityService(c).list_mine(user, now, now + timedelta(days=7), False)
    inv_svc = InvitationService(c)
    invites, inv_total = await inv_svc.list_mine(user, "received", InvitationStatus.PENDING, p3)
    requests, req_total = await inv_svc.list_for_captain(
        user, InvitationDirection.REQUEST, InvitationStatus.PENDING, p3
    )
    pay = await PaymentService(c).player_dashboard(user, None)
    notes, _, unread = await c.notifications.list_for_user(user.id, p5, False)
    pending_pay = [r for r in pay.records if r.status in ("pending", "disputed")][:3]
    recent: list[dict[str, Any]] = notes
    return ok(
        DashboardOut(
            greeting_name=user.full_name.split(" ")[0],
            upcoming_matches=upcoming,
            my_teams=teams_mine,
            availability_next_7_days=avail[:7],
            pending_invitations=invites,
            pending_invitations_count=inv_total,
            pending_join_requests=requests,
            pending_join_requests_count=req_total,
            pending_payments=pending_pay,
            outstanding_paise=pay.outstanding_paise,
            recent_activity=[
                NotificationOut(
                    id=str(n["_id"]),
                    type=n["type"],
                    title=n["title"],
                    body=n["body"],
                    data=n.get("data") or {},
                    read=n.get("read_at") is not None,
                    created_at=n["created_at"],
                )
                for n in recent
            ],
            unread_notifications=unread,
        )
    )
