# OneShort rating methodology

Code: `backend/app/modules/rating_engine/` (pure, no database) and `backend/app/modules/competition/skill.py` (applies it).

## What counts
Only results with status **confirmed** count. A result is confirmed when the opposing team's captain or vice-captain verifies it, or when an admin resolves a dispute. Submitted, disputed and voided results never touch ratings. CricHeroes and other imported stats are labelled "provided by the team" and are never ranked. Applying a result is idempotent (the `ratings_applied` flag is set in the same transaction). Voiding an already-applied result triggers `rebuild_all()`, which replays every confirmed fixture in chronological order.

## Model
| Layer | Method |
|---|---|
| Team rating | Glicko-2 (Glickman 2012). One match is one rating period. Win = 1, tie = ½, loss = 0; no-result is ignored. |
| Player disciplines | Separate Glicko-2 ratings for batting, bowling, fielding and match impact, overall and per format. Each match's cricket performance score in [0, 1] (0.5 = par) is played against an opposition strength of `1500 + 0.5 × (opponent team rating − own team rating)` with RD 80. |
| Inactivity | RD grows by `sqrt(φ² + periods·σ²)`, with one period per 30 days. |
| Composite | Role-weighted mean of the disciplines the player has data for (weights renormalised). The composite RD is the weighted mean RD (conservative). |
| Ranking | rating − 2 × RD, so limited history ranks lower until proven. |
| Provisional | Fewer than 5 verified matches, or composite RD above 140. Teams: fewer than 5 matches, or RD above 160. |
| Confidence | (350 − RD) / (350 − 30), clipped to [0, 1]. |

**Why the opposition is relative.** The first version used the raw opposing team rating. Against a side rated 400 points lower, the expected performance score was about 0.9, which is nearly impossible in cricket. As a result, a good 27 off 17 lost a player 45 points. The relative, damped strength keeps "beat a stronger side, gain more" without punishing good innings against weak sides.

### Performance scores (format-aware; pars scale with overs)
- **Batting:** 50% runs vs par (12 + 0.6 × overs), 25% strike rate vs format par (squared ratio, damped below 12 balls), 15% share of the team total, 10% boundary runs; +0.03 for a not-out half-par innings. A player who didn't bat gets no score.
- **Bowling:** 55% wickets vs expected (format wicket rate × overs), 45% economy vs format par (ratio^1.5, damped below 2 overs), plus up to +0.06 for maidens.
- **Fielding:** (d + 0.3) / (d + 0.7), where d = catches + 1.5 × run-outs + stumpings. Zero contributions score about 0.43, so the average fielder sits near par.
- **Impact:** role-weighted blend of the above ± 0.04 for a team win or loss.

### Initial weights (configurable in `config.py`; must be calibrated on real data)
| Role | Bat | Bowl | Field | Impact |
|---|---|---|---|---|
| All-rounder | 35% | 35% | 15% | 15% |
| Batter | 55% | 10% | 15% | 20% |
| Bowler | 10% | 55% | 15% | 20% |
| Wicketkeeper | 50% | 5% | 25% | 20% |

### Leaderboard categories
- Overall, Batter, Bowler and Fielder use the conservative discipline score.
- All-rounder uses the harmonic mean of the conservative batting and bowling scores, and needs at least 3 matches with each.
- Most Consistent uses 1 − stdev(last 10 impact scores) / 0.25, and needs at least 5 matches.
- Rising Stars ranks the overall gain over 30 days, among players with at least 3 matches and a positive gain.
- Format boards need at least 3 verified matches in that format.

Rank movement compares the current order with the order using each player's score before their last match.

## Explanations
`explain.py` fills fixed templates from the stored scorecard and the actual before/after ratings. For example: "Batting +10: 42 off 26 against Mayur Vihar Mavericks, a higher-rated side". No language model is involved.

## Phase 2 (not active)
`model.py` defines a `PerformanceModel` protocol (predict + explain/SHAP); `NoModel` is the only implementation. A CatBoost or LightGBM model may be added only after training on real, verified, time-ordered data with temporal validation (train on earlier seasons, validate on later ones, no leakage). Official ratings never depend on it.

## Tests
- `tests/unit/test_rating_engine.py` (12 tests):
  - reproduces Glickman's reference example (1464.06 / 151.52 / 0.05999)
  - a par score against an equal opponent leaves the rating unchanged
  - a stronger opponent rewards the same performance more
  - RD inflation is capped
  - performance scores are format-aware and monotonic
  - the composite is role-aware and drops unused disciplines
  - the conservative score ranks a proven player above a lucky newcomer
  - consistency needs history
  - explanations quote the real numbers
- `tests/api/test_competition.py`: disputed results leave ratings untouched; verified results move winners up and losers down; admin void recomputes ratings; admin confirm applies them.
