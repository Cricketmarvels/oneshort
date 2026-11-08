"""Parsing and sanitising of CricHeroes URLs.

Only CricHeroes hosts are accepted, so imported data can't smuggle arbitrary links
(``javascript:``, phishing domains) into the app.
"""

import re
from dataclasses import dataclass
from urllib.parse import quote, unquote, urlsplit

from app.core.exceptions import ValidationFailed

CANONICAL_BASE = "https://cricheroes.com"
_PAGE_HOSTS = {"cricheroes.com", "www.cricheroes.com", "cricheroes.in", "www.cricheroes.in"}
_MEDIA_HOSTS = _PAGE_HOSTS | {"media.cricheroes.in", "media.cricheroes.com"}
_TEAM_PATH = re.compile(r"^/?team-profile/(\d{1,12})/([^/?#\s]{1,120})(?:/[A-Za-z-]{0,30})?/?$")
_BARE_REF = re.compile(r"^(\d{1,12})/([^/?#\s]{1,120})$")


@dataclass(frozen=True)
class TeamRef:
    external_team_id: int
    slug: str

    @property
    def url(self) -> str:
        return f"{CANONICAL_BASE}/team-profile/{self.external_team_id}/{quote(self.slug, safe='@-_.~')}"


def parse_team_ref(raw: str) -> TeamRef:
    """Accept a CricHeroes team-profile URL (.com or .in, any tab) or a bare ``<id>/<slug>`` reference."""
    value = raw.strip()
    bare = _BARE_REF.match(value)
    if bare:
        return TeamRef(int(bare.group(1)), unquote(bare.group(2)))
    if "://" not in value:
        value = "https://" + value
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or (parts.hostname or "").lower() not in _PAGE_HOSTS:
        raise ValidationFailed(
            "Enter a CricHeroes team link, e.g. https://cricheroes.com/team-profile/123456/my-team",
            code="INVALID_CRICHEROES_URL",
        )
    m = _TEAM_PATH.match(parts.path)
    if not m:
        raise ValidationFailed(
            "That link isn't a CricHeroes team profile. Open your team on CricHeroes and copy its link.",
            code="INVALID_CRICHEROES_URL",
        )
    return TeamRef(int(m.group(1)), unquote(m.group(2)))


def safe_cricheroes_url(raw: str | None, *, media: bool = False) -> str | None:
    """Return an absolute https URL on a CricHeroes host, or None. Relative paths resolve to cricheroes.com."""
    if not raw:
        return None
    value = raw.strip()
    if value.startswith("/") and not value.startswith("//"):
        value = CANONICAL_BASE + value
    parts = urlsplit(value)
    hosts = _MEDIA_HOSTS if media else _PAGE_HOSTS
    if parts.scheme not in ("http", "https") or (parts.hostname or "").lower() not in hosts:
        return None
    return parts._replace(scheme="https").geturl()
