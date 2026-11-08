"""Glicko-2 (Glickman, 2012: "Example of the Glicko-2 system").

Each verified match is treated as one rating period. Between matches, rating deviation (RD)
grows with inactivity (``inflate``), so a player who hasn't played for months becomes less
certain again. Scores may be fractional in [0, 1]: we use that for cricket performance scores,
where 0.5 means "par performance against this opposition".
"""

import math
from dataclasses import dataclass

SCALE = 173.7178
DEFAULT_RATING = 1500.0
DEFAULT_RD = 350.0
DEFAULT_VOL = 0.06
MIN_RD = 30.0
TAU = 0.5  # system constant: constrains volatility change (Glickman suggests 0.3-1.2)
_EPS = 1e-6


@dataclass(frozen=True)
class Glicko:
    rating: float = DEFAULT_RATING
    rd: float = DEFAULT_RD
    vol: float = DEFAULT_VOL

    @property
    def mu(self) -> float:
        return (self.rating - DEFAULT_RATING) / SCALE

    @property
    def phi(self) -> float:
        return self.rd / SCALE


def _g(phi: float) -> float:
    return 1.0 / math.sqrt(1.0 + 3.0 * phi * phi / (math.pi * math.pi))


def expected_score(player: Glicko, opponent: Glicko) -> float:
    return 1.0 / (1.0 + math.exp(-_g(opponent.phi) * (player.mu - opponent.mu)))


def inflate(player: Glicko, periods: float) -> Glicko:
    """Increase RD for ``periods`` rating periods without games (capped at the default RD)."""
    if periods <= 0:
        return player
    phi = math.sqrt(player.phi**2 + periods * player.vol**2)
    return Glicko(player.rating, min(DEFAULT_RD, phi * SCALE), player.vol)


def update(player: Glicko, results: list[tuple[Glicko, float]], tau: float = TAU) -> Glicko:
    """One Glicko-2 rating period. ``results`` is a list of (opponent, score in [0, 1])."""
    if not results:
        return inflate(player, 1)
    mu, phi, sigma = player.mu, player.phi, player.vol
    v_inv = 0.0
    delta_sum = 0.0
    for opp, score in results:
        s = min(1.0, max(0.0, score))
        g = _g(opp.phi)
        e = 1.0 / (1.0 + math.exp(-g * (mu - opp.mu)))
        v_inv += g * g * e * (1.0 - e)
        delta_sum += g * (s - e)
    v = 1.0 / v_inv
    delta = v * delta_sum

    # Step 5: new volatility via the Illinois algorithm.
    a = math.log(sigma * sigma)

    def f(x: float) -> float:
        ex = math.exp(x)
        return (ex * (delta * delta - phi * phi - v - ex)) / (2.0 * (phi * phi + v + ex) ** 2) - (x - a) / (tau * tau)

    big_a = a
    if delta * delta > phi * phi + v:
        big_b = math.log(delta * delta - phi * phi - v)
    else:
        k = 1
        while f(a - k * tau) < 0:
            k += 1
        big_b = a - k * tau
    fa, fb = f(big_a), f(big_b)
    for _ in range(100):
        if abs(big_b - big_a) <= _EPS:
            break
        c = big_a + (big_a - big_b) * fa / (fb - fa)
        fc = f(c)
        if fc * fb <= 0:
            big_a, fa = big_b, fb
        else:
            fa /= 2.0
        big_b, fb = c, fc
    new_sigma = math.exp(big_a / 2.0)

    phi_star = math.sqrt(phi * phi + new_sigma * new_sigma)
    new_phi = 1.0 / math.sqrt(1.0 / (phi_star * phi_star) + 1.0 / v)
    new_mu = mu + new_phi * new_phi * delta_sum
    return Glicko(
        rating=new_mu * SCALE + DEFAULT_RATING,
        rd=max(MIN_RD, min(DEFAULT_RD, new_phi * SCALE)),
        vol=new_sigma,
    )
