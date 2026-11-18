"""The WhatsApp fee message: every name carries an amount, and pasted lists in the instructions read line by line."""

from app.modules.settlements.message import FeeLine, FeeMessage, OtherDue, compose


def _msg(**kw: object) -> FeeMessage:
    base: dict = {
        "title": "Sunday T20",
        "team": None,
        "when": None,
        "venue": None,
        "expenses": [("Ground", 190000)],
        "total_paise": 190000,
        "per_head_paise": 47500,
        "payers": 4,
        "rounding_paise": 0,
        "lines": [],
        "instructions": None,
    }
    return FeeMessage(**{**base, **kw})


def test_every_name_has_an_amount_even_when_shares_are_equal() -> None:
    text = compose(
        _msg(
            lines=[
                FeeLine(name="Nitin Kumar", amount_paise=47500, eligible=True),
                FeeLine(name="Prashant Jha", amount_paise=151700, eligible=True, prior_paise=104200, share=47500),
                FeeLine(name="Golu Tyagi", amount_paise=0, eligible=False),
            ]
        )
    )
    assert "1. Nitin Kumar: ₹475" in text
    assert "2. Prashant Jha: *₹1,517* (₹475 + ₹1,042 previous dues)" in text
    assert "1. Golu Tyagi: ₹0 · plays free" in text


def test_pending_list_typed_into_instructions_reads_one_per_line_and_others_are_listed() -> None:
    text = compose(
        _msg(
            upi_id="captain@ybl",
            instructions="1. Ajay Sinha - 600 2. Ayush Boss -  950 3. Shanky - 1360",
            others=[OtherDue("Ajay Sinha", 60000, "Previous dues"), OtherDue("Mohit", -20000, "Advance")],
        )
    )
    assert "UPI ID: *captain@ybl*\n1. Ajay Sinha - 600\n2. Ayush Boss -  950\n3. Shanky - 1360" in text
    assert "📒 *Still pending, not playing this match (₹600)*\n• Ajay Sinha: ₹600 · Previous dues" in text
    assert "💚 *Advance held, not playing this match*\n• Mohit: ₹200 in advance" in text
