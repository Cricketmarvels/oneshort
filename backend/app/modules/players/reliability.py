"""Reliability score (0–100) for players (FR-REP-4).

Deterministic, explainable formula with a Bayesian prior so new players start near
``PRIOR`` instead of 0 or 100, and a single match cannot swing the score wildly.

    attendance   = (attended + PRIOR·K) / (completed + K)
    punctuality  = ½·rating_part + ½·(1 − late / attended)
    sportsmanship= (avg_sportsmanship − 1) / 4          (prior if no ratings)
    cancellation = 1 − (late_withdrawals + ½·other_withdrawals) / (completed + withdrawals + K)

    score = 100 · (0.45·attendance + 0.20·punctuality + 0.20·sportsmanship + 0.15·cancellation)
"""

from dataclasses import dataclass
from typing import Any

from bson import ObjectId

from app.common.enums import Attendance, MatchStatus, RosterStatus
from app.infrastructure.database.mongo import Mongo

PRIOR = 0.7
K = 3.0
WEIGHTS = {"attendance": 0.45, "punctuality": 0.20, "sportsmanship": 0.20, "cancellation": 0.15}


@dataclass(frozen=True)
class ReliabilityInputs:
    completed: int = 0
    attended: int = 0
    late: int = 0
    no_shows: int = 0
    late_withdrawals: int = 0
    other_withdrawals: int = 0
    avg_punctuality: float | None = None  # 1..5
    avg_sportsmanship: float | None = None  # 1..5


def _rating_part(avg: float | None) -> float:
    return PRIOR if avg is None else max(0.0, min(1.0, (avg - 1) / 4))


def reliability_score(i: ReliabilityInputs) -> tuple[float, dict[str, float]]:
    attendance = (i.attended + PRIOR * K) / (i.completed + K)
    late_part = 1 - (i.late / i.attended) if i.attended else PRIOR
    punctuality = 0.5 * _rating_part(i.avg_punctuality) + 0.5 * late_part
    sportsmanship = _rating_part(i.avg_sportsmanship)
    withdrawals = i.late_withdrawals + i.other_withdrawals
    cancel_rate = (i.late_withdrawals + 0.5 * i.other_withdrawals) / (i.completed + withdrawals + K)
    cancellation = 1 - cancel_rate
    parts = {
        "attendance": attendance,
        "punctuality": punctuality,
        "sportsmanship": sportsmanship,
        "cancellation": cancellation,
    }
    score = 100 * sum(WEIGHTS[k] * v for k, v in parts.items())
    return round(max(0.0, min(100.0, score)), 1), {k: round(v, 3) for k, v in parts.items()}


async def recompute_player_stats(mongo: Mongo, player_ids: list[ObjectId]) -> None:
    """Recompute participation stats + reliability from roster and rating history."""
    for pid in set(player_ids):
        rows = [
            r
            async for r in await mongo["match_rosters"].aggregate(
                [
                    {"$match": {"player_id": pid}},
                    {
                        "$lookup": {
                            "from": "matches",
                            "localField": "match_id",
                            "foreignField": "_id",
                            "as": "m",
                            "pipeline": [{"$project": {"match_status": 1}}],
                        }
                    },
                    {"$unwind": "$m"},
                ]
            )
        ]
        completed = [
            r for r in rows if r["m"]["match_status"] == MatchStatus.COMPLETED and r["status"] == RosterStatus.CONFIRMED
        ]
        attended = [r for r in completed if r.get("attendance") in (Attendance.PRESENT, Attendance.LATE)]
        late = [r for r in completed if r.get("attendance") == Attendance.LATE]
        no_shows = [r for r in completed if r.get("attendance") == Attendance.NO_SHOW]
        withdrawn = [r for r in rows if r["status"] == RosterStatus.WITHDRAWN]
        late_w = [r for r in withdrawn if r.get("late_withdrawal")]
        agg: dict[str, Any] = {}
        async for a in await mongo["ratings"].aggregate(
            [
                {"$match": {"reviewed_user_id": pid, "rating_type": "player", "status": "visible"}},
                {"$group": {"_id": None, "p": {"$avg": "$scores.punctuality"}, "s": {"$avg": "$scores.sportsmanship"}}},
            ]
        ):
            agg = a
        score, _ = reliability_score(
            ReliabilityInputs(
                completed=len(completed),
                attended=len(attended),
                late=len(late),
                no_shows=len(no_shows),
                late_withdrawals=len(late_w),
                other_withdrawals=len(withdrawn) - len(late_w),
                avg_punctuality=agg.get("p"),
                avg_sportsmanship=agg.get("s"),
            )
        )
        await mongo["player_profiles"].update_one(
            {"user_id": pid},
            {
                "$set": {
                    "reliability_score": score,
                    "stats.matches_played": len(completed),
                    "stats.attended": len(attended),
                    "stats.no_shows": len(no_shows),
                    "stats.late_withdrawals": len(late_w),
                }
            },
        )
