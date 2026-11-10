"""Finishing sign-up after the mobile number is verified.

Flow (mobile app): sport → mobile number → SMS/WhatsApp OTP (POST /auth/send-otp, /auth/verify-otp creates a
phone-verified account with ``registration_completed_at = null``) → email → Player or Captain → name, role, photo
→ POST /users/me/registration. Until that call succeeds the app keeps reopening registration, so a sign-up
interrupted at any point resumes where it stopped.

Rules enforced here, never in the client:
- the phone must already be verified (``mobile_verified``, exposed as ``phone_verified``);
- registration completes once; a second call is refused instead of silently rewriting the account;
- the email is stored unverified (``email_verified = false``) and is never used for account recovery,
  which stays on the verified mobile number (POST /auth/reset-password needs an OTP to it);
- an email already used by another account is refused (EMAIL_IN_USE) rather than attached twice.

Email verification later only needs to set ``email_verified`` / ``email_verified_at``; nothing here assumes it.
"""

from dataclasses import replace
from typing import Any

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.api.dependencies import CurrentUser
from app.common.types import utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, Forbidden
from app.core.logging import get_logger
from app.core.security import hash_secret
from app.infrastructure.database.mongo import Mongo
from app.modules.search.indexer import SearchIndexer
from app.modules.users.schemas import CompleteRegistrationIn

log = get_logger("users.registration")
PLACEHOLDER_NAME = "GoFindr player"  # what /auth/verify-otp names a phone-only sign-up


def _is_tester_number(c: Container, mobile: str | None) -> bool:
    p = c.settings.tester_signup_prefix
    return bool(mobile and p and p.strip()) and c.settings.app_env not in ("beta", "production") and bool(
        mobile and mobile.startswith(p or "\x00")
    )


async def complete_registration(c: Container, user: CurrentUser, data: CompleteRegistrationIn) -> dict[str, Any]:
    doc = user.doc
    if not doc.get("mobile_verified"):
        raise Forbidden("Verify your mobile number first", code="PHONE_NOT_VERIFIED")
    if doc.get("registration_completed_at"):
        raise Conflict("Your registration is already complete", code="REGISTRATION_COMPLETE")
    beta = c.settings.gofindr_beta_sport
    if beta and data.sport not in (None, beta):
        raise BusinessRuleViolation(f"Only {beta} is available in this release", code="SPORT_NOT_AVAILABLE")
    tester = _is_tester_number(c, doc.get("mobile_number"))
    if tester and not data.password and not doc.get("password_hash"):
        # Test numbers only ever see a code once (when new), so testers need a password to come back.
        raise BusinessRuleViolation("Set a password so you can log back in with your email.", code="PASSWORD_REQUIRED")

    now = utcnow()
    email = str(data.email).lower()
    fields: dict[str, Any] = {
        "full_name": data.full_name,
        "email": email,
        "email_verified": False,
        "email_verified_at": None,
        "preferred_sport": beta or data.sport or doc.get("preferred_sport") or "cricket",
        "registration_completed_at": now,
        "updated_at": now,
    }
    if not doc.get("phone_verified_at"):
        fields["phone_verified_at"] = now
    if data.profile_image is not None:
        fields["profile_image"] = data.profile_image
    if tester and data.password:
        fields["password_hash"] = hash_secret(data.password)

    users = c.mongo["users"]
    try:
        # Conditional on the state checked above, so two racing calls can't both complete (or both succeed).
        updated = await users.find_one_and_update(
            {"_id": user.id, "mobile_verified": True, "registration_completed_at": None},
            {"$set": fields},
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError as exc:
        raise Conflict("This email is already used by another GoFindr account", code="EMAIL_IN_USE") from exc
    if updated is None:
        raise Conflict("Your registration is already complete", code="REGISTRATION_COMPLETE")

    # Imported here: both services import the users module.
    from app.modules.captains.service import CaptainService
    from app.modules.players.schemas import PlayerProfileIn
    from app.modules.players.service import PlayerService

    if data.play_as == "captain":
        await CaptainService(c).ensure_profile(user.id)
    if data.primary_role and fields["preferred_sport"] == "cricket":
        if not await c.mongo["player_profiles"].count_documents({"user_id": user.id}, limit=1):
            fresh = replace(user, doc=updated, full_name=updated["full_name"], roles=updated.get("roles", []))
            await PlayerService(c).upsert_me(fresh, PlayerProfileIn(primary_role=data.primary_role))
    await SearchIndexer(c.mongo).index_user(user.id)
    await c.audit.log(
        actor_id=user.id,
        action="user.registration_completed",
        entity_type="user",
        entity_id=user.id,
        new_value={"play_as": data.play_as, "sport": fields["preferred_sport"]},
    )
    final = await users.find_one({"_id": user.id})
    assert final is not None
    return final


async def backfill_registration_fields(mongo: Mongo) -> int:
    """Idempotent, runs at startup. Accounts created before these fields existed are treated as registered
    when their phone is verified and they already have a real name or a player profile, so nobody repeats
    sign-up. phone_verified_at is approximated by created_at for those accounts. Existing values are never
    overwritten; unverified (invite-link) accounts are left for their own OTP step."""
    users = mongo["users"]
    changed = 0
    async for u in users.find(
        {"registration_completed_at": {"$exists": False}},
        {"_id": 1, "full_name": 1, "mobile_verified": 1, "created_at": 1, "phone_verified_at": 1},
    ):
        verified = bool(u.get("mobile_verified"))
        has_profile = bool(await mongo["player_profiles"].count_documents({"user_id": u["_id"]}, limit=1))
        named = (u.get("full_name") or PLACEHOLDER_NAME) != PLACEHOLDER_NAME
        created = u.get("created_at") or utcnow()
        fields: dict[str, Any] = {"registration_completed_at": created if verified and (named or has_profile) else None}
        if verified and not u.get("phone_verified_at"):
            fields["phone_verified_at"] = created
        await users.update_one({"_id": u["_id"], "registration_completed_at": {"$exists": False}}, {"$set": fields})
        changed += 1
    if changed:
        log.info("users.registration_backfill", accounts=changed)
    return changed
