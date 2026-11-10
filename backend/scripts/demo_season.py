"""DEMO cricket season for local testing — every record is flagged ``is_demo``.

Fixtures are created through the real challenge → accept → confirm flow, moved into the
past (dev seed only), then a generated scorecard is submitted by one captain and verified
by the other, so ratings come out of the real engine. The app labels anything derived
from these fixtures as demo data. Never run against production.
"""

import random
from datetime import UTC, datetime, timedelta
from typing import Any

from bson import ObjectId

FORMATS = [("T20", 20), ("T10", 10), ("T15", 15), ("T20", 20)]


def _bat_order(row: dict[str, Any]) -> tuple[bool, float]:
    return (row["role"] == "bowler", -row["skill"])


def _split(total: int, n: int, rng: random.Random) -> list[int]:
    if n <= 0:
        return []
    cuts = sorted(rng.randint(0, total) for _ in range(n - 1))
    return [b - a for a, b in zip([0, *cuts], [*cuts, total], strict=True)]


def _boundaries(runs: int, rng: random.Random) -> tuple[int, int]:
    sixes = min(runs // 6, max(0, int(rng.gauss(runs * 0.03, 1))))
    fours = min((runs - 6 * sixes) // 4, max(0, int(rng.gauss(runs * 0.09, 1.2))))
    return fours, sixes


def innings(
    bat: list[dict[str, Any]],
    bowl: list[dict[str, Any]],
    overs: int,
    rng: random.Random,
    target: int | None,
    chase_wins: bool | None,
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """Returns (innings totals, per-user lines). ``bat``/``bowl`` items: {id, skill, role}."""
    lines: dict[str, dict[str, Any]] = {}
    strength = sum(p["skill"] for p in bat) / len(bat)
    attack = sum(p["skill"] for p in bowl) / len(bowl)
    wickets = max(2, min(9, int(rng.gauss(6.5 - 3 * (strength - attack), 1.5))))
    batters = bat[: min(len(bat), wickets + 2)]
    par = 12 + 0.6 * overs
    runs = [
        max(0, int(rng.gauss(par * p["skill"] * (1.25 if i < 3 else 0.8), par * 0.6))) for i, p in enumerate(batters)
    ]
    extras = rng.randint(4, 14)
    if target is not None and chase_wins is not None:
        total = sum(runs) + extras
        if chase_wins and total <= target:
            runs[0] += target - total + rng.randint(1, 6)
        elif not chase_wins and total >= target:
            excess = total - target + rng.randint(1, 15)
            for i in sorted(range(len(runs)), key=lambda k: -runs[k]):
                cut = min(runs[i], excess)
                runs[i] -= cut
                excess -= cut
                if excess <= 0:
                    break
    total = sum(runs) + extras
    max_balls = overs * 6
    balls_used = max_balls if target is None or not chase_wins else rng.randint(max(6, max_balls - 24), max_balls)
    for i, (p, r) in enumerate(zip(batters, runs, strict=True)):
        sr = max(55.0, rng.gauss(118 * p["skill"], 25))
        balls = max(1, min(max_balls, round(100 * r / sr))) if r else rng.randint(1, 6)
        fours, sixes = _boundaries(r, rng)
        out = i < wickets
        lines[p["id"]] = {"batting": {"runs": r, "balls": balls, "fours": fours, "sixes": sixes, "out": out}}
    # bowling: whole overs, at most a fifth of the innings each (rounded up)
    quota = -(-overs // 5)
    bowlers = sorted(bowl, key=lambda p: (p["role"] not in ("bowler", "all_rounder"), -p["skill"]))[:6]
    overs_left = balls_used // 6
    alloc: dict[str, int] = {}
    while overs_left > 0 and bowlers:
        for b in bowlers:
            if overs_left == 0:
                break
            if alloc.get(b["id"], 0) < quota:
                alloc[b["id"]] = alloc.get(b["id"], 0) + 1
                overs_left -= 1
        if all(v >= quota for v in alloc.values()) and len(alloc) == len(bowlers):
            break
    conceded_pool = total - extras
    weights = {k: v * (1.4 - next(b["skill"] for b in bowlers if b["id"] == k) * 0.4) for k, v in alloc.items()}
    wsum = sum(weights.values()) or 1
    runouts = 1 if wickets >= 4 and rng.random() < 0.4 else 0
    bowler_wkts = wickets - runouts
    wk_weights = [next(b["skill"] for b in bowlers if b["id"] == k) ** 2 for k in alloc]
    wk_alloc = dict.fromkeys(alloc, 0)
    for _ in range(bowler_wkts):
        wk_alloc[rng.choices(list(alloc), wk_weights)[0]] += 1
    given = 0
    for idx, (k, ov) in enumerate(alloc.items()):
        conceded = round(conceded_pool * weights[k] / wsum) if idx < len(alloc) - 1 else conceded_pool - given
        conceded = max(0, min(conceded, conceded_pool - given))
        given += conceded
        lines.setdefault(k, {})["bowling"] = {"balls": ov * 6, "runs": conceded, "wickets": wk_alloc[k], "maidens": 0}
    # fielding: ~55% of bowler wickets caught, plus run-outs
    catches = sum(1 for _ in range(bowler_wkts) if rng.random() < 0.55)
    fielders = [p["id"] for p in bowl]
    for _ in range(catches):
        f = rng.choice(fielders)
        lines.setdefault(f, {}).setdefault("fielding", {"catches": 0, "run_outs": 0, "stumpings": 0})["catches"] += 1
    for _ in range(runouts):
        f = rng.choice(fielders)
        lines.setdefault(f, {}).setdefault("fielding", {"catches": 0, "run_outs": 0, "stumpings": 0})["run_outs"] += 1
    return {"runs": total, "wickets": wickets, "balls": balls_used}, lines


def scorecard(
    home: tuple[str, list[dict[str, Any]]], away: tuple[str, list[dict[str, Any]]], overs: int, rng: random.Random
) -> dict[str, Any]:
    (h_id, h_xi), (a_id, a_xi) = home, away
    h_str = sum(p["skill"] for p in h_xi) / len(h_xi)
    a_str = sum(p["skill"] for p in a_xi) / len(a_xi)
    first, second = ((h_id, h_xi), (a_id, a_xi)) if rng.random() < 0.5 else ((a_id, a_xi), (h_id, h_xi))
    p_second = 1 / (
        1
        + 10
        ** (
            -(sum(p["skill"] for p in second[1]) / len(second[1]) - sum(p["skill"] for p in first[1]) / len(first[1]))
            * 4
        )
    )
    del h_str, a_str
    chase_wins = rng.random() < p_second
    i1, l1 = innings(first[1], second[1], overs, rng, None, None)
    i2, l2 = innings(second[1], first[1], overs, rng, i1["runs"], chase_wins)
    players = []
    for tid, xi in (first, second):
        for p in xi:
            line = {**l1.get(p["id"], {}), **l2.get(p["id"], {})}
            # merge fielding from both innings dicts (a player fields in one innings only)
            players.append(
                {
                    "user_id": p["id"],
                    "team_id": tid,
                    **({"batting": line["batting"]} if "batting" in line else {}),
                    **({"bowling": line["bowling"]} if "bowling" in line else {}),
                    "fielding": line.get("fielding", {"catches": 0, "run_outs": 0, "stumpings": 0}),
                }
            )
    winner = second[0] if chase_wins else first[0]
    return {
        "result_type": "won",
        "winner_team_id": winner,
        "innings": [{"batting_team_id": first[0], **i1}, {"batting_team_id": second[0], **i2}],
        "players": players,
        "notes": "DEMO data generated for testing",
    }


async def play_season(
    s: Any, container: Any, teams: dict[str, tuple[str, list[str]]], fixtures: list[tuple[str, str, int]]
) -> None:
    """``teams``: team key -> (captain key, member keys incl. captain). ``fixtures``: (home, away, days_ago)."""
    rng = random.Random(2026)
    skill: dict[str, float] = {}
    roles: dict[str, str] = {}
    async for p in container.mongo["player_profiles"].find({}, {"user_id": 1, "primary_role": 1}):
        roles[str(p["user_id"])] = p.get("primary_role", "batsman")
    for i, (home, away, days_ago) in enumerate(sorted(fixtures, key=lambda f: -f[2])):
        fmt, overs = FORMATS[i % len(FORMATS)]
        h_cap, a_cap = teams[home][0], teams[away][0]
        start = datetime.now(UTC) + timedelta(days=30 + i, hours=2)
        ch = await s.call(
            "POST",
            "/challenges",
            h_cap,
            json={
                "from_team_id": s.ids[home],
                "to_team_id": s.ids[away],
                "message": "DEMO fixture",
                "proposal": {
                    "start_at": start.isoformat(),
                    "format": fmt,
                    "venue": {"name": "Noida Stadium Cricket Ground", "area": "Sector 21A", "city": "Noida"},
                },
            },
        )
        await container.mongo["team_challenges"].update_one({"_id": ObjectId(ch["id"])}, {"$set": {"is_demo": True}})
        await s.call("POST", f"/challenges/{ch['id']}/accept", a_cap)
        ch = await s.call("POST", f"/challenges/{ch['id']}/confirm", h_cap)
        played = (datetime.now(UTC) - timedelta(days=days_ago)).replace(hour=1, minute=30, second=0, microsecond=0)
        await container.mongo["fixtures"].update_one(
            {"_id": ObjectId(ch["fixture_id"])}, {"$set": {"start_at": played, "is_demo": True}}
        )
        await container.mongo["team_challenges"].update_one(
            {"_id": ObjectId(ch["id"])},
            {"$set": {"proposal.start_at": played, "history.$[].proposal.start_at": played}},
        )

        def xi(team: str, exclude: set[str] = frozenset()) -> list[dict[str, Any]]:  # type: ignore[assignment]
            out = []
            for key in teams[team][1][:11]:
                uid = s.ids[key]
                if uid in exclude:
                    continue
                skill.setdefault(
                    uid, max(0.55, min(1.6, rng.gauss(1.0 + (0.12 if team in ("kings", "techxi") else 0), 0.22)))
                )
                out.append({"id": uid, "skill": skill[uid], "role": roles.get(uid, "batsman")})
            rng.shuffle(out)
            out.sort(key=_bat_order)  # specialists bat lower
            return out

        home_xi = xi(home)
        card = scorecard((s.ids[home], home_xi), (s.ids[away], xi(away, {row["id"] for row in home_xi})), overs, rng)
        await s.call("POST", f"/fixtures/{ch['fixture_id']}/result", h_cap, json=card)
        await s.call("POST", f"/fixtures/{ch['fixture_id']}/verify", a_cap)
