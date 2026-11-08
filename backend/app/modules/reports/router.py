from typing import Annotated

from fastapi import APIRouter, Depends

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.modules.reports.service import ReportIn, ReportOut, ReportService

router = APIRouter(prefix="/reports", tags=["Reports"], responses=ERROR_RESPONSES)


def service(c: ContainerDep) -> ReportService:
    return ReportService(c)


Svc = Annotated[ReportService, Depends(service)]


@router.post("", status_code=201, response_model=Envelope[ReportOut], summary="Report misconduct")
async def create_report(data: ReportIn, user: UserDep, svc: Svc) -> Envelope[ReportOut]:
    return ok(await svc.create(user, data))


@router.get("/me", response_model=Envelope[list[ReportOut]], summary="Reports I have filed")
async def my_reports(user: UserDep, svc: Svc) -> Envelope[list[ReportOut]]:
    return ok(await svc.mine(user))
