"""Deterministic fallback interpreter and time-window helpers (no model needed)."""

import re
from datetime import UTC, date, datetime, timedelta

from app.modules.assistant.schemas import Intent

IST = timedelta(hours=5, minutes=30)
DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
DAY_WORDS = {
    "monday": "mon",
    "tuesday": "tue",
    "wednesday": "wed",
    "thursday": "thu",
    "friday": "fri",
    "saturday": "sat",
    "sunday": "sun",
    "mon": "mon",
    "tue": "tue",
    "tues": "tue",
    "wed": "wed",
    "thu": "thu",
    "thur": "thu",
    "thurs": "thu",
    "fri": "fri",
    "sat": "sat",
    "sun": "sun",
}
_PLAYER_WORDS = "player|players|batter|batsman|batsmen|bowler|bowlers|keeper|wicketkeeper|all[- ]?rounder|fielder"
HOURS = {"morning": (5, 12), "afternoon": (12, 16), "evening": (16, 20), "night": (19, 24)}


def today_ist(now: datetime | None = None) -> date:
    return ((now or datetime.now(UTC)) + IST).date()


def rule_intent(q: str, now: datetime | None = None) -> Intent:
    t = q.lower()
    words = set(re.findall(r"[a-z0-9]+", t))
    if re.search(r"\b(opponent|opposition|challenge|play against|rival)\b", t):
        kind = "find_opponent"
    elif re.search(r"\b(communit|group|club to join|meet ?up)\w*", t):
        kind = "find_community"
    elif re.search(r"\b(join a team|team to join|looking for a team|find a team|new team|join team)\b", t):
        kind = "find_team"
    elif re.search(r"\b(need|looking for|find|want)\b.*\b(" + _PLAYER_WORDS + r")s?\b", t) and not re.search(
        r"\b(to play|i want to play|play on|game to play)\b", t
    ):
        kind = "find_players"
    else:
        kind = "play_match"
    weekdays: list[str] = []
    for w, d in DAY_WORDS.items():
        if w in words and d not in weekdays:
            weekdays.append(d)
    if "weekend" in words:
        weekdays += [d for d in ("sat", "sun") if d not in weekdays]
    base = today_ist(now)
    dates: list[str] = []
    if "today" in words or "tonight" in words:
        dates.append(base.isoformat())
    if "tomorrow" in words:
        dates.append((base + timedelta(days=1)).isoformat())
    times = [k for k in HOURS if k in words or (k == "night" and "tonight" in words)]
    role = None
    if re.search(r"\bkeeper|wicket ?keeper|wk\b", t):
        role = "wicketkeeper"
    elif re.search(r"all[- ]?rounder", t):
        role = "all_rounder"
    elif re.search(r"\bbowl", t):
        role = "bowler"
    elif re.search(r"\bbat(ter|sman|smen|ting)?\b", t):
        role = "batsman"
    fmt = None
    m = re.search(r"\bt\s?(10|15|20)\b", t)
    if m:
        fmt = f"T{m.group(1)}"
    km = re.search(r"(\d{1,3})\s?km", t)
    label = {
        "play_match": "A game to play",
        "find_players": "Players",
        "find_team": "A team to join",
        "find_opponent": "A team to play against",
        "find_community": "A cricket community",
    }[kind]
    if role and kind == "find_players":
        label = {
            "wicketkeeper": "A wicketkeeper",
            "all_rounder": "An all-rounder",
            "bowler": "A bowler",
            "batsman": "A batter",
        }[role]
    when = " ".join(
        ([" & ".join(w.capitalize() for w in weekdays)] if weekdays else []) + ([" / ".join(times)] if times else [])
    )
    return Intent(
        kind=kind,
        weekdays=weekdays,
        dates=dates,
        times_of_day=times,
        role=role,
        format=fmt,
        max_distance_km=int(km.group(1)) if km else None,
        summary=f"{label}{' on ' + when if when else ''}",
    )


def windows(intent: Intent, now: datetime | None = None, horizon_days: int = 14) -> list[tuple[datetime, datetime]]:
    """UTC time ranges matching the intent's days/dates and times of day (empty = any time soon)."""
    now = now or datetime.now(UTC)
    base = today_ist(now)
    days: set[date] = set()
    for d in intent.dates:
        try:
            days.add(date.fromisoformat(d))
        except ValueError:
            continue
    for i in range(horizon_days):  # each requested weekday, this week and next
        day = base + timedelta(days=i)
        if DAYS[day.weekday()] in intent.weekdays:
            days.add(day)
    if not days and intent.times_of_day:
        days = {base + timedelta(days=i) for i in range(7)}
    spans = [HOURS[t] for t in intent.times_of_day] or [(0, 24)]
    out = []
    for day in sorted(days):
        midnight = datetime(day.year, day.month, day.day, tzinfo=UTC) - IST
        for h0, h1 in spans:
            start, end = midnight + timedelta(hours=h0), midnight + timedelta(hours=h1)
            if end > now:
                out.append((max(start, now), end))
    return out


def window_label(intent: Intent, wins: list[tuple[datetime, datetime]]) -> str | None:
    if not wins:
        return None
    n_days = len({(w[0] + IST).date() for w in wins})
    label = (wins[0][0] + IST).strftime("%a %-d %b")
    if intent.times_of_day:
        label += ", " + " / ".join(intent.times_of_day)
    if n_days > 1:
        label += f" (+{n_days - 1} more day{'s' if n_days > 2 else ''})"
    return label
