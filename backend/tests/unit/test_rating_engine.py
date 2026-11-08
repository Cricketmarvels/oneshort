import pytest

from app.modules.rating_engine.composite import composite, confidence_from_rd, consistency
from app.modules.rating_engine.explain import match_reasons
from app.modules.rating_engine.glicko2 import Glicko, expected_score, inflate, update
from app.modules.rating_engine.performance import (
    BattingLine,
    BowlingLine,
    FieldingLine,
    batting_score,
    bowling_score,
    fielding_score,
    impact_score,
)


def test_glicko2_matches_glickman_reference_example() -> None:
    p = Glicko(1500, 200, 0.06)
    out = update(p, [(Glicko(1400, 30), 1.0), (Glicko(1550, 100), 0.0), (Glicko(1700, 300), 0.0)])
    assert out.rating == pytest.approx(1464.06, abs=0.05)
    assert out.rd == pytest.approx(151.52, abs=0.05)
    assert out.vol == pytest.approx(0.05999, abs=1e-5)


def test_glicko2_par_score_against_equal_opponent_keeps_rating() -> None:
    out = update(Glicko(1500, 100), [(Glicko(1500, 100), 0.5)])
    assert out.rating == pytest.approx(1500, abs=0.01)
    assert out.rd < 100  # more data, more certainty


def test_stronger_opponent_rewards_same_performance_more() -> None:
    me = Glicko(1500, 150)
    vs_weak = update(me, [(Glicko(1300, 80), 0.7)]).rating
    vs_strong = update(me, [(Glicko(1700, 80), 0.7)]).rating
    assert vs_strong > vs_weak
    assert expected_score(me, Glicko(1700, 80)) < 0.5


def test_inactivity_inflates_rd_but_caps_at_default() -> None:
    p = Glicko(1600, 60, 0.06)
    assert inflate(p, 6).rd > 60
    assert inflate(p, 10_000).rd == 350


def test_batting_score_is_format_aware_and_monotonic() -> None:
    t10 = batting_score(BattingLine(30, 18, 3, 1), team_total=110, overs=10)
    t40 = batting_score(BattingLine(30, 18, 3, 1), team_total=220, overs=40)
    assert t10 is not None and t40 is not None and t10 > t40
    low = batting_score(BattingLine(10, 15), 150, 20)
    high = batting_score(BattingLine(60, 40, 6, 2), 150, 20)
    assert low is not None and high is not None and high > 0.6 > 0.4 > low
    assert batting_score(BattingLine(0, 0, out=False), 150, 20) is None  # did not bat
    duck = batting_score(BattingLine(0, 3), 150, 20)
    assert duck is not None and duck < 0.15


def test_bowling_score_rewards_wickets_and_economy() -> None:
    tidy = bowling_score(BowlingLine(balls=24, runs=18, wickets=1), overs=20)
    expensive = bowling_score(BowlingLine(balls=24, runs=48, wickets=1), overs=20)
    haul = bowling_score(BowlingLine(balls=24, runs=24, wickets=4), overs=20)
    assert tidy is not None and expensive is not None and haul is not None
    assert haul > tidy > expensive
    assert bowling_score(BowlingLine(0, 0, 0), 20) is None


def test_fielding_par_is_near_half() -> None:
    assert 0.4 < fielding_score(FieldingLine()) < 0.5
    assert fielding_score(FieldingLine(catches=2)) > fielding_score(FieldingLine(catches=1, run_outs=0)) > 0.7


def test_impact_ignores_disciplines_not_played_and_nudges_by_result() -> None:
    w = {"bat": 0.55, "bowl": 0.10, "field": 0.15, "impact": 0.20}
    s = {"bat": 0.7, "bowl": None, "field": 0.43}
    won, lost = impact_score(s, w, "won"), impact_score(s, w, "lost")
    assert won > lost and abs((won + lost) / 2 - (0.55 * 0.7 + 0.15 * 0.43) / 0.7) < 1e-9


def test_composite_is_role_aware_and_provisional_with_few_matches() -> None:
    r = {"bat": Glicko(1700, 80), "bowl": Glicko(1400, 80), "field": Glicko(1500, 80), "impact": Glicko(1550, 80)}
    counts = {"bat": 20, "bowl": 20, "field": 20, "impact": 20}
    batter = composite(r, counts, "batsman", 20)
    bowler = composite(r, counts, "bowler", 20)
    assert batter.rating > bowler.rating
    assert not batter.provisional and batter.confidence > 0.8
    newbie = composite(r, {"bat": 2, "field": 2, "impact": 2}, "all_rounder", 2)
    assert newbie.provisional
    # A batter who never bowled is not dragged down by the unused bowling rating
    no_bowl = composite(r, {"bat": 20, "field": 20, "impact": 20}, "all_rounder", 20)
    assert no_bowl.rating > composite(r, counts, "all_rounder", 20).rating


def test_conservative_score_ranks_proven_player_above_lucky_newcomer() -> None:
    proven = composite(
        {d: Glicko(1600, 60) for d in ("bat", "bowl", "field", "impact")},
        dict.fromkeys(("bat", "bowl", "field", "impact"), 40),
        "all_rounder",
        40,
    )
    lucky = composite(
        {d: Glicko(1750, 250) for d in ("bat", "bowl", "field", "impact")},
        dict.fromkeys(("bat", "bowl", "field", "impact"), 2),
        "all_rounder",
        2,
    )
    assert lucky.rating > proven.rating and proven.conservative > lucky.conservative
    assert confidence_from_rd(350) == 0 and confidence_from_rd(30) == 1


def test_consistency_needs_history() -> None:
    assert consistency([0.5, 0.6]) is None
    steady = consistency([0.6, 0.62, 0.58, 0.61, 0.6])
    erratic = consistency([0.1, 0.9, 0.2, 0.85, 0.3])
    assert steady is not None and erratic is not None and steady > erratic


def test_reasons_come_from_real_numbers() -> None:
    reasons = match_reasons(
        {"bat": 18.4, "bowl": -0.5, "field": 6.0, "impact": 9.0},
        {
            "bat": {"runs": 54, "balls": 38, "out": False},
            "bowl": None,
            "field": {"catches": 2, "run_outs": 0, "stumpings": 0},
        },
        "Sector 62 Tech XI",
        True,
        "won",
    )
    assert reasons[0] == "Batting +18: 54* off 38 against Sector 62 Tech XI, a higher-rated side"
    assert reasons[1].startswith("Fielding +6: 2 catches")
    assert not any(r.startswith("Bowling") for r in reasons)
    assert reasons[-1] == "Team win added to match impact"
