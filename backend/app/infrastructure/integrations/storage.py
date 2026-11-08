"""Image storage providers."""

import io
import re
import secrets
from pathlib import Path
from typing import Protocol

from PIL import Image, ImageOps, UnidentifiedImageError

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


# Longest edge per purpose (px). Re-encoding also strips EXIF/GPS metadata and neutralises polyglot files.
MAX_EDGE = {"profile": 800, "team_logo": 600, "team": 600, "team_cover": 1800, "match": 1800, "evidence": 2000}
Image.MAX_IMAGE_PIXELS = 40_000_000  # refuse decompression bombs


def process_image(content: bytes, ext: str, purpose: str) -> tuple[bytes, str]:
    """Decode, auto-rotate, downscale and re-encode an already type-checked image. Returns (bytes, ext)."""
    try:
        with Image.open(io.BytesIO(content)) as src:
            src.load()
            img: Image.Image = ImageOps.exif_transpose(src)
            edge = MAX_EDGE.get(purpose, 1600)
            img.thumbnail((edge, edge), Image.Resampling.LANCZOS)
            out = io.BytesIO()
            if ext == "png" and img.mode in ("RGBA", "LA", "P"):
                img.save(out, "PNG", optimize=True)  # keep transparency (logos)
                return out.getvalue(), "png"
            img.convert("RGB").save(out, "JPEG", quality=82, optimize=True, progressive=True)
            return out.getvalue(), "jpg"
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValidationFailed("That image couldn't be read", code="UNSUPPORTED_MEDIA") from exc


_OWN_MEDIA = re.compile(r"^/uploads/[A-Za-z0-9_-]{1,40}/[a-f0-9]{32}\.(?:jpg|png|webp)$")


def is_own_media(url: str | None, settings: Settings) -> bool:
    """True only for files PlayR stored itself (relative /uploads/… path, or legacy absolute URL on our base)."""
    if not url:
        return False
    base = settings.public_base_url.rstrip("/")
    path = url[len(base) :] if url.startswith(base + "/uploads/") else url
    return bool(_OWN_MEDIA.match(path))


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
        # Relative path: works behind any host/tunnel; clients resolve it against the API origin.
        return f"/uploads/{safe_folder}/{name}"


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
