"""Pure time-overlap helpers (half-open intervals [start, end)).

A player is only "available" for a match when their slot actually overlaps the match
window. Matching calendar dates is NOT sufficient (FR-FP-3).
"""

from datetime import datetime


def overlap_seconds(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> float:
    latest_start = max(a_start, b_start)
    earliest_end = min(a_end, b_end)
    return max(0.0, (earliest_end - latest_start).total_seconds())


def intervals_overlap(a_start: datetime, a_end: datetime, b_start: datetime, b_end: datetime) -> bool:
    return a_start < b_end and b_start < a_end


def coverage_ratio(slot_start: datetime, slot_end: datetime, match_start: datetime, match_end: datetime) -> float:
    """Fraction of the match window covered by the slot (0.0 – 1.0)."""
    duration = (match_end - match_start).total_seconds()
    if duration <= 0:
        return 0.0
    return min(1.0, overlap_seconds(slot_start, slot_end, match_start, match_end) / duration)


def merged_coverage(slots: list[tuple[datetime, datetime]], match_start: datetime, match_end: datetime) -> float:
    """Coverage of the match window by the union of several (non-overlapping) slots."""
    total = sum(overlap_seconds(s, e, match_start, match_end) for s, e in slots)
    duration = (match_end - match_start).total_seconds()
    return min(1.0, total / duration) if duration > 0 else 0.0
