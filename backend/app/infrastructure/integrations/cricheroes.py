"""Source adapter for pulling a team's data from CricHeroes automatically.

Why the only shipped adapter is ``disabled``:
CricHeroes (cricheroes.com, formerly cricheroes.in) publishes no public data API, and its
Terms of Service state that "scraping the Services is prohibited" and that the Services may
only be accessed through "the currently available, published interfaces (e.g., APIs)".
The community ``cricheroes`` PyPI package (v1.0.10, 2023) is a headless-Chrome scraper, so it
is not used. Its selectors also no longer match the current site.

Teams can still bring their CricHeroes data in by linking their team page and importing a
data file or entering details by hand (see app/modules/cricheroes). When CricHeroes grants
authorised access (a partner API or written permission), implement ``CricHeroesSource`` here
and select it with ``CRICHEROES_SOURCE``. The sync endpoint, storage and UI then work without
further changes.
"""

from typing import Any, Protocol

from app.core.config import Settings
from app.core.exceptions import IntegrationUnavailable

DISABLED_REASON = (
    "Automatic sync isn't available: CricHeroes has no public API and its terms prohibit scraping. "
    "Import a data file or enter your team's details instead."
)


class CricHeroesSource(Protocol):
    name: str

    @property
    def available(self) -> bool: ...

    @property
    def unavailable_reason(self) -> str | None: ...

    async def fetch_team(self, external_team_id: int, slug: str) -> dict[str, Any]:
        """Return a payload matching ``CricHeroesSnapshotIn`` (team_name, players, matches, stats, leaderboard)."""
        ...


class DisabledCricHeroesSource:
    name = "disabled"

    @property
    def available(self) -> bool:
        return False

    @property
    def unavailable_reason(self) -> str | None:
        return DISABLED_REASON

    async def fetch_team(self, external_team_id: int, slug: str) -> dict[str, Any]:
        raise IntegrationUnavailable(DISABLED_REASON, code="CRICHEROES_SYNC_UNAVAILABLE")


def build_cricheroes_source(settings: Settings) -> CricHeroesSource:
    # Only "disabled" exists today; see module docstring for how to add an authorised source.
    return DisabledCricHeroesSource()
