"""Email + password sign-up, Google sign-in and account linking.

Identity vs profile: a user document carries the sign-in identities (``password_hash``, ``google_sub`` and the
``auth_providers`` list) and the player profile fields (name, date of birth, playing roles). The two never mix:
a Google account has ``password_hash = None`` and is never asked to set one.

Google (POST /auth/google)
- The ID token is verified server-side (signature, issuer, audience, expiry, ``sub``; see integrations/google.py).
- Lookup is by Google ``sub`` first. A new ``sub`` whose email matches an existing account is linked to it ONLY
  when both sides have proven the address (our ``email_verified`` and Google's ``email_verified``). Otherwise the
  sign-in is refused (ACCOUNT_EXISTS_UNLINKED): the owner logs in the usual way and links Google from Settings
  (POST /auth/google/link). An email match alone never merges accounts.
- New accounts start with ``registration_completed_at = None``: the app asks for the missing date of birth and
  playing roles (POST /users/me/registration) with name and email prefilled.

Email + password (POST /auth/register/email)
- The form carries everything (name, DOB, roles), so the account is complete at once. The email is recorded
  unverified: it can't be used for password recovery until POST /auth/email-verify proves it.
"""

from typing import Any

from app.api.dependencies import CurrentUser
from app.common.enums import AccountStatus, Role
from app.common.types import utcnow
from app.core.container import Container
from app.core.exceptions import AppError, Conflict, Unauthorized
from app.core.security import hash_secret
from app.infrastructure.integrations.google import GoogleIdentity
from app.modules.auth.schemas import EmailRegisterIn, TokenOut
from app.modules.search.indexer import SearchIndexer
from app.modules.users.profile import seed_player_profile

PROVIDER_GOOGLE = "google"
PROVIDER_PASSWORD = "password"  # noqa: S105 - provider name, not a secret


def _base_user(now: Any) -> dict[str, Any]:
    return {
        "profile_image": None,
        "roles": [Role.PLAYER.value],
        "account_status": AccountStatus.ACTIVE.value,
        "notification_prefs": {"in_app": True, "push": True, "email": False, "muted_types": []},
        "agreement_version_accepted": None,
        "mobile_number": None,
        "mobile_verified": False,
        "phone_verified_at": None,
        "created_at": now,
        "updated_at": now,
    }


async def register_with_email(c: Container, data: EmailRegisterIn, user_agent: str | None) -> TokenOut:
    from app.modules.auth.service import AuthService  # the service owns token issuance

    email = str(data.email).lower()
    users = c.mongo["users"]
    if await users.find_one({"email": email}, {"_id": 1}):
        raise Conflict("This email already has a OneShort account. Log in instead.", code="ACCOUNT_EXISTS")
    beta = c.settings.oneshort_beta_sport
    sport = beta or data.sport
    now = utcnow()
    fields: dict[str, Any] = {
        **_base_user(now),
        "full_name": data.full_name,
        "email": email,
        "email_verified": False,
        "email_verified_at": None,
        "verified_via": PROVIDER_PASSWORD,
        "password_hash": hash_secret(data.password),
        "auth_providers": [PROVIDER_PASSWORD],
        "date_of_birth": data.date_of_birth.isoformat(),
        "playing_roles": [r.value for r in data.playing_roles],
        "preferred_sport": sport,
        "city": data.city,
        "timezone": data.timezone,
        "registration_completed_at": now,  # the form carried everything registration needs
    }
    svc = AuthService(c)
    try:
        doc = await svc.users.insert(fields)
    except AppError as exc:  # lost a race for the same email
        raise Conflict("This email already has a OneShort account. Log in instead.", code="ACCOUNT_EXISTS") from exc
    if sport == "cricket":
        await seed_player_profile(c, doc, data.playing_roles)
    await SearchIndexer(c.mongo).index_user(doc["_id"])
    await c.audit.log(actor_id=doc["_id"], action="user.registered_password", entity_type="user", entity_id=doc["_id"])
    out = await svc._issue_tokens(doc, user_agent, family_id=None)
    out.is_new_user = True
    return out


async def google_sign_in(c: Container, id_token: str, user_agent: str | None) -> TokenOut:
    from app.modules.auth.service import AuthService

    ident = c.google.verify(id_token)  # raises Unauthorized on anything but a valid token for our client ids
    svc = AuthService(c)
    users = c.mongo["users"]
    user = await users.find_one({"google_sub": ident.sub})
    is_new = False
    if user is None:
        existing = await users.find_one({"email": ident.email}) if ident.email else None
        if existing is not None:
            if not (existing.get("email_verified") and ident.email_verified):
                # Same address, but only one side (or neither) has proven it: no silent merge.
                raise Conflict(
                    "An account already uses this email. Log in to it, then link Google from Settings.",
                    code="ACCOUNT_EXISTS_UNLINKED",
                )
            user = await _link(c, existing, ident, auto=True)
        else:
            user = await _create_from_google(c, ident)
            is_new = True
    svc._ensure_can_login(user)
    out = await svc._issue_tokens(user, user_agent, family_id=None)
    out.is_new_user = is_new
    return out


async def google_link(c: Container, user: CurrentUser, id_token: str) -> dict[str, Any]:
    """Attach a Google account to the signed-in user (from Settings). The Google identity must be free."""
    ident = c.google.verify(id_token)
    other = await c.mongo["users"].find_one({"google_sub": ident.sub}, {"_id": 1})
    if other and other["_id"] != user.id:
        raise Conflict("This Google account is already linked to another OneShort account.", code="GOOGLE_IN_USE")
    if user.doc.get("google_sub") == ident.sub:
        return user.doc
    return await _link(c, user.doc, ident, auto=False)


async def _link(c: Container, doc: dict[str, Any], ident: GoogleIdentity, *, auto: bool) -> dict[str, Any]:
    now = utcnow()
    fields: dict[str, Any] = {"google_sub": ident.sub, "updated_at": now}
    providers = list(doc.get("auth_providers") or ([PROVIDER_PASSWORD] if doc.get("password_hash") else []))
    if PROVIDER_GOOGLE not in providers:
        providers.append(PROVIDER_GOOGLE)
    fields["auth_providers"] = providers
    # Google proved this address: if it's the account's address, it counts as verified on our side too.
    if (
        ident.email
        and ident.email_verified
        and (doc.get("email") or "").lower() == ident.email
        and not doc.get("email_verified")
    ):
        fields["email_verified"] = True
        fields["email_verified_at"] = now
    try:
        updated = await c.mongo["users"].find_one_and_update(
            {"_id": doc["_id"]}, {"$set": fields}, return_document=True
        )
    except Exception as exc:  # duplicate google_sub in a race
        raise Conflict(
            "This Google account is already linked to another OneShort account.", code="GOOGLE_IN_USE"
        ) from exc
    if updated is None:
        raise Unauthorized("Account not found", code="ACCOUNT_NOT_FOUND")
    await c.audit.log(
        actor_id=doc["_id"],
        action="user.google_linked",
        entity_type="user",
        entity_id=doc["_id"],
        new_value={"auto": auto},
    )
    return updated


async def _create_from_google(c: Container, ident: GoogleIdentity) -> dict[str, Any]:
    from app.modules.auth.service import NEW_PLAYER_NAME, AuthService

    now = utcnow()
    name = (ident.name or "").strip()
    fields: dict[str, Any] = {
        **_base_user(now),
        "full_name": name[:80] if len(name) >= 2 else NEW_PLAYER_NAME,
        "email": ident.email if ident.email_verified else None,  # an unverified Google email isn't attached
        "email_verified": ident.email_verified,
        "email_verified_at": now if ident.email_verified else None,
        "verified_via": PROVIDER_GOOGLE,
        "password_hash": None,  # Google accounts never get a password here
        "google_sub": ident.sub,
        "auth_providers": [PROVIDER_GOOGLE],
        "timezone": "Asia/Kolkata",
        "city": None,
        "registration_completed_at": None,  # DOB + playing roles come next, in the app
    }
    # Google's picture URL is not stored: image fields may only point at files OneShort stored itself.
    svc = AuthService(c)
    try:
        doc = await svc.users.insert(fields)
    except AppError as exc:
        again = await c.mongo["users"].find_one({"google_sub": ident.sub})
        if again is None:
            raise Conflict(
                "An account already uses this email. Log in to it, then link Google.", code="ACCOUNT_EXISTS_UNLINKED"
            ) from exc
        return again
    await c.audit.log(actor_id=doc["_id"], action="user.registered_google", entity_type="user", entity_id=doc["_id"])
    return doc
