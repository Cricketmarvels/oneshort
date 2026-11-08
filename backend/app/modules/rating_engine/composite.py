"""Combine discipline ratings into one overall rating, with confidence."""

import statistics
from dataclasses import dataclass

from app.modules.rating_engine.config import (
    CONSERVATIVE_K,
    CONSISTENCY_MIN_MATCHES,
    DEFAULT_ROLE,
    PROVISIONAL_MAX_RD,
    PROVISIONAL_MIN_MATCHES,
    ROLE_WEIGHTS,
)
from app.modules.rating_engine.glicko2 import DEFAULT_RATING, DEFAULT_RD, MIN_RD, Glicko

DISCIPLINES = ("bat", "bowl", "field", "impact")


@dataclass(frozen=True)
class Composite:
    rating: float
    rd: float
    confidence: float  # 0..1
    provisional: bool

    @property
    def conservative(self) -> float:
        return self.rating - CONSERVATIVE_K * self.rd


def weights_for(role: str | None) -> dict[str, float]:
    return ROLE_WEIGHTS.get(role or DEFAULT_ROLE, ROLE_WEIGHTS[DEFAULT_ROLE])


def confidence_from_rd(rd: float) -> float:
    return round(min(1.0, max(0.0, (DEFAULT_RD - rd) / (DEFAULT_RD - MIN_RD))), 3)


def composite(ratings: dict[str, Glicko], counts: dict[str, int], role: str | None, matches: int) -> Composite:
    """Weighted mean over disciplines the player has verified data for; weights are
    renormalised so a batter who never bowls is not dragged down by an unused bowling rating."""
    w = weights_for(role)
    used = [d for d in DISCIPLINES if counts.get(d, 0) > 0 and w[d] > 0]
    if not used:
        return Composite(DEFAULT_RATING, DEFAULT_RD, 0.0, True)
    total = sum(w[d] for d in used)
    rating = sum(w[d] * ratings[d].rating for d in used) / total
    rd = sum(w[d] * ratings[d].rd for d in used) / total  # conservative (not root-sum-square)
    provisional = matches < PROVISIONAL_MIN_MATCHES or rd > PROVISIONAL_MAX_RD
    return Composite(round(rating, 1), round(rd, 1), confidence_from_rd(rd), provisional)


def consistency(recent_impacts: list[float]) -> float | None:
    """1.0 = identical impact every match; falls as match-to-match variation grows."""
    if len(recent_impacts) < CONSISTENCY_MIN_MATCHES:
        return None
    sd = statistics.pstdev(recent_impacts)
    return round(max(0.0, 1.0 - sd / 0.25), 3)


def all_rounder_rating(bat: Glicko, bowl: Glicko) -> float:
    """Harmonic mean: rewards being good at both, not great at one."""
    return 2.0 / (1.0 / bat.rating + 1.0 / bowl.rating)
