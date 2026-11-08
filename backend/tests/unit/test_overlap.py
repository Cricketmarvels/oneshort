from datetime import UTC, datetime, timedelta

from app.modules.availability.overlap import coverage_ratio, intervals_overlap, merged_coverage

T0 = datetime(2026, 11, 8, 1, 30, tzinfo=UTC)
H = timedelta(hours=1)


def test_same_date_but_no_time_overlap_is_not_available() -> None:
    # Slot 6–9am, match 3–6pm on the same day.
    assert not intervals_overlap(T0, T0 + 3 * H, T0 + 9 * H, T0 + 12 * H)
    assert coverage_ratio(T0, T0 + 3 * H, T0 + 9 * H, T0 + 12 * H) == 0


def test_touching_intervals_do_not_overlap() -> None:
    assert not intervals_overlap(T0, T0 + H, T0 + H, T0 + 2 * H)


def test_full_and_partial_coverage() -> None:
    assert coverage_ratio(T0, T0 + 5 * H, T0 + H, T0 + 4 * H) == 1.0
    assert coverage_ratio(T0, T0 + 2 * H, T0 + H, T0 + 3 * H) == 0.5


def test_merged_coverage_from_two_slots() -> None:
    slots = [(T0, T0 + 2 * H), (T0 + 2 * H, T0 + 4 * H)]
    assert merged_coverage(slots, T0 + H, T0 + 3 * H) == 1.0
