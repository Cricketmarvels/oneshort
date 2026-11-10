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
from app.modules.auth.schemas import OtpChannel, OtpPurpose, OtpSentOut, RegisterIn, RegisterOut, SessionOut, TokenOut
from app.modules.users.repository import UserRepository
from app.modules.users.service import UserService


class AuthService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.s = c.settings
        self.users = UserRepository(c.mongo)
        self.otps = c.mongo["otp_codes"]
        self.tokens = c.mongo["refresh_tokens"]

    # ---------------------------------------------------------------- OTP
    async def _issue_otp(
        self, mobile: str, purpose: OtpPurpose, channel: OtpChannel = "sms", ip: str | None = None
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

        code = generate_otp()
        await self.otps.delete_many({"kind": "code", "mobile_number": mobile, "purpose": purpose})
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
                f"{code} is your PlayR verification code. It expires in 5 minutes. Don't share it.",
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
                or (purpose == "register" and self._is_tester_number(mobile))
            )
        return OtpSentOut(
            sent=True,
            expires_in=self.s.otp_ttl_seconds,
            resend_after=self.s.otp_resend_cooldown_seconds,
            dev_otp=code if expose else None,
        )

    def _is_tester_number(self, mobile: str) -> bool:
        p = self.s.tester_signup_prefix
        return bool(p and p.strip()) and self.s.app_env != "production" and mobile.startswith(p or "\x00")

    async def _consume_otp(self, mobile: str, purpose: str, code: str) -> None:
        doc = await self.otps.find_one_and_update(
            {"kind": "code", "mobile_number": mobile, "purpose": purpose, "expires_at": {"$gt": utcnow()}},
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

    # --------------------------------------------------------- registration
    async def register(self, data: RegisterIn, ip: str | None = None) -> RegisterOut:
        if self._is_tester_number(data.mobile_number) and not data.password:
            raise BusinessRuleViolation(
                "Set a password so you can log back in with your email.", code="PASSWORD_REQUIRED"
            )
        existing = await self.users.by_mobile(data.mobile_number)
        if existing and (existing.get("mobile_verified") or existing.get("verified_via")):
            # verified_via (e.g. captain_invite) accounts can sign in before OTP verification, so letting a
            # re-registration overwrite their email/password would hand the account to whoever knows the number.
            raise BusinessRuleViolation(
                "This mobile number is already registered. Please log in.", code="ACCOUNT_EXISTS"
            )
        now = utcnow()
        fields: dict[str, Any] = {
            "full_name": data.full_name,
            "mobile_number": data.mobile_number,
            "email": str(data.email).lower(),
            "email_verified": False,
            "mobile_verified": False,
            "password_hash": hash_secret(data.password) if data.password else None,
            "profile_image": None,
            "roles": [Role.PLAYER.value],
            "city": data.city,
            "timezone": data.timezone,
            "account_status": AccountStatus.ACTIVE.value,
            "notification_prefs": {"in_app": True, "push": True, "email": False, "muted_types": []},
            "agreement_version_accepted": None,
            "updated_at": now,
        }
        if existing:  # unverified re-registration: refresh the pending details
            doc = await self.users.update(existing["_id"], fields)
            assert doc is not None
        else:
            other = await self.users.by_email(str(data.email))
            if other:
                raise BusinessRuleViolation("This email is already registered.", code="ACCOUNT_EXISTS")
            doc = await self.users.insert({**fields, "created_at": now})
        otp = await self._issue_otp(data.mobile_number, "register", data.otp_channel, ip)
        return RegisterOut(user_id=str(doc["_id"]), otp=otp)

    async def send_otp(
        self, mobile: str, purpose: OtpPurpose, channel: OtpChannel = "sms", ip: str | None = None
    ) -> OtpSentOut:
        user = await self.users.by_mobile(mobile)
        if purpose in ("login", "reset_password"):
            # A started-but-unverified registration may finish via a login code: the code proves the number,
            # and verify_otp marks it verified. Password reset still needs a verified account.
            unfinished = purpose == "login" and user is not None and not user.get("mobile_verified")
            if not user or (not user.get("mobile_verified") and not unfinished):
                raise NotFound("No account found for this number. Please register.", code="ACCOUNT_NOT_FOUND")
            self._ensure_can_login(user)
        if purpose == "register" and (not user or user.get("mobile_verified")):
            raise BusinessRuleViolation("Start registration first", code="REGISTRATION_REQUIRED")
        return await self._issue_otp(mobile, purpose, channel, ip)

    async def verify_otp(self, mobile: str, code: str, purpose: str, user_agent: str | None) -> TokenOut:
        await self._consume_otp(mobile, purpose, code)
        user = await self.users.by_mobile(mobile)
        if not user:
            raise NotFound("Account not found", code="ACCOUNT_NOT_FOUND")
        self._ensure_can_login(user)
        if not user.get("mobile_verified"):
            fields: dict[str, Any] = {"mobile_verified": True}
            stripped = False
            if purpose == "login" and (user.get("password_hash") or user.get("email")):
                # The email/password on this record were set before anyone proved they own the number
                # (a stale or hostile registration, or an invite-link sign-up). The person holding the
                # phone is the account's owner: remove the unproven credentials and end their sessions.
                fields |= {"password_hash": None, "email": None, "email_verified": False}
                stripped = True
            user = await self.users.update(user["_id"], fields)
            assert user is not None
            if stripped:
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
        return await self._issue_tokens(user, user_agent, family_id=None)

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
        if not user.get("mobile_verified") and user.get("verified_via") != "captain_invite":
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
            await self._revoke_family(doc["family_id"])
            raise Unauthorized("Refresh token reuse detected; please log in again", code="REFRESH_REUSED")
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

    async def logout(self, refresh_token: str) -> None:
        doc = await self.tokens.find_one({"token_hash": sha256(refresh_token)})
        if doc:
            await self._revoke_family(doc["family_id"])

    async def _revoke_family(self, family_id: str) -> None:
        await self.tokens.update_many({"family_id": family_id, "revoked_at": None}, {"$set": {"revoked_at": utcnow()}})

    async def user_id_from_mobile(self, mobile: str) -> ObjectId | None:
        u = await self.users.by_mobile(mobile)
        return u["_id"] if u else None
