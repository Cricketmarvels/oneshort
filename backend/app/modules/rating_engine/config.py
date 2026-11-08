"""Tunable rating parameters.

The composite weights below are *initial, illustrative* values. They must be calibrated
against real verified match data before being treated as definitive (see
docs/RATING_METHODOLOGY.md). They are role-aware: a specialist bowler's overall rating is
driven mostly by bowling, not by batting they are rarely asked to do.
"""

from typing import Final

# discipline -> weight, per primary playing role. Keys: bat, bowl, field, impact.
ROLE_WEIGHTS: Final[dict[str, dict[str, float]]] = {
    "all_rounder": {"bat": 0.35, "bowl": 0.35, "field": 0.15, "impact": 0.15},
    "batsman": {"bat": 0.55, "bowl": 0.10, "field": 0.15, "impact": 0.20},
    "bowler": {"bat": 0.10, "bowl": 0.55, "field": 0.15, "impact": 0.20},
    "wicketkeeper": {"bat": 0.50, "bowl": 0.05, "field": 0.25, "impact": 0.20},
}
DEFAULT_ROLE: Final = "all_rounder"

# Days per Glicko rating period when inflating RD for inactivity.
INACTIVITY_PERIOD_DAYS: Final = 30.0

# A rating is provisional until the player has this many verified matches AND a low enough RD.
PROVISIONAL_MIN_MATCHES: Final = 5
PROVISIONAL_MAX_RD: Final = 140.0

# Opposition strength for individual updates. A player's performance score is compared with
# what is expected against "1500 + OPPOSITION_WEIGHT x (opponent team rating - own team rating)",
# with a fixed, well-characterised RD. Using the raw team rating would make the expected score
# against a weak side unrealistically high (a 0.9 performance score is near impossible), so
# every good innings against them would *lower* a rating.
OPPOSITION_WEIGHT: Final = 0.5
OPPOSITION_RD: Final = 80.0
STRONGER_SIDE_MARGIN: Final = 50.0

# Leaderboards rank by a conservative estimate (rating - K * RD), so a player with two lucky
# matches does not outrank a proven player with fifty.
CONSERVATIVE_K: Final = 2.0

# Category eligibility.
ALL_ROUNDER_MIN_EACH: Final = 3  # verified matches with both a batting and a bowling entry
CONSISTENCY_MIN_MATCHES: Final = 5
CONSISTENCY_WINDOW: Final = 10
RISING_WINDOW_DAYS: Final = 30
RISING_MIN_MATCHES: Final = 3
FORMAT_MIN_MATCHES: Final = 3  # verified matches in a format before a player is ranked in it

# Team result nudge applied to each player's match-impact score.
RESULT_IMPACT_BONUS: Final = 0.04

FORMATS: Final[dict[str, int | None]] = {
    "T10": 10,
    "T15": 15,
    "T20": 20,
    "30_OVER": 30,
    "40_OVER": 40,
    "CUSTOM": None,
}
