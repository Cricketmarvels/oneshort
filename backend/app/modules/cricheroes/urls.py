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


# ---------------------------------------------------------------- profile links (player / team)
# Strict rules for links people paste into their GoFindr profile: https only, exact cricheroes.com host,
# no credentials/ports, the right profile type, numeric id. The link is only ever opened by the user's
# browser — the backend never fetches it.
_LINK_HOSTS = {"cricheroes.com", "www.cricheroes.com"}
_SLUG = r"([A-Za-z0-9._~%-]{1,120})"
_TABS = (
    r"(?:/(?:stats|matches|profile|badges|teams|awards|highlights|photos|members|leaderboard|connections|scorecard))?"
)
_PROFILE_PATHS = {
    "player": re.compile(rf"^/player-profile/(\d{{1,12}})(?:/{_SLUG})?{_TABS}/?$"),
    "team": re.compile(rf"^/team-profile/(\d{{1,12}})(?:/{_SLUG})?{_TABS}/?$"),
}
_EXAMPLES = {
    "player": "https://cricheroes.com/player-profile/4794795/your-name/stats",
    "team": "https://cricheroes.com/team-profile/1275057/your-team/stats",
}


def normalize_profile_url(raw: str, kind: str) -> tuple[str, str]:
    """Validate a pasted CricHeroes player/team link. Returns (normalised https URL, numeric id). Raises ValueError."""
    value = (raw or "").strip()
    label = "player" if kind == "player" else "team"
    if not value or len(value) > 300 or any(ch.isspace() or ord(ch) < 32 for ch in value):
        raise ValueError(f"Paste your CricHeroes {label} profile link, e.g. {_EXAMPLES[label]}")
    if "://" not in value and value.lower().startswith(("cricheroes.com/", "www.cricheroes.com/")):
        value = "https://" + value
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as exc:
        raise ValueError(f"That isn't a valid link. Use e.g. {_EXAMPLES[label]}") from exc
    if parts.scheme.lower() != "https":
        raise ValueError("Only secure https:// CricHeroes links are accepted")
    host = (parts.hostname or "").lower()
    if host not in _LINK_HOSTS or parts.username or parts.password or port not in (None, 443):
        raise ValueError(f"Only links on cricheroes.com are accepted, e.g. {_EXAMPLES[label]}")
    other = "team" if label == "player" else "player"
    m = _PROFILE_PATHS[label].match(parts.path)
    if not m:
        if _PROFILE_PATHS[other].match(parts.path):
            raise ValueError(f"That's a CricHeroes {other} profile — paste your {label} profile link instead")
        raise ValueError(
            f"That link isn't a CricHeroes {label} profile. Open it on CricHeroes and copy its link, "
            f"e.g. {_EXAMPLES[label]}"
        )
    ext_id = m.group(1)
    slug = quote(unquote(m.group(2)), safe="-_.~") if m.group(2) else None
    url = f"{CANONICAL_BASE}/{label}-profile/{ext_id}" + (f"/{slug}" if slug else "") + "/stats"
    return url, ext_id


def safe_profile_url(raw: str | None, kind: str) -> tuple[str | None, str | None]:
    """For stored/legacy values: (url, id) if it passes the strict rules, else (None, None)."""
    if not raw:
        return None, None
    try:
        return normalize_profile_url(raw, kind)
    except ValueError:
        return None, None
