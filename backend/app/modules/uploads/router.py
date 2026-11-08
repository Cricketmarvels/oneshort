from typing import Annotated, Literal

from fastapi import APIRouter, File, Form, UploadFile
from pydantic import BaseModel

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.infrastructure.integrations.storage import process_image, validate_image

router = APIRouter(prefix="/uploads", tags=["Uploads"], responses=ERROR_RESPONSES)


class UploadOut(BaseModel):
    url: str


@router.post(
    "/images", status_code=201, response_model=Envelope[UploadOut], summary="Upload an image (JPEG/PNG/WebP, max 5 MB)"
)
async def upload_image(
    user: UserDep,
    c: ContainerDep,
    file: Annotated[UploadFile, File()],
    purpose: Annotated[Literal["profile", "team", "team_logo", "team_cover", "match", "evidence"], Form()] = "profile",
) -> Envelope[UploadOut]:
    content = await file.read(c.settings.max_upload_bytes + 1)
    ext = validate_image(content, file.content_type or "", c.settings.max_upload_bytes)
    content, ext = process_image(content, ext, purpose)  # resize, strip metadata, re-encode
    url = await c.storage.save_image(content, ext, purpose)
    await c.audit.log(
        actor_id=user.id,
        action="upload.image",
        entity_type="user",
        entity_id=user.id,
        new_value={"purpose": purpose},
        request_id=user.request_id,
    )
    return ok(UploadOut(url=url))
