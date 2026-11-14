"""Player profile fields that live on the user: date of birth and playing roles.

Playing roles are the cricket roles a player can fill (batter, bowler, all-rounder, wicketkeeper-batter), several
allowed. The first one becomes the ``primary_role`` of the discovery profile (players/me) and the rest its
``secondary_roles``, so captains' role searches keep working unchanged.
"""

from dataclasses import replace
from typing import Any

from app.api.dependencies import CurrentUser
from app.common.enums import PlayingRole
from app.common.types import utcnow
from app.core.container import Container
from app.modules.users.schemas import ProfilePatchIn


async def seed_player_profile(c: Container, doc: dict[str, Any], roles: list[PlayingRole]) -> None:
    """Create or update the discovery profile from the playing roles (cricket only)."""
    from app.modules.players.schemas import PlayerProfileIn
    from app.modules.players.service import PlayerService

    if not roles:
        return
    user = CurrentUser(
        id=doc["_id"],
        roles=doc.get("roles", []),
        account_status=doc.get("account_status", "active"),
        full_name=doc.get("full_name", ""),
        doc=doc,
    )
    existing = await c.mongo["player_profiles"].find_one({"user_id": doc["_id"]})
    body = PlayerProfileIn(primary_role=roles[0], secondary_roles=list(roles[1:]))
    if existing is None:
        await PlayerService(c).upsert_me(user, body)
    else:
        await c.mongo["player_profiles"].update_one(
            {"user_id": doc["_id"]},
            {
                "$set": {
                    "primary_role": roles[0].value,
                    "secondary_roles": [r.value for r in roles[1:]],
                    "updated_at": utcnow(),
                }
            },
        )


async def patch_profile(c: Container, user: CurrentUser, data: ProfilePatchIn) -> dict[str, Any]:
    fields: dict[str, Any] = {"updated_at": utcnow()}
    if data.player_name is not None:
        fields["full_name"] = data.player_name
    if data.date_of_birth is not None:
        fields["date_of_birth"] = data.date_of_birth.isoformat()
    if data.playing_roles is not None:
        fields["playing_roles"] = [r.value for r in data.playing_roles]
    users = c.mongo["users"]
    await users.update_one({"_id": user.id}, {"$set": fields})
    doc = await users.find_one({"_id": user.id})
    assert doc is not None
    if data.playing_roles is not None and (doc.get("preferred_sport") or "cricket") == "cricket":
        await seed_player_profile(c, doc, list(data.playing_roles))
    if data.player_name is not None:
        from app.modules.search.indexer import SearchIndexer

        await SearchIndexer(c.mongo).index_user(user.id)
    _ = replace  # keep dataclasses import meaningful for future field copies
    return doc
