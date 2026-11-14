"""Expand CricHeroes share links (chshare.link) to the canonical profile URL.

Only chshare.link is ever fetched, with a short timeout and a small read cap; redirects are followed only onto
chshare.link or cricheroes.com. Whatever comes back still has to pass the strict profile-link rules.
"""

from collections.abc import Awaitable, Callable

import httpx

from app.core.exceptions import ValidationFailed
from app.core.logging import get_logger
from app.modules.cricheroes.urls import embedded_profile_url, normalize_profile_url, share_link_kind

log = get_logger("cricheroes.shortlinks")
TIMEOUT = httpx.Timeout(6.0)
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) OneShort/1.0"
_ALLOWED = {
    "chshare.link",
    "www.chshare.link",
    "cricheroes.com",
    "www.cricheroes.com",
    "cricheroes.in",
    "www.cricheroes.in",
}
_MAX_BYTES = 256_000


async def _fetch(url: str) -> tuple[str, str]:
    """(final url, body) following at most 3 redirects, each onto an allowed host."""
    async with httpx.AsyncClient(timeout=TIMEOUT, headers={"User-Agent": UA}, follow_redirects=False) as client:
        for _ in range(4):
            r = await client.get(url)
            if r.is_redirect and r.headers.get("location"):
                nxt = httpx.URL(url).join(r.headers["location"])
                if nxt.host.lower() not in _ALLOWED or nxt.scheme not in ("http", "https"):
                    raise ValidationFailed("That share link doesn't lead to CricHeroes.", code="INVALID_CRICHEROES_URL")
                url = str(nxt)
                continue
            r.raise_for_status()
            return url, r.text[:_MAX_BYTES]
    raise ValidationFailed("That share link couldn't be opened.", code="INVALID_CRICHEROES_URL")


# Tests swap this for a stub; production uses the real fetcher above.
fetch: Callable[[str], Awaitable[tuple[str, str]]] = _fetch


async def expand(raw: str | None, kind: str) -> str | None:
    """A chshare.link share link → canonical https://cricheroes.com/<kind>-profile/... ; anything else unchanged."""
    if not raw:
        return raw
    share_kind = share_link_kind(raw)
    if share_kind is None:
        return raw
    label = "player" if kind == "player" else "team"
    if share_kind != label:
        raise ValidationFailed(
            f"That's a CricHeroes {share_kind} link — paste your {label} link instead.", code="INVALID_CRICHEROES_URL"
        )
    url = raw.strip()
    if "://" not in url:
        url = "https://" + url
    try:
        final, body = await fetch(url)
    except ValidationFailed:
        raise
    except Exception as exc:
        log.warning("cricheroes.share_link_failed", url=url, error=str(exc)[:200])
        raise ValidationFailed(
            "Couldn't open that CricHeroes share link right now. Paste the full cricheroes.com link instead.",
            code="CRICHEROES_SHARE_UNAVAILABLE",
        ) from exc
    found = embedded_profile_url(body, label) or (final if "cricheroes" in final else None)
    if not found:
        raise ValidationFailed(
            f"That share link didn't open a CricHeroes {label} profile. Paste the full cricheroes.com link instead.",
            code="INVALID_CRICHEROES_URL",
        )
    try:
        return normalize_profile_url(found, label)[0]
    except ValueError as exc:
        raise ValidationFailed(str(exc), code="INVALID_CRICHEROES_URL") from exc
