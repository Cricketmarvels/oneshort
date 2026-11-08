"""Player ranking engine (FR-FP-4).

Eligibility (distance radius, availability overlap, role) is decided BEFORE ranking.
Ranking only orders eligible candidates. It is deterministic, explainable (every result
carries a per-factor breakdown) and configurable via ``RANK_W_*`` env weights.

``Ranker`` is a protocol so a learned model (e.g. learning-to-rank trained on
invitation-accept outcomes) can replace ``WeightedRanker`` without API changes.
"""

from dataclasses import dataclass, field
from typing import Literal, Protocol

from app.core.config import RankingWeights

RoleMatch = Literal["primary", "secondary", "any", "none"]

ROLE_SCORES: dict[RoleMatch, float] = {"primary": 1.0, "secondary": 0.6, "any": 0.8, "none": 0.0}
RATING_PRIOR = 3.5  # stars
RATING_PRIOR_WEIGHT = 3  # pseudo-reviews
PARTICIPATION_SATURATION = 20  # matches
NEUTRAL_RESPONSE_RATE = 0.5


@dataclass(frozen=True)
class Candidate:
    player_id: str
    distance_m: float
    radius_m: float
    coverage: float  # 0..1 share of the match window covered by availability
    role_match: RoleMatch
    avg_rating: float | None = None
    rating_count: int = 0
    reliability: float = 70.0  # 0..100
    matches_played: int = 0
    played_with_team: int = 0
    response_rate: float | None = None
    tentative: bool = False


@dataclass(frozen=True)
class Scored:
    candidate: Candidate
    score: float
    factors: dict[str, float] = field(default_factory=dict)


class Ranker(Protocol):
    name: str

    def rank(self, candidates: list[Candidate]) -> list[Scored]: ...


def bayesian_rating(avg: float | None, n: int) -> float:
    if not avg or n <= 0:
        return RATING_PRIOR
    return (avg * n + RATING_PRIOR * RATING_PRIOR_WEIGHT) / (n + RATING_PRIOR_WEIGHT)


def factor_values(c: Candidate) -> dict[str, float]:
    proximity = max(0.0, 1.0 - c.distance_m / c.radius_m) if c.radius_m > 0 else 0.0
    availability = c.coverage * (0.85 if c.tentative else 1.0)
    participation = 0.7 * min(1.0, c.matches_played / PARTICIPATION_SATURATION) + 0.3 * min(1.0, c.played_with_team / 3)
    return {
        "proximity": proximity,
        "availability": availability,
        "role": ROLE_SCORES[c.role_match],
        "rating": (bayesian_rating(c.avg_rating, c.rating_count) - 1) / 4,
        "reliability": max(0.0, min(1.0, c.reliability / 100)),
        "participation": participation,
        "response_rate": c.response_rate if c.response_rate is not None else NEUTRAL_RESPONSE_RATE,
    }


class WeightedRanker:
    name = "weighted-v1"

    def __init__(self, weights: RankingWeights) -> None:
        raw = weights.model_dump()
        total = sum(v for v in raw.values() if v > 0) or 1.0
        self.weights = {k: max(0.0, v) / total for k, v in raw.items()}

    def rank(self, candidates: list[Candidate]) -> list[Scored]:
        scored = []
        for c in candidates:
            f = factor_values(c)
            score = sum(self.weights[k] * f[k] for k in self.weights)
            scored.append(Scored(c, round(score * 100, 2), {k: round(v, 3) for k, v in f.items()}))
        # Deterministic tie-breaks: closer first, then id.
        scored.sort(key=lambda s: (-s.score, s.candidate.distance_m, s.candidate.player_id))
        return scored
