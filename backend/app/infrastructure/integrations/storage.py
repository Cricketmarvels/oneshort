"""Image storage providers."""

import secrets
from pathlib import Path
from typing import Protocol

from app.core.config import Settings
from app.core.exceptions import ValidationFailed

_SIGNATURES: dict[str, tuple[bytes, ...]] = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/webp": (b"RIFF",),
}
_EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}


def validate_image(content: bytes, content_type: str, max_bytes: int) -> str:
    if content_type not in _SIGNATURES:
        raise ValidationFailed("Only JPEG, PNG or WebP images are allowed", code="UNSUPPORTED_MEDIA")
    if len(content) > max_bytes:
        raise ValidationFailed("Image is too large (max 5 MB)", code="FILE_TOO_LARGE")
    if not any(content.startswith(sig) for sig in _SIGNATURES[content_type]):
        raise ValidationFailed("File content does not match its type", code="UNSUPPORTED_MEDIA")
    if content_type == "image/webp" and content[8:12] != b"WEBP":
        raise ValidationFailed("File content does not match its type", code="UNSUPPORTED_MEDIA")
    return _EXT[content_type]


class StorageProvider(Protocol):
    async def save_image(self, content: bytes, ext: str, folder: str) -> str: ...


class LocalStorage:
    """Stores files on local disk and serves them from ``/uploads`` (development)."""

    def __init__(self, root: str, public_base_url: str) -> None:
        self.root = Path(root)
        self.public_base_url = public_base_url.rstrip("/")

    async def save_image(self, content: bytes, ext: str, folder: str) -> str:
        safe_folder = "".join(c for c in folder if c.isalnum() or c in "-_") or "misc"
        target_dir = self.root / safe_folder
        target_dir.mkdir(parents=True, exist_ok=True)
        name = f"{secrets.token_hex(16)}.{ext}"
        (target_dir / name).write_bytes(content)
        return f"{self.public_base_url}/uploads/{safe_folder}/{name}"


class CloudinaryStorage:
    """UNCONFIGURED adapter: set STORAGE_PROVIDER=cloudinary and CLOUDINARY_URL, then implement
    the signed upload (POST https://api.cloudinary.com/v1_1/<cloud>/image/upload) and test."""

    def __init__(self, url: str) -> None:
        self.url = url

    async def save_image(self, content: bytes, ext: str, folder: str) -> str:
        raise NotImplementedError("Cloudinary storage not configured")


def build_storage(settings: Settings) -> StorageProvider:
    if settings.storage_provider == "cloudinary" and settings.cloudinary_url:
        return CloudinaryStorage(settings.cloudinary_url)
    return LocalStorage(settings.local_upload_dir, settings.public_base_url)
