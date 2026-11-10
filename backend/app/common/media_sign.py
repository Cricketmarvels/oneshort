"""Signed, expiring links for uploaded media.

Uploaded files are never served from a public folder. The database keeps a private *key*
(``/uploads/<folder>/<32 hex>.<ext>``); every API response rewrites keys into
``<api_prefix>/media/<folder>/<name>?e=<expiry>&s=<signature>`` on the way out, and the media
endpoint serves a file only when the signature is valid and unexpired. Signatures are an HMAC of the
file key and expiry with a key derived from the app secret, so a link cannot be forged, extended or
reused for a different file. Guessing a filename is not enough: the raw key has no route.
"""

import hashlib
import hmac
import re
import time
from typing import Any

_KEY_RE = re.compile(r"^/uploads/(?P<folder>[A-Za-z0-9_-]{1,40})/(?P<name>[a-f0-9]{32}\.(?:jpg|png|webp))$")
_SIG_LEN = 32  # hex chars of the HMAC-SHA256 digest (128 bits)


class MediaSigner:
    def __init__(self) -> None:
        self._key: bytes | None = None
        self.api_prefix = "/api/v1"
        self.ttl = 48 * 3600

    def configure(self, secret: str, api_prefix: str, ttl_seconds: int) -> None:
        self._key = hashlib.sha256(b"gofindr-media:" + secret.encode()).digest()
        self.api_prefix = api_prefix.rstrip("/")
        self.ttl = ttl_seconds

    @property
    def configured(self) -> bool:
        return self._key is not None

    def _sig(self, folder: str, name: str, exp: int) -> str:
        assert self._key is not None
        return hmac.new(self._key, f"{folder}/{name}:{exp}".encode(), hashlib.sha256).hexdigest()[:_SIG_LEN]

    def sign_key(self, key: str, now: float | None = None) -> str:
        """Private key → signed path. Anything that is not a key is returned unchanged."""
        m = _KEY_RE.match(key)
        if not m or self._key is None:
            return key
        exp = int((now or time.time()) + self.ttl)
        folder, name = m["folder"], m["name"]
        return f"{self.api_prefix}/media/{folder}/{name}?e={exp}&s={self._sig(folder, name, exp)}"

    def verify(self, folder: str, name: str, exp: int, sig: str, now: float | None = None) -> bool:
        if self._key is None or exp < (now or time.time()):
            return False
        if not _KEY_RE.match(f"/uploads/{folder}/{name}"):
            return False
        return hmac.compare_digest(self._sig(folder, name, exp), sig)

    def signed_to_key(self, url: str) -> str | None:
        """Signed path (relative or absolute) → private key, or None if it is not one of ours."""
        path = re.sub(r"^https?://[^/]+", "", url).split("?", 1)[0]
        prefix = f"{self.api_prefix}/media/"
        if not path.startswith(prefix):
            return None
        key = "/uploads/" + path[len(prefix) :]
        return key if _KEY_RE.match(key) else None

    def sign_tree(self, value: Any) -> Any:
        """Rewrite every media key inside a serialised response (dicts/lists/strings) into a signed link."""
        if not self._key:
            return value
        now = time.time()

        def walk(v: Any) -> Any:
            if isinstance(v, str):
                return self.sign_key(v, now) if v.startswith("/uploads/") else v
            if isinstance(v, dict):
                return {k: walk(x) for k, x in v.items()}
            if isinstance(v, list):
                return [walk(x) for x in v]
            return v

        return walk(value)


media_signer = MediaSigner()
