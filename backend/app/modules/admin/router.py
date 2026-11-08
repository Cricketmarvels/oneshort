"""Admin moderation endpoints (role: admin)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.dependencies import AdminDep, ContainerDep
from app.common.enums import ReportStatus
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
from app.modules.ratings.service import ModerateRatingIn, RatingOut, RatingService
from app.modules.reports.service import AdminReportOut, ReportService, ReportUpdateIn

router = APIRouter(prefix="/admin", tags=["Admin moderation"], responses=ERROR_RESPONSES)
Page = Annotated[PageParams, Depends(page_params)]


class AdminStats(BaseModel):
    users: int
    active_matches: int
    open_reports: int
    investigating_reports: int
    suspended_users: int
    restricted_users: int
    ai_triage_enabled: bool


@router.get("/stats", response_model=Envelope[AdminStats], summary="Moderation overview")
async def stats(_: AdminDep, c: ContainerDep) -> Envelope[AdminStats]:
    m = c.mongo
    return ok(
        AdminStats(
            users=await m["users"].count_documents({"account_status": {"$ne": "deleted"}}),
            active_matches=await m["matches"].count_documents(
                {"match_status": {"$nin": ["completed", "cancelled", "draft"]}}
            ),
            open_reports=await m["reports"].count_documents({"status": "open"}),
            investigating_reports=await m["reports"].count_documents({"status": "investigating"}),
            suspended_users=await m["users"].count_documents({"account_status": "suspended"}),
            restricted_users=await m["users"].count_documents({"account_status": "restricted"}),
            ai_triage_enabled=c.ai.enabled,
        )
    )


@router.get("/reports", response_model=PagedEnvelope[AdminReportOut], summary="Misconduct reports")
async def list_reports(
    _: AdminDep, c: ContainerDep, page: Page, status: ReportStatus | None = None
) -> PagedEnvelope[AdminReportOut]:
    items, total = await ReportService(c).admin_list(status, page)
    return paged(items, page, total)


@router.put(
    "/reports/{report_id}",
    response_model=Envelope[AdminReportOut],
    summary="Investigate: add notes, change status, take moderation action",
)
async def update_report(
    report_id: str, data: ReportUpdateIn, admin: AdminDep, c: ContainerDep
) -> Envelope[AdminReportOut]:
    return ok(
        await ReportService(c).admin_update(admin, parse_object_id(report_id, field="report", not_found=True), data)
    )


@router.put("/ratings/{rating_id}", response_model=Envelope[RatingOut], summary="Hide or restore a rating")
async def moderate_rating(
    rating_id: str, data: ModerateRatingIn, admin: AdminDep, c: ContainerDep
) -> Envelope[RatingOut]:
    return ok(await RatingService(c).moderate(admin, parse_object_id(rating_id, field="rating", not_found=True), data))


@router.get(
    "/audit/{entity_type}/{entity_id}",
    response_model=Envelope[list[dict[str, Any]]],
    summary="Audit trail for an entity",
)
async def audit_trail(entity_type: str, entity_id: str, _: AdminDep, c: ContainerDep) -> Envelope[list[dict[str, Any]]]:
    rows = await c.audit.for_entity(entity_type[:40], parse_object_id(entity_id, field="entity"))
    return ok([{k: (str(v) if k.endswith("_id") or k == "_id" else v) for k, v in r.items()} for r in rows])
