"""Authentication: OTP issuance/verification, password login, refresh-token rotation.

Security notes
- OTP codes are stored only as Argon2 hashes, expire after ``otp_ttl_seconds`` and allow at
  most ``otp_max_attempts`` guesses. Sends are rate limited per mobile (persisted).
- Refresh tokens are opaque, stored hashed and rotated on every use. Re-use of a rotated
  token revokes the whole token family (likely theft).
"""

import uuid
from datetime import timedelta
from typing import Any

from bson import ObjectId

from app.common.enums import AccountStatus, Role
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import (
    AppError,
    BusinessRuleViolation,
    Forbidden,
    NotFound,
    RateLimited,
    Unauthorized,
)
from app.core.security import (
    create_access_token,
    generate_otp,
    generate_refresh_token,
    hash_secret,
    sha256,
    verify_secret,
)
from app.infrastructure.integrations.whatsapp import failure_reason
from app.modules.auth.abuse import enforce_send_budgets
from app.modules.auth.schemas import (
    OtpChannel,
    OtpPurpose,
    OtpSentOut,
    RegisterIn,
    RegisterOut,
    SessionOut,
    SignupProfileIn,
    TokenOut,
)
from app.modules.users.repository import UserRepository
from app.modules.users.service import UserService

NEW_PLAYER_NAME = "GoFindr player"  # placeholder until onboarding asks for a name


class AuthService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.s = c.settings
        self.users = UserRepository(c.mongo)
        self.otps = c.mongo["otp_codes"]
        self.tokens = c.mongo["refresh_tokens"]

    # ---------------------------------------------------------------- OTP
    async def _issue_otp(
        self,
        mobile: str,
        purpose: OtpPurpose,
        channel: OtpChannel = "sms",
        ip: str | None = None,
        deliver: bool = True,
    ) -> OtpSentOut:
        await enforce_send_budgets(self.c, mobile, ip, channel)
        if channel == "whatsapp" and not self.c.whatsapp.configured:
            raise AppError(
                "WhatsApp codes aren't available yet. Use SMS instead.", code="WHATSAPP_UNAVAILABLE", status_code=422
            )
        now = utcnow()
        hour_ago = now - timedelta(hours=1)
        recent = await self.otps.count_documents(
            {"kind": "send_log", "mobile_number": mobile, "created_at": {"$gte": hour_ago}}
        )
        if recent >= self.s.otp_max_sends_per_hour:
            raise RateLimited("Too many OTP requests. Please try again later.", code="OTP_RATE_LIMITED")
        last = await self.otps.find_one({"kind": "send_log", "mobile_number": mobile}, sort=[("created_at", -1)])
        if last and (now - ensure_utc(last["created_at"])).total_seconds() < self.s.otp_resend_cooldown_seconds:
            raise RateLimited("Please wait before requesting another OTP.", code="OTP_COOLDOWN")

        if not deliver:  # same limits and same reply, no code (password reset for an unusable number)
            await self.otps.insert_one({"kind": "send_log", "mobile_number": mobile, "ip": ip, "created_at": now})
            return OtpSentOut(
                sent=True,
                expires_in=self.s.otp_ttl_seconds,
                resend_after=self.s.otp_resend_cooldown_seconds,
                dev_otp=None,
            )
        code = generate_otp()
        family = ["login", "register"] if purpose in ("login", "register") else [purpose]
        await self.otps.delete_many({"kind": "code", "mobile_number": mobile, "purpose": {"$in": family}})
        await self.otps.insert_one(
            {
                "kind": "code",
                "mobile_number": mobile,
                "purpose": purpose,
                "code_hash": hash_secret(code),
                "attempts": 0,
                "expires_at": now + timedelta(seconds=self.s.otp_ttl_seconds),
                "created_at": now,
            }
        )
        await self.otps.insert_one({"kind": "send_log", "mobile_number": mobile, "ip": ip, "created_at": now})
        if channel == "whatsapp":
            status = await self.c.whatsapp.send(
                mobile,
                f"{code} is your GoFindr verification code. It expires in 5 minutes. Don't share it.",
                [code],
                "otp",
            )
            if status != "sent":
                raise AppError(failure_reason(self.c.whatsapp), code="OTP_DELIVERY_FAILED", status_code=422)
            expose = False  # a real channel delivered it; never echo the code
        else:
            await self.c.otp_sender.send(mobile, code)
            expose = self.c.otp_sender.exposes_code and (
                (self.s.is_dev_like and self.s.dev_otp_in_response)
                or (
                    purpose in ("register", "login")
                    and self._is_tester_number(mobile)
                    # only for brand-new numbers: showing a code for an existing account would let any
                    # tester sign in as another tester
                    and await self.users.by_mobile(mobile) is None
                )
            )
        return OtpSentOut(
            sent=True,
            expires_in=self.s.otp_ttl_seconds,
            resend_after=self.s.otp_resend_cooldown_seconds,
            dev_otp=code if expose else None,
        )

    def _is_tester_number(self, mobile: str) -> bool:
        p = self.s.tester_signup_prefix
        return bool(p and p.strip()) and self.s.app_env not in ("beta", "production") and mobile.startswith(p or "\x00")

    async def _consume_otp(self, mobile: str, purpose: str, code: str) -> None:
        purposes = ["login", "register"] if purpose in ("login", "register") else [purpose]
        doc = await self.otps.find_one_and_update(
            {"kind": "code", "mobile_number": mobile, "purpose": {"$in": purposes}, "expires_at": {"$gt": utcnow()}},
            {"$inc": {"attempts": 1}},
        )
        if not doc:
            raise Unauthorized("OTP expired or not requested", code="OTP_EXPIRED")
        if doc["attempts"] >= self.s.otp_max_attempts:
            await self.otps.delete_one({"_id": doc["_id"]})
            raise Unauthorized("Too many incorrect attempts. Request a new OTP.", code="OTP_LOCKED")
        if not verify_secret(code, doc["code_hash"]):
            raise Unauthorized("Incorrect OTP", code="OTP_INVALID")
        await self.otps.delete_one({"_id": doc["_id"]})

    # --------------------------------------------------------- sign-up and sign-in
    # Every reply below is identical whether or not the number has an account (auth review H2): a code is
    # sent to any number, and the account is created or opened only when that code is verified. Sign-up
    # details come with the verification, from the person holding the phone, so nothing typed by someone
    # who doesn't own the number is ever attached to it.
    async def register(self, data: RegisterIn, ip: str | None = None) -> RegisterOut:
        if self._is_tester_number(data.mobile_number) and not data.password:
            raise BusinessRuleViolation(
                "Set a password so you can log back in with your email.", code="PASSWORD_REQUIRED"
            )
        otp = await self._issue_otp(data.mobile_number, "register", data.otp_channel, ip)
        return RegisterOut(user_id=None, otp=otp)

    async def send_otp(
        self, mobile: str, purpose: OtpPurpose, channel: OtpChannel = "sms", ip: str | None = None
    ) -> OtpSentOut:
        if purpose == "reset_password":
            user = await self.users.by_mobile(mobile)
            usable = (
                user is not None
                and user.get("mobile_verified")
                and user.get("account_status") not in (AccountStatus.DELETED, AccountStatus.SUSPENDED)
            )
            # Unknown or unusable numbers get the same reply and the same limits, but no code.
            return await self._issue_otp(mobile, purpose, channel, ip, deliver=bool(usable))
        return await self._issue_otp(mobile, purpose, channel, ip)

    async def verify_otp(
        self,
        mobile: str,
        code: str,
        purpose: str,
        user_agent: str | None,
        profile: SignupProfileIn | None = None,
    ) -> TokenOut:
        await self._consume_otp(mobile, purpose, code)
        user = await self.users.by_mobile(mobile)
        is_new = False
        if not user:
            user = await self._create_verified_user(mobile, profile)
            is_new = True
        elif not user.get("mobile_verified") and user.get("verified_via") == "email":
            # Someone proved this number, but the account using it was created by email and never proved it.
            # The prover may not be that account's owner, so they never get into it: the number moves to them.
            await self.users.update(user["_id"], {"mobile_number": None})
            await self.c.audit.log(
                actor_id=user["_id"],
                action="user.unverified_mobile_released",
                entity_type="user",
                entity_id=user["_id"],
            )
            user = await self._create_verified_user(mobile, profile)
            is_new = True
        else:
            self._ensure_can_login(user)
            if not user.get("mobile_verified"):
                user = await self._claim_unverified(user, profile)
                is_new = True
        out = await self._issue_tokens(user, user_agent, family_id=None)
        out.is_new_user = is_new
        return out

    async def _email_free(self, email: str | None, owner_id: Any = None) -> str | None:
        """The email if no other account uses it; otherwise None (the user can add one later in Settings).
        Never an error here, so sign-up can't be used to test which emails have accounts."""
        if not email:
            return None
        other = await self.users.by_email(email)
        return email.lower() if not other or other["_id"] == owner_id else None

    async def _create_verified_user(self, mobile: str, profile: SignupProfileIn | None) -> dict[str, Any]:
        now = utcnow()
        fields: dict[str, Any] = {
            "full_name": profile.full_name if profile else NEW_PLAYER_NAME,
            "mobile_number": mobile,
            "email": await self._email_free(str(profile.email) if profile and profile.email else None),
            "email_verified": False,
            "email_verified_at": None,
            "mobile_verified": True,  # exposed as phone_verified
            "phone_verified_at": now,
            # Sign-up details (name, email, password) may arrive with the code, but registration is finished
            # only by POST /users/me/registration (Player/Captain), so every new account starts incomplete.
            "registration_completed_at": None,
            "password_hash": hash_secret(profile.password) if profile and profile.password else None,
            "profile_image": None,
            "roles": [Role.PLAYER.value],
            "city": profile.city if profile else None,
            "timezone": profile.timezone if profile else "Asia/Kolkata",
            "account_status": AccountStatus.ACTIVE.value,
            "notification_prefs": {"in_app": True, "push": True, "email": False, "muted_types": []},
            "agreement_version_accepted": None,
            "created_at": now,
            "updated_at": now,
        }
        try:
            doc = await self.users.insert(fields)
        except AppError:  # lost a race for the same number: sign in to the account that won
            existing = await self.users.by_mobile(mobile)
            if not existing:
                raise
            return existing
        await self.c.audit.log(actor_id=doc["_id"], action="user.registered", entity_type="user", entity_id=doc["_id"])
        return doc

    async def _claim_unverified(self, user: dict[str, Any], profile: SignupProfileIn | None) -> dict[str, Any]:
        """First proof of the number on a record that already existed unverified (an invite-link account,
        or a legacy pending registration). Credentials set before the number was proven are never trusted:
        they're removed and their sessions ended; the verifier's own sign-up details, if sent, replace them."""
        now = utcnow()
        fields: dict[str, Any] = {
            "mobile_verified": True,
            "phone_verified_at": now,
            "password_hash": None,
            "email": None,
            "email_verified": False,
            "email_verified_at": None,
            "registration_completed_at": None,  # finished by POST /users/me/registration
        }
        had_credentials = bool(user.get("password_hash") or user.get("email"))
        if profile:
            fields |= {
                "full_name": profile.full_name,
                "city": profile.city or user.get("city"),
                "email": await self._email_free(str(profile.email) if profile.email else None, user["_id"]),
                "password_hash": hash_secret(profile.password) if profile.password else None,
            }
        updated = await self.users.update(user["_id"], fields)
        assert updated is not None
        if had_credentials:
            await self.tokens.update_many(
                {"user_id": user["_id"], "revoked_at": None}, {"$set": {"revoked_at": utcnow()}}
            )
            await self.c.audit.log(
                actor_id=user["_id"],
                action="user.preverification_credentials_removed",
                entity_type="user",
                entity_id=user["_id"],
            )
        await self.c.audit.log(
            actor_id=user["_id"], action="user.registered", entity_type="user", entity_id=user["_id"]
        )
        return updated

    async def password_login(self, email: str, password: str, user_agent: str | None) -> TokenOut:
        # Per-account lockout (on top of the per-IP rate limit) so rotating IPs can't keep guessing one password.
        # Keyed by the email as typed, so it behaves the same whether or not the account exists.
        key = email.strip().lower()
        fails = self.c.mongo["login_failures"]
        window = timedelta(minutes=self.s.login_lockout_minutes)
        rec = await fails.find_one({"email": key})
        if rec and rec.get("count", 0) >= self.s.login_max_failures and ensure_utc(rec["last_at"]) > utcnow() - window:
            raise RateLimited(
                f"Too many failed attempts. Try again in {self.s.login_lockout_minutes} minutes "
                "or reset your password.",
                code="LOGIN_LOCKED",
            )
        user = await self.users.by_email(email)
        # Same error whether the account exists or not.
        if not user or not user.get("password_hash") or not verify_secret(password, user["password_hash"]):
            now = utcnow()
            stale = rec is not None and ensure_utc(rec["last_at"]) <= now - window
            if rec and not stale:
                await fails.update_one(
                    {"email": key}, {"$inc": {"count": 1}, "$set": {"last_at": now, "expires_at": now + window}}
                )
            else:
                await fails.update_one(
                    {"email": key}, {"$set": {"count": 1, "last_at": now, "expires_at": now + window}}, upsert=True
                )
            raise Unauthorized("Invalid email or password", code="INVALID_CREDENTIALS")
        await fails.delete_one({"email": key})
        # Players who joined through a captain's invite link can sign in with their password before their
        # mobile is verified (it stays marked unverified until they complete an OTP).
        if not user.get("mobile_verified") and user.get("verified_via") not in ("captain_invite", "email"):
            raise Forbidden("Verify your mobile number first", code="MOBILE_NOT_VERIFIED")
        self._ensure_can_login(user)
        return await self._issue_tokens(user, user_agent, family_id=None)

    async def reset_password(self, mobile: str, code: str, new_password: str) -> None:
        await self._consume_otp(mobile, "reset_password", code)
        user = await self.users.by_mobile(mobile)
        if not user:
            raise NotFound("Account not found", code="ACCOUNT_NOT_FOUND")
        await self.users.update(user["_id"], {"password_hash": hash_secret(new_password)})
        await self.tokens.update_many({"user_id": user["_id"], "revoked_at": None}, {"$set": {"revoked_at": utcnow()}})
        await self.c.audit.log(
            actor_id=user["_id"], action="user.password_reset", entity_type="user", entity_id=user["_id"]
        )

    @staticmethod
    def _ensure_can_login(user: dict[str, Any]) -> None:
        status = user.get("account_status")
        if status == AccountStatus.DELETED:
            raise Unauthorized("Account not found", code="ACCOUNT_NOT_FOUND")
        if status == AccountStatus.SUSPENDED:
            until = user.get("suspended_until")
            if not until or ensure_utc(until) > utcnow():
                raise Forbidden("Your account is suspended", code="ACCOUNT_SUSPENDED")

    # --------------------------------------------------------------- tokens
    async def _issue_tokens(self, user: dict[str, Any], user_agent: str | None, family_id: str | None) -> TokenOut:
        fam = family_id or uuid.uuid4().hex  # device session id; carried in the access token as "fam"
        access, ttl = create_access_token(self.s, str(user["_id"]), user.get("roles", []), extra={"fam": fam})
        refresh = generate_refresh_token()
        now = utcnow()
        await self.tokens.insert_one(
            {
                "_id": uuid.uuid4().hex,
                "user_id": user["_id"],
                "family_id": fam,
                "token_hash": sha256(refresh),
                "revoked_at": None,
                "replaced_by": None,
                "expires_at": now + timedelta(days=self.s.refresh_token_ttl_days),
                "created_at": now,
                "user_agent": (user_agent or "")[:200],
            }
        )
        return TokenOut(
            access_token=access,
            refresh_token=refresh,
            expires_in=ttl,
            user=await UserService(self.c).to_out(user),
        )

    async def refresh(self, refresh_token: str, user_agent: str | None) -> TokenOut:
        token_hash = sha256(refresh_token)
        doc = await self.tokens.find_one({"token_hash": token_hash})
        if not doc:
            raise Unauthorized("Invalid refresh token", code="REFRESH_INVALID")
        if doc.get("revoked_at") is not None:
            successor = await self._grace_successor(doc)
            if successor is None:
                await self._revoke_family(doc["family_id"])
                raise Unauthorized("Refresh token reuse detected; please log in again", code="REFRESH_REUSED")
            doc = successor  # same client racing its own rotation: continue from the unused successor
        if ensure_utc(doc["expires_at"]) <= utcnow():
            raise Unauthorized("Refresh token expired", code="REFRESH_EXPIRED")
        first = await self.tokens.find_one({"family_id": doc["family_id"]}, sort=[("created_at", 1)])
        if first and utcnow() - ensure_utc(first["created_at"]) > timedelta(days=self.s.session_absolute_days):
            await self._revoke_family(doc["family_id"])
            raise Unauthorized("Session expired. Please log in again.", code="SESSION_EXPIRED")
        # Atomic claim: only one concurrent refresh may rotate this token.
        claimed = await self.tokens.update_one(
            {"_id": doc["_id"], "revoked_at": None}, {"$set": {"revoked_at": utcnow()}}
        )
        if claimed.modified_count == 0:
            await self._revoke_family(doc["family_id"])
            raise Unauthorized("Refresh token reuse detected", code="REFRESH_REUSED")
        user = await self.users.get(doc["user_id"])
        if not user:
            raise Unauthorized("Account not found", code="ACCOUNT_NOT_FOUND")
        self._ensure_can_login(user)
        out = await self._issue_tokens(user, user_agent, family_id=doc["family_id"])
        await self.tokens.update_one({"_id": doc["_id"]}, {"$set": {"replaced_by": sha256(out.refresh_token)}})
        return out

    async def list_sessions(self, user_id: ObjectId, current_family: str | None) -> list[SessionOut]:
        """One row per signed-in device: a family of rotating refresh tokens."""
        now = utcnow()
        pipe: list[dict[str, Any]] = [
            {"$match": {"user_id": user_id, "revoked_at": None, "expires_at": {"$gt": now}}},
            {
                "$group": {
                    "_id": "$family_id",
                    "started_at": {"$min": "$created_at"},
                    "last_used_at": {"$max": "$created_at"},
                    "user_agent": {"$first": "$user_agent"},
                }
            },
            {"$sort": {"last_used_at": -1}},
            {"$limit": 50},
        ]
        rows = [r async for r in await self.tokens.aggregate(pipe)]
        return [
            SessionOut(
                id=r["_id"],
                user_agent=r.get("user_agent") or "",
                started_at=r["started_at"],
                last_used_at=r["last_used_at"],
                current=r["_id"] == current_family,
            )
            for r in rows
        ]

    async def revoke_session(self, user_id: ObjectId, family_id: str) -> None:
        res = await self.tokens.update_many(
            {"family_id": family_id, "user_id": user_id, "revoked_at": None}, {"$set": {"revoked_at": utcnow()}}
        )
        if res.matched_count == 0:
            raise NotFound("Session not found")

    async def logout_all(self, user: Any) -> None:
        """Revoke every refresh token AND invalidate access tokens already issued (checked via iat)."""
        now = utcnow()
        await self.tokens.update_many({"user_id": user.id, "revoked_at": None}, {"$set": {"revoked_at": now}})
        await self.c.mongo["users"].update_one({"_id": user.id}, {"$set": {"sessions_valid_after": now}})
        await self.c.audit.log(actor_id=user.id, action="auth.logout_all", entity_type="user", entity_id=user.id)

    async def _grace_successor(self, doc: dict[str, Any]) -> dict[str, Any] | None:
        """The unused successor of a token rotated moments ago, or None when this replay must be treated as theft."""
        grace = self.s.refresh_reuse_grace_seconds
        revoked_at, replaced_by = doc.get("revoked_at"), doc.get("replaced_by")
        if not grace or not replaced_by or revoked_at is None:
            return None
        if (utcnow() - ensure_utc(revoked_at)).total_seconds() > grace:
            return None
        return await self.tokens.find_one({"token_hash": replaced_by, "revoked_at": None, "replaced_by": None})

    async def logout(self, refresh_token: str) -> None:
        doc = await self.tokens.find_one({"token_hash": sha256(refresh_token)})
        if doc:
            await self._revoke_family(doc["family_id"])

    async def _revoke_family(self, family_id: str) -> None:
        await self.tokens.update_many({"family_id": family_id, "revoked_at": None}, {"$set": {"revoked_at": utcnow()}})

    async def user_id_from_mobile(self, mobile: str) -> ObjectId | None:
        u = await self.users.by_mobile(mobile)
        return u["_id"] if u else None
