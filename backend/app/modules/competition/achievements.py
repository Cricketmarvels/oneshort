"""Achievements derived ONLY from verified data (captain-verified scorecards and marked attendance).

Definitions are configuration (sport-agnostic shape: id, sport, metric, target), so other sports can add
their own list. Nothing here is self-reported or estimated; an achievement is earned when its metric
reaches the target, otherwise the next unearned one per family is shown with real progress.
"""

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel


@dataclass(frozen=True)
class AchievementDefinition:
    id: str
    sport: str
    family: str
    title: str
    description: str
    metric: str
    target: int


CRICKET: tuple[AchievementDefinition, ...] = (
    AchievementDefinition("debut", "cricket", "matches", "Debut", "Played a verified match", "matches", 1),
    AchievementDefinition("regular", "cricket", "matches", "Regular", "10 verified matches", "matches", 10),
    AchievementDefinition("veteran", "cricket", "matches", "Veteran", "50 verified matches", "matches", 50),
    AchievementDefinition(
        "consistent", "cricket", "attendance", "Consistent Player", "Turned up for 5 pickup games", "attended", 5
    ),
    AchievementDefinition(
        "dependable", "cricket", "attendance", "Dependable", "Turned up for 20 pickup games", "attended", 20
    ),
    AchievementDefinition(
        "fifty", "cricket", "batting", "Half-century", "Scored 50 in a verified match", "highest", 50
    ),
    AchievementDefinition("hundred", "cricket", "batting", "Century", "Scored 100 in a verified match", "highest", 100),
    AchievementDefinition("runs_500", "cricket", "runs", "500 Club", "500 verified career runs", "runs", 500),
    AchievementDefinition(
        "three_for", "cricket", "bowling", "Three-for", "3 wickets in a verified match", "best_wickets", 3
    ),
    AchievementDefinition(
        "five_for", "cricket", "bowling", "Five-for", "5 wickets in a verified match", "best_wickets", 5
    ),
    AchievementDefinition(
        "wickets_25", "cricket", "wickets", "Strike Bowler", "25 verified career wickets", "wickets", 25
    ),
    AchievementDefinition("team_player", "cricket", "wins", "Team Player", "5 verified wins", "wins", 5),
)


class AchievementOut(BaseModel):
    id: str
    title: str
    description: str
    earned: bool
    progress: int
    target: int


class AttendanceOut(BaseModel):
    attended: int
    marked: int
    rate: float | None  # None until there are at least MIN_ATTENDANCE marked games


MIN_ATTENDANCE = 3


def metrics_from(hist: list[dict[str, Any]], career: dict[str, float], attended: int) -> dict[str, int]:
    best_w = 0
    for h in hist:
        if w := (h.get("lines") or {}).get("bowl"):
            best_w = max(best_w, int(w.get("wickets", 0)))
    return {
        "matches": len(hist),
        "highest": int(career.get("highest", 0)),
        "runs": int(career.get("runs", 0)),
        "wickets": int(career.get("wickets", 0)),
        "best_wickets": best_w,
        "wins": sum(1 for h in hist if h.get("result") == "won"),
        "attended": attended,
    }


def evaluate(metrics: dict[str, int], defs: tuple[AchievementDefinition, ...] = CRICKET) -> list[AchievementOut]:
    """Every earned achievement, plus the next unearned one per family (only if some progress exists)."""
    out: list[AchievementOut] = []
    shown_next: set[str] = set()
    for d in defs:
        v = metrics.get(d.metric, 0)
        if v >= d.target:
            out.append(
                AchievementOut(
                    id=d.id, title=d.title, description=d.description, earned=True, progress=d.target, target=d.target
                )
            )
        elif d.family not in shown_next and v > 0:
            shown_next.add(d.family)
            out.append(
                AchievementOut(
                    id=d.id, title=d.title, description=d.description, earned=False, progress=v, target=d.target
                )
            )
    return sorted(out, key=lambda a: (not a.earned, -(a.progress / a.target)))
