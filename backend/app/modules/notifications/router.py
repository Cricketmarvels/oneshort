from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, PageMeta, PageParams, page_params
from app.common.types import parse_object_id
from app.modules.notifications.service import NotificationService

router = APIRouter(prefix="/notifications", tags=["Notifications"], responses=ERROR_RESPONSES)
Page = Annotated[PageParams, Depends(page_params)]


class NotificationOut(BaseModel):
    id: str
    type: str
    title: str
    body: str
    data: dict[str, Any]
    read: bool
    created_at: datetime


class NotificationMeta(PageMeta):
    unread: int


class NotificationList(BaseModel):
    data: list[NotificationOut]
    meta: NotificationMeta


def service(c: ContainerDep) -> NotificationService:
    return c.notifications


Svc = Annotated[NotificationService, Depends(service)]


@router.get("", response_model=NotificationList, summary="My notifications")
async def list_notifications(user: UserDep, svc: Svc, page: Page, unread_only: bool = False) -> NotificationList:
    items, total, unread = await svc.list_for_user(user.id, page, unread_only)
    return NotificationList(
        data=[
            NotificationOut(
                id=str(n["_id"]),
                type=n["type"],
                title=n["title"],
                body=n["body"],
                data=n.get("data") or {},
                read=n.get("read_at") is not None,
                created_at=n["created_at"],
            )
            for n in items
        ],
        meta=NotificationMeta(
            page=page.page,
            page_size=page.page_size,
            total=total,
            has_next=page.skip + len(items) < total,
            unread=unread,
        ),
    )


@router.post("/{notification_id}/read", status_code=204, summary="Mark a notification read")
async def mark_read(notification_id: str, user: UserDep, svc: Svc) -> None:
    await svc.mark_read(user.id, parse_object_id(notification_id, field="notification", not_found=True))


@router.post("/read-all", status_code=204, summary="Mark all notifications read")
async def mark_all(user: UserDep, svc: Svc) -> None:
    await svc.mark_all_read(user.id)
