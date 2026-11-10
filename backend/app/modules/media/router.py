"""Serves uploaded images through signed, expiring links only (see app/common/media_sign.py).

There is no directory listing and no unsigned route: a request without a valid signature for that exact
file gets the same 404 as a file that does not exist. Files live outside any static mount.
"""

import asyncio
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Query, Request
from fastapi.responses import FileResponse

from app.common.media_sign import media_signer
from app.common.response import ERROR_RESPONSES
from app.core.exceptions import NotFound

router = APIRouter(prefix="/media", tags=["Media"], responses=ERROR_RESPONSES)
_TYPES = {"jpg": "image/jpeg", "png": "image/png", "webp": "image/webp"}


def _locate(upload_dir: str, folder: str, name: str) -> Path | None:
    """Resolve inside the upload root only (the signature already restricts folder/name to safe characters)."""
    root = Path(upload_dir).resolve()
    path = (root / folder / name).resolve()
    return path if root in path.parents and path.is_file() else None


@router.get("/{folder}/{name}", summary="Fetch an uploaded image with a signed link", response_class=FileResponse)
async def media_file(
    folder: str,
    name: str,
    request: Request,
    e: Annotated[int, Query(description="Expiry (unix seconds)")],
    s: Annotated[str, Query(min_length=16, max_length=64, description="Signature")],
) -> FileResponse:
    settings = request.app.state.settings
    if settings.storage_provider != "local" or not media_signer.verify(folder, name, e, s):
        raise NotFound("Media not found")
    path = await asyncio.to_thread(_locate, settings.local_upload_dir, folder, name)
    if path is None:
        raise NotFound("Media not found")
    return FileResponse(
        path,
        media_type=_TYPES.get(name.rsplit(".", 1)[-1], "application/octet-stream"),
        headers={
            "Cache-Control": "private, max-age=86400",
            "X-Content-Type-Options": "nosniff",
            "Content-Disposition": "inline",
            "Cross-Origin-Resource-Policy": "cross-origin",
        },
    )
