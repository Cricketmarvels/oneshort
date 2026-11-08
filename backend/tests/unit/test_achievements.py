from app.modules.competition.achievements import evaluate, metrics_from


def test_achievements_only_from_verified_metrics() -> None:
    assert evaluate(metrics_from([], {}, 0)) == []  # nothing earned, nothing invented
    hist = [{"result": "won", "lines": {"bowl": {"wickets": 3}}}, {"result": "lost", "lines": {}}]
    got = {a.id: a for a in evaluate(metrics_from(hist, {"highest": 34, "runs": 60, "wickets": 3}, 6))}
    assert got["debut"].earned and got["three_for"].earned and got["consistent"].earned
    assert not got["regular"].earned and got["regular"].progress == 2 and got["regular"].target == 10
    assert not got["fifty"].earned and got["fifty"].progress == 34
    assert "hundred" not in got and "veteran" not in got  # one "next" per family only
