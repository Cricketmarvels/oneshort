"""Image fields may only point at files PlayR stored (no arbitrary external URLs / tracking pixels)."""

from typing import Annotated

from pydantic import AfterValidator

from app.core.config import get_settings
from app.infrastructure.integrations.storage import is_own_media


def _own(v: str) -> str:
    if not is_own_media(v, get_settings()):
        raise ValueError("Upload the image through PlayR first (POST /uploads/images) and use the returned URL")
    return v


OwnMediaUrl = Annotated[str, AfterValidator(_own)]
