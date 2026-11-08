"""Resource-level authorization rules for teams and matches.

Captains manage their own teams; team admins (explicitly delegated via ``admin_ids``)
can manage rosters, fees and payment statuses. Platform admins are NOT implicitly
team managers (they moderate, they don't run other people's teams).
"""

from typing import Any

from bson import ObjectId

from app.core.exceptions import Forbidden


def can_manage_team(team: dict[str, Any], user_id: ObjectId) -> bool:
    return team.get("captain_id") == user_id or user_id in (team.get("admin_ids") or [])


def ensure_team_manager(team: dict[str, Any], user_id: ObjectId) -> None:
    if not can_manage_team(team, user_id):
        raise Forbidden("Only the team captain or a team admin can do this", code="NOT_TEAM_MANAGER")


def ensure_team_captain(team: dict[str, Any], user_id: ObjectId) -> None:
    if team.get("captain_id") != user_id:
        raise Forbidden("Only the team captain can do this", code="NOT_TEAM_CAPTAIN")


def can_manage_match(match: dict[str, Any], team: dict[str, Any] | None, user_id: ObjectId) -> bool:
    if match.get("captain_id") == user_id:
        return True
    return team is not None and can_manage_team(team, user_id)


def ensure_match_manager(match: dict[str, Any], team: dict[str, Any] | None, user_id: ObjectId) -> None:
    if not can_manage_match(match, team, user_id):
        raise Forbidden("Only the match captain or a team admin can do this", code="NOT_MATCH_MANAGER")
