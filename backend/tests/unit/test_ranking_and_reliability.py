from app.core.config import RankingWeights
from app.modules.discovery.ranking import Candidate, WeightedRanker, factor_values
from app.modules.players.reliability import ReliabilityInputs, reliability_score


def cand(pid: str, **kw: object) -> Candidate:
    base = {"player_id": pid, "distance_m": 2000.0, "radius_m": 10000.0, "coverage": 1.0, "role_match": "primary"}
    base.update(kw)
    return Candidate(**base)  # type: ignore[arg-type]


def test_closer_player_ranks_higher_all_else_equal() -> None:
    r = WeightedRanker(RankingWeights()).rank([cand("far", distance_m=9000.0), cand("near", distance_m=1000.0)])
    assert [s.candidate.player_id for s in r] == ["near", "far"]


def test_primary_role_beats_secondary() -> None:
    r = WeightedRanker(RankingWeights()).rank([cand("sec", role_match="secondary"), cand("pri")])
    assert r[0].candidate.player_id == "pri"


def test_reliable_highly_rated_player_beats_slightly_closer_unreliable_one() -> None:
    good = cand(
        "good",
        distance_m=3000.0,
        avg_rating=4.8,
        rating_count=20,
        reliability=95.0,
        matches_played=25,
        response_rate=0.95,
    )
    flaky = cand(
        "flaky",
        distance_m=2500.0,
        avg_rating=2.1,
        rating_count=10,
        reliability=40.0,
        matches_played=3,
        response_rate=0.2,
    )
    r = WeightedRanker(RankingWeights()).rank([flaky, good])
    assert r[0].candidate.player_id == "good"
    assert set(r[0].factors) == {
        "proximity",
        "availability",
        "role",
        "rating",
        "reliability",
        "participation",
        "response_rate",
    }


def test_weights_are_configurable() -> None:
    only_distance = RankingWeights(
        proximity=1, availability=0, role=0, rating=0, reliability=0, participation=0, response_rate=0
    )
    good_far = cand("a", distance_m=9000.0, avg_rating=5, rating_count=50, reliability=100)
    bad_near = cand("b", distance_m=500.0, avg_rating=1, rating_count=50, reliability=0)
    assert WeightedRanker(only_distance).rank([good_far, bad_near])[0].candidate.player_id == "b"


def test_rating_prior_dampens_single_review() -> None:
    one = factor_values(cand("x", avg_rating=5.0, rating_count=1))["rating"]
    many = factor_values(cand("y", avg_rating=5.0, rating_count=50))["rating"]
    assert one < many


def test_reliability_prior_and_bounds() -> None:
    new, _ = reliability_score(ReliabilityInputs())
    assert 65 <= new <= 75
    perfect, _ = reliability_score(ReliabilityInputs(completed=30, attended=30, avg_punctuality=5, avg_sportsmanship=5))
    flaky, _ = reliability_score(
        ReliabilityInputs(
            completed=10, attended=4, no_shows=6, late_withdrawals=5, avg_punctuality=2, avg_sportsmanship=2
        )
    )
    assert perfect > new > flaky
    assert 0 <= flaky and perfect <= 100
