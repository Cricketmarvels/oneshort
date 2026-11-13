"""Image fields may only point at files OneShort stored (no arbitrary external URLs / tracking pixels)."""

from typing import Annotated

from pydantic import AfterValidator

from app.core.config import get_settings
from app.infrastructure.integrations.storage import normalize_media_key


def _own(v: str) -> str:
    """Accepts the upload's key or the signed link the API returned for it; stores the private key."""
    key = normalize_media_key(v, get_settings())
    if key is None:
        raise ValueError("Upload the image through OneShort first (POST /uploads/images) and use the returned URL")
    return key


OwnMediaUrl = Annotated[str, AfterValidator(_own)]
