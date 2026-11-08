from datetime import UTC, datetime, timedelta

from app.modules.assistant.interpret import rule_intent, window_label, windows

NOW = datetime(2026, 11, 5, 6, 0, tzinfo=UTC)  # Thu 5 Nov, 11:30 IST


def test_saturday_morning_game() -> None:
    i = rule_intent("i am looking to play on saturday morning", NOW)
    assert (i.kind, i.weekdays, i.times_of_day) == ("play_match", ["sat"], ["morning"])
    wins = windows(i, NOW)
    first = wins[0]
    assert first[0] == datetime(2026, 11, 6, 23, 30, tzinfo=UTC)  # Sat 7 Nov 05:00 IST
    assert first[1] - first[0] == timedelta(hours=7)
    assert len(wins) == 2  # this Saturday and next
    assert window_label(i, wins) == "Sat 7 Nov, morning (+1 more day)"


def test_other_intents() -> None:
    assert rule_intent("need a wicketkeeper for sunday", NOW).model_dump(include={"kind", "role", "weekdays"}) == {
        "kind": "find_players",
        "role": "wicketkeeper",
        "weekdays": ["sun"],
    }
    assert rule_intent("looking for a team to join near me", NOW).kind == "find_team"
    i = rule_intent("find an opponent for my team this weekend, T20", NOW)
    assert (i.kind, i.format, i.weekdays) == ("find_opponent", "T20", ["sat", "sun"])
    assert rule_intent("any cricket community in sector 62?", NOW).kind == "find_community"
    assert rule_intent("game tomorrow evening within 5 km", NOW).model_dump(
        include={"dates", "times_of_day", "max_distance_km"}
    ) == {"dates": ["2026-11-06"], "times_of_day": ["evening"], "max_distance_km": 5}
