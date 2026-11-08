"""Fee distribution engine: pure integer arithmetic on paise (FR-FEE-2/3).

    Individual contribution = Eligible total expenses / Number of eligible players

Rules
- Only payees who are not exempted share the cost ("eligible players").
- Manual adjustments pin a player's amount; the remainder is split equally among the
  other eligible players.
- Rounding:
  * ``exact_paise``: floor division, leftover paise distributed one-by-one in a
    deterministic order, so the sum of shares is exactly the total.
  * ``round_up_rupee``: each equal share is rounded UP to a whole rupee; the surplus is
    reported as ``rounding_adjustment_paise`` (the captain may refund or keep it as kitty).
"""

from dataclasses import dataclass, field

from app.common.enums import ContributionType, RoundingMode
from app.core.exceptions import BusinessRuleViolation


@dataclass(frozen=True)
class Participant:
    player_id: str
    name: str
    contribution_type: ContributionType
    exempt: bool = False
    fixed_amount_paise: int | None = None  # manual adjustment


@dataclass(frozen=True)
class Line:
    player_id: str
    name: str
    contribution_type: ContributionType
    eligible: bool
    exempt: bool
    adjusted: bool
    amount_paise: int


@dataclass(frozen=True)
class Calculation:
    total_expenses_paise: int
    eligible_players: int
    individual_contribution_paise: int
    rounding_mode: RoundingMode
    rounding_adjustment_paise: int
    total_assigned_paise: int
    lines: list[Line] = field(default_factory=list)


def calculate(total_paise: int, participants: list[Participant], mode: RoundingMode) -> Calculation:
    if total_paise < 0:
        raise BusinessRuleViolation("Total expenses cannot be negative", code="INVALID_TOTAL")
    ids = [p.player_id for p in participants]
    if len(ids) != len(set(ids)):
        raise BusinessRuleViolation("Duplicate participant", code="DUPLICATE_PARTICIPANT")

    eligible = [p for p in participants if p.contribution_type == ContributionType.PAYEE and not p.exempt]
    for p in participants:
        if p.fixed_amount_paise is not None:
            if p.fixed_amount_paise < 0:
                raise BusinessRuleViolation("Adjusted amount cannot be negative", code="INVALID_ADJUSTMENT")
            if p not in eligible:
                raise BusinessRuleViolation(
                    f"{p.name} is not a payee; remove the adjustment or make them a payee",
                    code="ADJUSTMENT_ON_NON_PAYEE",
                )
    fixed = [p for p in eligible if p.fixed_amount_paise is not None]
    shared = sorted((p for p in eligible if p.fixed_amount_paise is None), key=lambda p: p.player_id)
    fixed_total = sum(p.fixed_amount_paise or 0 for p in fixed)
    remaining = total_paise - fixed_total
    if remaining < 0:
        raise BusinessRuleViolation("Manual adjustments exceed the total expenses", code="ADJUSTMENTS_EXCEED_TOTAL")
    if remaining > 0 and not shared:
        if not eligible:
            raise BusinessRuleViolation(
                "There are no eligible (payee) players to share the expenses", code="NO_ELIGIBLE_PLAYERS"
            )
        raise BusinessRuleViolation(
            "Manual adjustments do not cover the total expenses", code="ADJUSTMENTS_DO_NOT_COVER_TOTAL"
        )

    amounts: dict[str, int] = {p.player_id: p.fixed_amount_paise or 0 for p in fixed}
    rounding_adjustment = 0
    individual = 0
    if shared:
        n = len(shared)
        if mode == RoundingMode.EXACT_PAISE:
            base, leftover = divmod(remaining, n)
            individual = base
            for i, p in enumerate(shared):
                amounts[p.player_id] = base + (1 if i < leftover else 0)
        else:
            share = -(-remaining // n)  # ceil
            share = -(-share // 100) * 100  # ceil to whole rupee
            individual = share
            for p in shared:
                amounts[p.player_id] = share
            rounding_adjustment = share * n - remaining

    lines = [
        Line(
            player_id=p.player_id,
            name=p.name,
            contribution_type=p.contribution_type,
            eligible=p in eligible,
            exempt=p.exempt,
            adjusted=p.fixed_amount_paise is not None,
            amount_paise=amounts.get(p.player_id, 0),
        )
        for p in participants
    ]
    assigned = sum(line.amount_paise for line in lines)
    assert assigned == total_paise + rounding_adjustment, "fee calculation invariant violated"
    return Calculation(
        total_expenses_paise=total_paise,
        eligible_players=len(eligible),
        individual_contribution_paise=individual,
        rounding_mode=mode,
        rounding_adjustment_paise=rounding_adjustment,
        total_assigned_paise=assigned,
        lines=lines,
    )
