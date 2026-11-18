"""WhatsApp text for a match fee split: one tidy message a captain pastes into the team group.

WhatsApp formatting only (``*bold*``, ``_italic_``), one emoji per section header, and players grouped by
what they need to do (pay, paid, free), so nobody has to hunt for their own name in a wall of text.
Pure functions: easy to test, and the same text whether it comes from a draft or a published split.
"""

import re
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
    carried_paise: int = 0  # part of amount_paise that is unpaid fees from earlier matches
    carried_from: tuple[str, ...] | list[str] = ()  # e.g. "Match vs Wisteria (3 Nov)"
    share: int | None = None  # this match's share; defaults to amount minus earlier dues
    prior_paise: int = 0  # earlier balance kept outside OneShort: + still owed, - paid in advance
    prior_note: str | None = None

    @property
    def share_paise(self) -> int:
        return self.share if self.share is not None else self.amount_paise - self.carried_paise - self.prior_paise

    @property
    def extra(self) -> bool:
        return bool(self.carried_paise or self.prior_paise)

    @property
    def pays(self) -> bool:
        return self.eligible or self.amount_paise > 0


@dataclass(frozen=True)
class OtherDue:
    """Someone not playing this match who still owes (or holds an advance) from earlier."""

    name: str
    amount_paise: int
    note: str | None = None


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
    others: tuple[OtherDue, ...] | list[OtherDue] = ()


def _tidy(instructions: str) -> str:
    """A numbered list typed on one line ("1. Ajay - 600 2. Ayush - 950") goes one item per line."""
    return re.sub(r"\s+(?=\d{1,2}[.)]\s)", "\n", instructions.strip())


def _who(line: FeeLine) -> str:
    return line.name


def _amount(line: FeeLine) -> str:
    if not line.extra:
        return rupees(line.amount_paise)
    parts = [rupees(line.share_paise)]
    if line.carried_paise:
        parts.append(f"+ {rupees(line.carried_paise)} earlier")
    if line.prior_paise > 0:
        parts.append(f"+ {rupees(line.prior_paise)} {(line.prior_note or 'previous dues').lower()}")
    if line.prior_paise < 0:
        parts.append(f"- {rupees(-line.prior_paise)} advance")
    return f"*{rupees(line.amount_paise)}* ({' '.join(parts)})"


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

    pay = [line for line in m.lines if line.pays]
    amounts = {line.share_paise for line in m.lines if line.eligible}
    equal = len(amounts) <= 1
    # Exact rounding hands the leftover paise out one by one, so shares can differ by a paisa: still "each".
    even = bool(amounts) and max(amounts) - min(amounts) <= 1
    out += ["", f"👥 *Split between {m.payers} player{'' if m.payers == 1 else 's'}*"]
    if even:
        out.append(f"*{rupees(max(amounts))} each*" if equal else f"*About {rupees(max(amounts))} each*")
    if m.rounding_paise:
        out.append(f"_Rounded up to whole rupees ({rupees(m.rounding_paise)} extra kept for the kitty)_")

    owed = [line for line in m.lines if line.carried_paise or line.prior_paise > 0]
    if owed:
        total = sum(line.carried_paise + max(0, line.prior_paise) for line in owed)
        out += ["", f"📌 *Earlier unpaid fees added ({rupees(total)})*"]
        for line in owed:
            if line.carried_paise:
                source = ", ".join(line.carried_from)
                out.append(f"• {_who(line)}: {rupees(line.carried_paise)}" + (f" · {source}" if source else ""))
            if line.prior_paise > 0:
                out.append(f"• {_who(line)}: {rupees(line.prior_paise)} · {line.prior_note or 'Previous dues'}")
    advances = [line for line in m.lines if line.prior_paise < 0]
    if advances:
        out += ["", "💚 *Advance adjusted*"]
        for line in advances:
            covered = " (covers this match)" if line.amount_paise == 0 else ""
            out.append(f"• {_who(line)}: -{rupees(-line.prior_paise)} paid in advance{covered}")

    pending = [o for o in m.others if o.amount_paise > 0]
    if pending:
        out += ["", f"📒 *Still pending, not playing this match ({rupees(sum(o.amount_paise for o in pending))})*"]
        out += [f"• {o.name}: {rupees(o.amount_paise)}" + (f" · {o.note}" if o.note else "") for o in pending]
        out.append("_Please clear these too, or they'll be added to your next match fee._")
    credits = [o for o in m.others if o.amount_paise < 0]
    if credits:
        out += ["", "💚 *Advance held, not playing this match*"]
        out += [f"• {o.name}: {rupees(-o.amount_paise)} in advance" for o in credits]

    # Every name carries its amount, so nobody has to work out their own share from the header.
    def block(header: str, rows: list[FeeLine], free: bool = False) -> None:
        if not rows:
            return
        out.extend(["", f"{header} ({len(rows)})"])
        for i, line in enumerate(rows, 1):
            out.append(f"{i}. {_who(line)}: " + ("₹0 · plays free" if free else _amount(line)))

    published = any(line.status for line in m.lines)
    if published:
        block("⏳ *To pay*", [line for line in pay if line.status in ("pending", "disputed")])
        block("✅ *Paid*", [line for line in pay if line.status == "paid"])
        block("🆓 *Not paying*", [line for line in m.lines if not line.pays or line.status == "exempted"], free=True)
    else:
        block("📋 *Who pays*", pay)
        block("🆓 *Not paying*", [line for line in m.lines if not line.pays], free=True)

    if m.upi_id or m.instructions:
        out += ["", "💳 *How to pay*"]
        if m.upi_id:
            out.append(f"UPI ID: *{m.upi_id}*")
        if m.instructions and m.instructions != m.upi_id:
            out.append(_tidy(m.instructions))
    out += ["", "🙏 Please pay before the match and reply *paid* here once done."]
    if m.link:
        out += ["", f"🔗 Track it on OneShort: {m.link}"]
    return "\n".join(out)
