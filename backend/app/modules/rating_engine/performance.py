"""Cricket-specific match performance scores.

Each function turns one verified scorecard line into a score in [0, 1], where 0.5 means a
par performance for the format. Pars scale with the number of overs, so 30 runs in a T10
counts for more than 30 runs in a 40-over game. These scores feed Glicko-2 as fractional
results against the opposing team's rating, which is how quality of opposition enters:
the same 40 runs earns more rating against a stronger side than against a weaker one.

A player who did not bat (or bowl) gets no score for that discipline, so they are not
penalised for not being needed.
"""

from dataclasses import dataclass

from app.modules.rating_engine.config import RESULT_IMPACT_BONUS


@dataclass(frozen=True)
class BattingLine:
    runs: int
    balls: int
    fours: int = 0
    sixes: int = 0
    out: bool = True


@dataclass(frozen=True)
class BowlingLine:
    balls: int
    runs: int
    wickets: int
    maidens: int = 0


@dataclass(frozen=True)
class FieldingLine:
    catches: int = 0
    run_outs: int = 0
    stumpings: int = 0


def _interp(overs: float, table: list[tuple[float, float]]) -> float:
    if overs <= table[0][0]:
        return table[0][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:], strict=False):
        if overs <= x1:
            return y0 + (y1 - y0) * (overs - x0) / (x1 - x0)
    return table[-1][1]


def par_runs(overs: float) -> float:
    return 12.0 + 0.6 * overs


def par_strike_rate(overs: float) -> float:
    return _interp(overs, [(10, 150), (20, 130), (30, 105), (40, 95), (50, 85)])


def par_economy(overs: float) -> float:
    return _interp(overs, [(10, 9.5), (20, 8.0), (30, 6.5), (40, 6.0), (50, 5.5)])


def par_wickets_per_over(overs: float) -> float:
    return _interp(overs, [(10, 0.42), (20, 0.36), (50, 0.25)])


def _ratio_score(r: float) -> float:
    """Maps a ratio to [0, 1): 0 -> 0, 1 (par) -> 0.5, 3x par -> 0.75."""
    r = max(0.0, r)
    return r / (1.0 + r)


def _clip(x: float) -> float:
    return min(0.98, max(0.02, x))


def batting_score(line: BattingLine, team_total: int, overs: float) -> float | None:
    if line.balls <= 0 and not line.out:
        return None  # did not bat / faced nothing
    runs_c = _ratio_score(line.runs / par_runs(overs))
    sr = 100.0 * line.runs / line.balls if line.balls else 0.0
    sr_c = _ratio_score((sr / par_strike_rate(overs)) ** 2)
    sr_c = 0.5 + (sr_c - 0.5) * min(1.0, line.balls / 12.0)  # few balls -> SR says little
    share_c = _ratio_score(6.0 * line.runs / team_total) if team_total > 0 else 0.5
    boundary_runs = 4 * line.fours + 6 * line.sixes
    boundary_c = _ratio_score(boundary_runs / max(1.0, 0.45 * par_runs(overs))) if line.runs else 0.0
    score = 0.50 * runs_c + 0.25 * sr_c + 0.15 * share_c + 0.10 * boundary_c
    if not line.out and line.runs >= 0.5 * par_runs(overs):
        score += 0.03
    return _clip(score)


def bowling_score(line: BowlingLine, overs: float) -> float | None:
    if line.balls <= 0:
        return None
    bowled = line.balls / 6.0
    expected = bowled * par_wickets_per_over(overs)
    wk_c = _ratio_score((line.wickets + 0.4) / (expected + 0.4))
    econ = line.runs / bowled
    econ_c = _ratio_score((par_economy(overs) / max(0.5, econ)) ** 1.5)
    econ_c = 0.5 + (econ_c - 0.5) * min(1.0, line.balls / 12.0)
    score = 0.55 * wk_c + 0.45 * econ_c + min(0.06, 0.02 * line.maidens)
    return _clip(score)


def fielding_score(line: FieldingLine) -> float:
    d = line.catches + 1.5 * line.run_outs + line.stumpings
    return _clip((d + 0.3) / (d + 0.7))


def impact_score(scores: dict[str, float | None], weights: dict[str, float], result: str) -> float:
    """Role-weighted blend of the disciplines the player actually took part in, nudged by
    the team result (``won`` | ``lost`` | ``tied`` | ``no_result``)."""
    used = {k: v for k, v in scores.items() if v is not None and weights.get(k, 0) > 0}
    if not used:
        base = 0.5
    else:
        total = sum(weights[k] for k in used)
        base = sum(weights[k] * v for k, v in used.items()) / total
    base += {"won": RESULT_IMPACT_BONUS, "lost": -RESULT_IMPACT_BONUS}.get(result, 0.0)
    return _clip(base)
