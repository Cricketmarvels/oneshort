"""Consistent response envelope and pagination."""

from typing import Annotated, Any

from fastapi import Query
from pydantic import BaseModel, Field, SerializerFunctionWrapHandler, model_serializer

from app.common.media_sign import media_signer


class PageMeta(BaseModel):
    page: int
    page_size: int
    total: int
    has_next: bool


class Envelope[T](BaseModel):
    data: T

    @model_serializer(mode="wrap")
    def _sign_media(self, handler: SerializerFunctionWrapHandler) -> Any:
        # Private upload keys never leave the API: every response carries signed, expiring media links instead.
        return media_signer.sign_tree(handler(self))


class PagedEnvelope[T](BaseModel):
    data: list[T]
    meta: PageMeta

    @model_serializer(mode="wrap")
    def _sign_media(self, handler: SerializerFunctionWrapHandler) -> Any:
        return media_signer.sign_tree(handler(self))


class ErrorBody(BaseModel):
    code: str
    message: str
    details: list[dict[str, object]] = Field(default_factory=list)


class ErrorEnvelope(BaseModel):
    error: ErrorBody
    request_id: str | None = None


class PageParams(BaseModel):
    page: int = 1
    page_size: int = 20

    @property
    def skip(self) -> int:
        return (self.page - 1) * self.page_size


def page_params(
    page: Annotated[int, Query(ge=1, le=10_000)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
) -> PageParams:
    return PageParams(page=page, page_size=page_size)


def ok[T](data: T) -> Envelope[T]:
    return Envelope[T](data=data)


def paged[T](items: list[T], params: PageParams, total: int) -> PagedEnvelope[T]:
    return PagedEnvelope[T](
        data=items,
        meta=PageMeta(
            page=params.page,
            page_size=params.page_size,
            total=total,
            has_next=params.skip + len(items) < total,
        ),
    )


ERROR_RESPONSES: dict[int | str, dict[str, object]] = {
    400: {"model": ErrorEnvelope, "description": "Bad request"},
    401: {"model": ErrorEnvelope, "description": "Not authenticated"},
    403: {"model": ErrorEnvelope, "description": "Forbidden / agreement required"},
    404: {"model": ErrorEnvelope, "description": "Not found"},
    409: {"model": ErrorEnvelope, "description": "Conflict"},
    422: {"model": ErrorEnvelope, "description": "Validation or business rule error"},
    429: {"model": ErrorEnvelope, "description": "Rate limited"},
}
