"""WhatsApp text for a match fee split: one tidy message a captain pastes into the team group.

WhatsApp formatting only (``*bold*``, ``_italic_``), one emoji per section header, and players grouped by
what they need to do (pay, paid, free), so nobody has to hunt for their own name in a wall of text.
Pure functions: easy to test, and the same text whether it comes from a draft or a published split.
"""

from dataclasses import dataclass

DIVIDER = "━━━━━━━━━━━━━━"


def rupees(paise: int) -> str:
    r, p = divmod(paise, 100)
    return f"₹{r:,}" + (f".{p:02d}" if p else "")


@dataclass(frozen=True)
class FeeLine:
    name: str
    amount_paise: int
    eligible: bool  # shares the cost (not exempt / playing free)
    status: str | None = None  # pending / paid / exempted / disputed once published; None for a draft
    guest: bool = False


@dataclass(frozen=True)
class FeeMessage:
    title: str
    team: str | None
    when: str | None
    venue: str | None
    expenses: list[tuple[str, int]]
    total_paise: int
    per_head_paise: int
    payers: int
    rounding_paise: int
    lines: list[FeeLine]
    instructions: str | None
    upi_id: str | None = None
    revised_reason: str | None = None
    revised: bool = False
    link: str | None = None


def _who(line: FeeLine) -> str:
    return line.name


def compose(m: FeeMessage) -> str:
    out: list[str] = [f"🏏 *MATCH FEE{' (UPDATED)' if m.revised else ''}*", f"*{m.title}*"]
    if m.team and m.team not in m.title:
        out.append(m.team)
    if m.when:
        out.append(f"📅 {m.when}")
    if m.venue:
        out.append(f"📍 {m.venue}")
    if m.revised and m.revised_reason:
        out.append(f"✏️ _{m.revised_reason}_")

    out += ["", "💰 *Expenses*"]
    out += [f"• {label}: {rupees(amount)}" for label, amount in m.expenses]
    out += [DIVIDER, f"*Total: {rupees(m.total_paise)}*"]

    pay = [line for line in m.lines if line.eligible]
    amounts = {line.amount_paise for line in pay}
    equal = len(amounts) <= 1
    # Exact rounding hands the leftover paise out one by one, so shares can differ by a paisa: still "each".
    even = bool(pay) and max(amounts) - min(amounts) <= 1
    out += ["", f"👥 *Split between {m.payers} player{'' if m.payers == 1 else 's'}*"]
    if even:
        out.append(f"*{rupees(max(amounts))} each*" if equal else f"*About {rupees(max(amounts))} each*")
    if m.rounding_paise:
        out.append(f"_Rounded up to whole rupees ({rupees(m.rounding_paise)} extra kept for the kitty)_")

    def block(header: str, rows: list[FeeLine], show_amount: bool = True) -> None:
        if not rows:
            return
        out.extend(["", f"{header} ({len(rows)})"])
        for i, line in enumerate(rows, 1):
            out.append(f"{i}. {_who(line)}" + (f": {rupees(line.amount_paise)}" if show_amount else ""))

    published = any(line.status for line in m.lines)
    if published:
        block("⏳ *To pay*", [line for line in pay if line.status in ("pending", "disputed")])
        block("✅ *Paid*", [line for line in pay if line.status == "paid"])
        block("🆓 *Not paying*", [line for line in m.lines if not line.eligible or line.status == "exempted"], False)
    else:
        block("📋 *Who pays*", pay, show_amount=not even)
        block("🆓 *Not paying*", [line for line in m.lines if not line.eligible], False)

    if m.upi_id or m.instructions:
        out += ["", "💳 *How to pay*"]
        if m.upi_id:
            out.append(f"UPI ID: *{m.upi_id}*")
        if m.instructions and m.instructions != m.upi_id:
            out.append(m.instructions)
    out += ["", "🙏 Please pay before the match and reply *paid* here once done."]
    if m.link:
        out += ["", f"🔗 Track it on OneShort: {m.link}"]
    return "\n".join(out)
