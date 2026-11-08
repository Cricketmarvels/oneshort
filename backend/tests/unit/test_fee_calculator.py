import pytest

from app.common.enums import ContributionType as C
from app.common.enums import RoundingMode as R
from app.core.exceptions import BusinessRuleViolation
from app.modules.settlements.calculator import Participant, calculate


def players(n: int, **kw: object) -> list[Participant]:
    return [
        Participant(player_id=f"p{i:02d}", name=f"P{i}", contribution_type=C.PAYEE, **kw)  # type: ignore[arg-type]
        for i in range(n)
    ]


def test_frd_example_4000_over_10() -> None:
    calc = calculate(400_000, players(10), R.EXACT_PAISE)
    assert calc.individual_contribution_paise == 40_000  # ₹400
    assert calc.eligible_players == 10
    assert all(line.amount_paise == 40_000 for line in calc.lines)


def test_exact_paise_distributes_remainder_and_sums_exactly() -> None:
    calc = calculate(100_000, players(3), R.EXACT_PAISE)  # ₹1000 / 3
    amounts = sorted(line.amount_paise for line in calc.lines)
    assert amounts == [33_333, 33_333, 33_334]
    assert sum(amounts) == 100_000 and calc.rounding_adjustment_paise == 0


def test_round_up_rupee_reports_surplus() -> None:
    calc = calculate(100_000, players(3), R.ROUND_UP_RUPEE)
    assert {line.amount_paise for line in calc.lines} == {33_400}
    assert calc.rounding_adjustment_paise == 200  # ₹2 surplus
    assert calc.total_assigned_paise == 100_200


def test_non_payee_and_exempt_do_not_share() -> None:
    ps = players(9) + [
        Participant("guest", "Guest", C.NON_PAYEE),
        Participant("junior", "Junior", C.PAYEE, exempt=True),
    ]
    calc = calculate(450_000, ps, R.EXACT_PAISE)
    assert calc.eligible_players == 9
    assert calc.individual_contribution_paise == 50_000
    lines = {line.player_id: line for line in calc.lines}
    assert lines["guest"].amount_paise == 0 and not lines["guest"].eligible
    assert lines["junior"].amount_paise == 0 and lines["junior"].exempt


def test_manual_adjustment_redistributes_remainder() -> None:
    ps = players(4)
    ps[0] = Participant("p00", "P0", C.PAYEE, fixed_amount_paise=10_000)
    calc = calculate(100_000, ps, R.EXACT_PAISE)
    lines = {line.player_id: line.amount_paise for line in calc.lines}
    assert lines["p00"] == 10_000
    assert sorted(v for k, v in lines.items() if k != "p00") == [30_000, 30_000, 30_000]


@pytest.mark.parametrize(
    "total,parts,code",
    [
        (100_000, [Participant("a", "A", C.NON_PAYEE)], "NO_ELIGIBLE_PLAYERS"),
        (100_000, [Participant("a", "A", C.PAYEE, fixed_amount_paise=200_000)], "ADJUSTMENTS_EXCEED_TOTAL"),
        (100_000, [Participant("a", "A", C.PAYEE, fixed_amount_paise=50_000)], "ADJUSTMENTS_DO_NOT_COVER_TOTAL"),
        (
            100_000,
            [Participant("a", "A", C.NON_PAYEE, fixed_amount_paise=1), Participant("b", "B", C.PAYEE)],
            "ADJUSTMENT_ON_NON_PAYEE",
        ),
    ],
)
def test_invalid_inputs(total: int, parts: list[Participant], code: str) -> None:
    with pytest.raises(BusinessRuleViolation) as e:
        calculate(total, parts, R.EXACT_PAISE)
    assert e.value.code == code


def test_zero_expense_is_allowed() -> None:
    calc = calculate(0, players(5), R.EXACT_PAISE)
    assert calc.total_assigned_paise == 0


@pytest.mark.parametrize("total", [1, 7, 99, 101, 12_345_67, 9_999_999])
@pytest.mark.parametrize("n", [1, 2, 3, 7, 11, 22])
def test_invariant_sum_equals_total(total: int, n: int) -> None:
    exact = calculate(total, players(n), R.EXACT_PAISE)
    assert exact.total_assigned_paise == total
    up = calculate(total, players(n), R.ROUND_UP_RUPEE)
    assert up.total_assigned_paise - total == up.rounding_adjustment_paise
    assert 0 <= up.rounding_adjustment_paise < 100 * n
