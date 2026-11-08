"""Invitation state machine (FR-INV-1).

Invite (captain → player):  pending → accepted (player) → confirmed (captain)
Join request (player → captain): pending → confirmed (captain accepts)
Any non-final state may be cancelled; pending may be rejected or expire.
A confirmed invitation is cancelled when the player withdraws, is removed or replaced.
"""

from app.common.enums import InvitationDirection as D
from app.common.enums import InvitationStatus as S
from app.core.exceptions import BusinessRuleViolation

TRANSITIONS: dict[S, frozenset[S]] = {
    S.PENDING: frozenset({S.ACCEPTED, S.REJECTED, S.EXPIRED, S.CANCELLED, S.CONFIRMED}),
    S.ACCEPTED: frozenset({S.CONFIRMED, S.CANCELLED}),
    S.CONFIRMED: frozenset({S.CANCELLED}),
    S.REJECTED: frozenset(),
    S.EXPIRED: frozenset(),
    S.CANCELLED: frozenset(),
}

#: Statuses that hold a "slot" in the uniqueness index (``is_active``).
ACTIVE = frozenset({S.PENDING, S.ACCEPTED, S.CONFIRMED})


def is_active(status: S | str) -> bool:
    return S(status) in ACTIVE


def ensure_transition(current: S | str, target: S | str, direction: D | str) -> None:
    cur, tgt, d = S(current), S(target), D(direction)
    allowed = TRANSITIONS[cur]
    # Captain-sent invites must be accepted by the player before confirmation.
    if d == D.INVITE and cur == S.PENDING and tgt == S.CONFIRMED:
        allowed = frozenset()
    # Join requests are not "accepted" by the requester; the captain confirms directly.
    if d == D.REQUEST and tgt == S.ACCEPTED:
        allowed = frozenset()
    if tgt not in allowed:
        raise BusinessRuleViolation(
            f"Invitation cannot move from '{cur.value}' to '{tgt.value}'",
            code="INVALID_INVITATION_TRANSITION",
            details=[{"from": cur.value, "to": tgt.value, "direction": d.value}],
        )
