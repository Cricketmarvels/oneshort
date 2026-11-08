"""Match lifecycle state machine (FR-MAT-1).

Draft → Published → Recruiting → Squad Confirmed → Scheduled → In Progress → Completed,
with Cancelled reachable from every non-terminal state.

Back-transitions to Recruiting are allowed from Squad Confirmed / Scheduled when a
player withdraws or is removed (a vacancy re-opens recruitment).
"""

from app.common.enums import MatchStatus as S
from app.core.exceptions import BusinessRuleViolation

TRANSITIONS: dict[S, frozenset[S]] = {
    S.DRAFT: frozenset({S.PUBLISHED, S.CANCELLED}),
    S.PUBLISHED: frozenset({S.RECRUITING, S.SQUAD_CONFIRMED, S.CANCELLED}),
    S.RECRUITING: frozenset({S.SQUAD_CONFIRMED, S.CANCELLED}),
    S.SQUAD_CONFIRMED: frozenset({S.SCHEDULED, S.RECRUITING, S.CANCELLED}),
    S.SCHEDULED: frozenset({S.IN_PROGRESS, S.RECRUITING, S.CANCELLED}),
    S.IN_PROGRESS: frozenset({S.COMPLETED, S.CANCELLED}),
    S.COMPLETED: frozenset(),
    S.CANCELLED: frozenset(),
}

TERMINAL = frozenset({S.COMPLETED, S.CANCELLED})
#: States in which recruiting actions (invite, join request) are permitted.
RECRUITABLE = frozenset({S.PUBLISHED, S.RECRUITING})
#: States in which the squad may still change (confirm/remove/replace/withdraw).
ROSTER_MUTABLE = frozenset({S.DRAFT, S.PUBLISHED, S.RECRUITING, S.SQUAD_CONFIRMED, S.SCHEDULED})
#: States in which the match may be edited/rescheduled.
EDITABLE = ROSTER_MUTABLE
#: States visible in public discovery.
DISCOVERABLE = frozenset({S.PUBLISHED, S.RECRUITING})


def can_transition(current: S, target: S) -> bool:
    return target in TRANSITIONS[current]


def ensure_transition(current: S | str, target: S | str) -> None:
    cur, tgt = S(current), S(target)
    if not can_transition(cur, tgt):
        raise BusinessRuleViolation(
            f"Cannot move a match from '{cur.value}' to '{tgt.value}'",
            code="INVALID_MATCH_TRANSITION",
            details=[{"from": cur.value, "to": tgt.value, "allowed": sorted(s.value for s in TRANSITIONS[cur])}],
        )
