from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.dependencies import CurrentUser, latest_material_version
from app.common.enums import AccountStatus, InvitationStatus
from app.common.types import utcnow
from app.core.container import Container
from app.core.exceptions import NotFound
from app.modules.users.repository import UserRepository
from app.modules.users.schemas import (
    AgreementState,
    DeviceIn,
    NotificationPrefs,
    UpdateMeIn,
    UserOut,
)


class UserService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.repo = UserRepository(c.mongo)

    async def to_out(self, doc: dict[str, Any]) -> UserOut:
        uid = doc["_id"]
        has_player = await self.c.mongo["player_profiles"].count_documents({"user_id": uid}, limit=1)
        has_captain = await self.c.mongo["captain_profiles"].count_documents({"user_id": uid}, limit=1)
        required = await latest_material_version(self.c)
        accepted = doc.get("agreement_version_accepted")
        satisfied = required is None or (accepted is not None and int(accepted) >= required)
        return UserOut(
            id=str(uid),
            full_name=doc["full_name"],
            mobile_number=doc.get("mobile_number"),
            email=doc.get("email"),
            mobile_verified=bool(doc.get("mobile_verified")),
            profile_image=doc.get("profile_image"),
            roles=doc.get("roles", []),
            city=doc.get("city"),
            timezone=doc.get("timezone", "Asia/Kolkata"),
            account_status=doc.get("account_status", AccountStatus.ACTIVE),
            has_password=bool(doc.get("password_hash")),
            has_player_profile=bool(has_player),
            has_captain_profile=bool(has_captain),
            agreement=AgreementState(accepted_version=accepted, required_version=required, satisfied=satisfied),
            notification_prefs=NotificationPrefs(**(doc.get("notification_prefs") or {})),
            preferred_sport=doc.get("preferred_sport") or "cricket",
            created_at=doc["created_at"],
        )

    async def update_me(self, user: CurrentUser, data: UpdateMeIn) -> UserOut:
        fields = data.model_dump(exclude_unset=True, mode="json")
        if "email" in fields and fields["email"]:
            fields["email"] = fields["email"].lower()
            if fields["email"] != user.doc.get("email"):
                fields["email_verified"] = False
        doc = await self.repo.update(user.id, fields)
        if doc is None:
            raise NotFound("User not found")
        return await self.to_out(doc)

    async def register_device(self, user: CurrentUser, data: DeviceIn) -> None:
        await self.c.mongo["devices"].update_one(
            {"push_token": data.push_token},
            {"$set": {"user_id": user.id, "platform": data.platform, "last_seen_at": utcnow()}},
            upsert=True,
        )

    async def export_data(self, user: CurrentUser) -> dict[str, Any]:
        """Privacy: everything we hold about the user, in JSON-friendly form."""
        m = self.c.mongo
        uid = user.id

        async def all_of(col: str, q: dict[str, Any], proj: dict[str, int] | None = None) -> list[Any]:
            return [_clean(d) async for d in m[col].find(q, proj)]

        return {
            "user": _clean({k: v for k, v in user.doc.items() if k != "password_hash"}),
            "player_profile": await all_of("player_profiles", {"user_id": uid}, {"_lock": 0}),
            "captain_profile": await all_of("captain_profiles", {"user_id": uid}),
            "availability": await all_of("availability", {"player_id": uid}),
            "team_memberships": await all_of("team_members", {"user_id": uid}),
            "invitations": await all_of("invitations", {"player_id": uid}),
            "match_participation": await all_of("match_rosters", {"player_id": uid}),
            "payment_records": await all_of("payment_records", {"player_id": uid}),
            "ratings_given": await all_of("ratings", {"reviewer_id": uid}),
            "ratings_received": await all_of(
                "ratings", {"reviewed_user_id": uid, "status": "visible"}, {"reviewer_id": 0}
            ),
            "agreements": await all_of("user_agreements", {"user_id": uid}),
            "reports_filed": await all_of("reports", {"reporter_id": uid}, {"ai_triage": 0, "investigation_notes": 0}),
        }

    async def delete_account(self, user: CurrentUser, reason: str | None) -> None:
        """Anonymise PII; keep financial/audit/agreement records pseudonymised.

        Teams captained by the user are archived; confirmed future seats are withdrawn.
        """
        m = self.c.mongo
        uid = user.id
        now = utcnow()

        async def txn(s: AsyncClientSession) -> None:
            await m["users"].update_one(
                {"_id": uid},
                {
                    "$set": {
                        "full_name": "Deleted player",
                        "mobile_number": None,
                        "email": None,
                        "profile_image": None,
                        "password_hash": None,
                        "city": None,
                        "account_status": AccountStatus.DELETED,
                        "deleted_at": now,
                        "deletion_reason": reason,
                        "updated_at": now,
                    }
                },
                session=s,
            )
            await m["player_profiles"].update_one(
                {"user_id": uid},
                {
                    "$unset": {
                        "home_location": "",
                        "bio": "",
                        "cricheroes_url": "",
                        "cricheroes_player_id": "",
                        "previous_teams": "",
                    },
                    "$set": {"availability_visibility": "private", "updated_at": now},
                },
                session=s,
            )
            await m["availability"].delete_many({"player_id": uid}, session=s)
            await m["invitations"].update_many(
                {"player_id": uid, "invitation_status": {"$in": [InvitationStatus.PENDING, InvitationStatus.ACCEPTED]}},
                {
                    "$set": {
                        "invitation_status": InvitationStatus.CANCELLED,
                        "is_active": False,
                        "cancel_reason": "account_deleted",
                        "responded_at": now,
                    }
                },
                session=s,
            )
            await m["teams"].update_many(
                {"captain_id": uid}, {"$set": {"team_status": "archived", "updated_at": now}}, session=s
            )
            await m["team_members"].update_many(
                {"user_id": uid}, {"$set": {"status": "left", "updated_at": now}}, session=s
            )
            await m["refresh_tokens"].update_many(
                {"user_id": uid, "revoked_at": None}, {"$set": {"revoked_at": now}}, session=s
            )
            await m["devices"].delete_many({"user_id": uid}, session=s)
            # Erase what the person wrote or set up (DPDP Act s.12): content others can see is replaced, private
            # records are deleted. Ratings, fee records and audit entries stay, pseudonymised as "Deleted player".
            await m["community_posts"].update_many(
                {"author_id": uid},
                {"$set": {"body": "", "poll": None, "removed": True, "removed_reason": "author_deleted"}},
                session=s,
            )
            await m["chat_messages"].update_many({"sender_id": uid}, {"$set": {"body": "[message deleted]"}}, session=s)
            await m["play_requests"].update_many({"from_user_id": uid}, {"$set": {"message": None}}, session=s)
            await m["notifications"].delete_many({"user_id": uid}, session=s)
            await m["racket_profiles"].delete_many({"user_id": uid}, session=s)
            await m["captain_profiles"].update_many({"user_id": uid}, {"$unset": {"bio": ""}}, session=s)
            await m["community_members"].update_many({"user_id": uid}, {"$set": {"status": "left"}}, session=s)
            await m["privacy_requests"].update_many(
                {"user_id": uid, "status": {"$in": ["open", "in_progress"]}},
                {"$set": {"status": "closed", "resolution": "Account deleted", "resolved_at": now}},
                session=s,
            )
            await self.c.audit.log(
                actor_id=uid,
                action="account.deleted",
                entity_type="user",
                entity_id=uid,
                new_value={"reason": reason},
                request_id=user.request_id,
                session=s,
            )

        await m.transaction(txn)


def _clean(d: Any) -> Any:
    if isinstance(d, ObjectId):
        return str(d)
    if isinstance(d, dict):
        return {k: _clean(v) for k, v in d.items()}
    if isinstance(d, list):
        return [_clean(v) for v in d]
    if hasattr(d, "isoformat"):
        return d.isoformat()
    return d
