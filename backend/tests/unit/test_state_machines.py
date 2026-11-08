import pytest

from app.common.enums import InvitationDirection as D
from app.common.enums import InvitationStatus as I
from app.common.enums import MatchStatus as M
from app.core.exceptions import BusinessRuleViolation
from app.modules.invitations import state_machine as ism
from app.modules.matches import lifecycle


def test_happy_path_lifecycle() -> None:
    path = [M.DRAFT, M.PUBLISHED, M.RECRUITING, M.SQUAD_CONFIRMED, M.SCHEDULED, M.IN_PROGRESS, M.COMPLETED]
    for a, b in zip(path, path[1:], strict=False):
        lifecycle.ensure_transition(a, b)


@pytest.mark.parametrize(
    "a,b",
    [
        (M.DRAFT, M.COMPLETED),
        (M.COMPLETED, M.CANCELLED),
        (M.CANCELLED, M.PUBLISHED),
        (M.RECRUITING, M.IN_PROGRESS),
        (M.IN_PROGRESS, M.RECRUITING),
    ],
)
def test_invalid_lifecycle_transitions(a: M, b: M) -> None:
    with pytest.raises(BusinessRuleViolation):
        lifecycle.ensure_transition(a, b)


def test_cancel_allowed_from_every_non_terminal_state() -> None:
    for s in M:
        if s not in lifecycle.TERMINAL:
            assert lifecycle.can_transition(s, M.CANCELLED)


def test_invite_must_be_accepted_before_confirm() -> None:
    with pytest.raises(BusinessRuleViolation):
        ism.ensure_transition(I.PENDING, I.CONFIRMED, D.INVITE)
    ism.ensure_transition(I.PENDING, I.ACCEPTED, D.INVITE)
    ism.ensure_transition(I.ACCEPTED, I.CONFIRMED, D.INVITE)


def test_join_request_confirmed_directly_and_never_accepted() -> None:
    ism.ensure_transition(I.PENDING, I.CONFIRMED, D.REQUEST)
    with pytest.raises(BusinessRuleViolation):
        ism.ensure_transition(I.PENDING, I.ACCEPTED, D.REQUEST)


@pytest.mark.parametrize("final", [I.REJECTED, I.EXPIRED, I.CANCELLED])
def test_final_invitation_states(final: I) -> None:
    for target in I:
        with pytest.raises(BusinessRuleViolation):
            ism.ensure_transition(final, target, D.INVITE)


def test_active_statuses() -> None:
    assert {s for s in I if ism.is_active(s)} == {I.PENDING, I.ACCEPTED, I.CONFIRMED}
