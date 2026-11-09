"""Phone numbers for seeded demo accounts.

They come from Ofcom's reserved drama range, +44 7700 900000 to 900999. These numbers are never assigned to real
subscribers, so a WhatsApp link or SMS aimed at a demo account can't reach a real person. Indian 10-digit mobile
numbers have no equivalent reserved range: any of them could belong to someone.

Layout (last three digits):
    001-009  named demo logins (captain, player, other captains)
    010-098  hand-made demo accounts
    099      moderation admin
    100-199  bulk players
    200-699  extra teams' captains and members
    700-999  spare (migration overflow)
"""

PREFIX = "+447700900"

CAPTAIN = f"{PREFIX}001"
PLAYER = f"{PREFIX}002"
ADMIN = f"{PREFIX}099"


def demo_mobile(slot: int) -> str:
    if not 0 <= slot <= 999:
        raise ValueError(f"demo number slot out of range: {slot}")
    return f"{PREFIX}{slot:03d}"


def is_demo_mobile(number: str | None) -> bool:
    return bool(number) and str(number).startswith(PREFIX) and len(str(number)) == len(PREFIX) + 3
