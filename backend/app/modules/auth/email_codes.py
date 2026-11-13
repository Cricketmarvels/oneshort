"""Email codes: sign-up verified by email instead of SMS, and password reset for those accounts.

Sign-up (POST /auth/email-signup/start → /auth/email-signup/verify)
- The form (name, email, mobile, password) is validated, then a 6-digit code goes to the email. The details
  travel again WITH the code, so nothing is stored for an address nobody has proven.
- Creating the account needs the code: ``email_verified = true``, ``mobile_verified = false``
  (``verified_via = "email"``). The mobile number is recorded but NOT trusted until an SMS code proves it:
  no WhatsApp messages go to it, it can't be used for password reset, and if someone later proves that number
  with an SMS code, the number moves to them (see AuthService.verify_otp) instead of opening this account.
- Same reply for every start request, so the form can't be used to test which emails have accounts; an
  existing email is only reported after its owner has entered the code.

Password reset (POST /auth/email-reset/start → /auth/email-reset/verify)
- Only for accounts whose email is verified. Unverified emails are never a recovery route.

Codes: Argon2-hashed, 5-minute expiry, 5 attempts, single use, 60 s resend cooldown, per-address hourly and
daily caps, per-IP hourly cap and a global daily budget (real delivery only).
"""

from datetime import timedelta
from typing import Any, Literal

from app.common.enums import AccountStatus, Role
from app.common.types import ensure_utc, utcnow
from app.core.container import Container
from app.core.exceptions import AppError, Conflict, RateLimited, Unauthorized
from app.core.logging import get_logger
from app.core.security import generate_otp, hash_secret, verify_secret
from app.modules.auth.schemas import OtpSentOut, TokenOut

log = get_logger("auth.email_codes")
EmailPurpose = Literal["signup", "reset_password"]


class EmailCodes:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.s = c.settings
        self.col = c.mongo["otp_codes"]

    async def _limits(self, email: str, purpose: EmailPurpose, ip: str | None) -> None:
        now = utcnow()
        hour, day = now - timedelta(hours=1), now - timedelta(hours=24)
        log_q: dict[str, Any] = {"kind": "email_send_log"}
        if (
            await self.col.count_documents({**log_q, "email": email, "created_at": {"$gte": hour}})
            >= self.s.email_otp_max_sends_per_hour
        ):
            raise RateLimited("Too many codes for this email. Please try again later.", code="OTP_RATE_LIMITED")
        last = await self.col.find_one({**log_q, "email": email, "purpose": purpose}, sort=[("created_at", -1)])
        if last and (now - ensure_utc(last["created_at"])).total_seconds() < self.s.otp_resend_cooldown_seconds:
            raise RateLimited("Please wait before requesting another code.", code="OTP_COOLDOWN")
        if self.c.email.exposes_code:  # dev adapter sends nothing: spend caps don't apply
            return
        if (
            await self.col.count_documents({**log_q, "email": email, "created_at": {"$gte": day}})
            >= self.s.email_otp_max_sends_per_day
        ):
            raise RateLimited("Too many codes for this email today. Try again tomorrow.", code="OTP_RATE_LIMITED")
        if (
            ip
            and await self.col.count_documents({**log_q, "ip": ip, "created_at": {"$gte": hour}})
            >= self.s.otp_ip_max_sends_per_hour
        ):
            raise RateLimited("Too many requests. Please try again later.", code="OTP_RATE_LIMITED")
        sent = await self.col.count_documents({**log_q, "created_at": {"$gte": day}})
        if sent >= self.s.email_otp_daily_budget:
            log.error("email_otp.budget_exhausted", sent_24h=sent)
            raise RateLimited(
                "We can't send more codes right now. Please try again later.", code="OTP_BUDGET_EXHAUSTED"
            )

    async def send(
        self, email: str, purpose: EmailPurpose, ip: str | None, *, deliver: bool = True, show: bool = False
    ) -> OtpSentOut:
        """``deliver=False`` applies the same limits and the same reply without sending (unknown address)."""
        if not self.c.email.configured:
            raise AppError(
                "Email codes aren't available yet. Use your mobile number.", code="EMAIL_UNAVAILABLE", status_code=422
            )
        email = email.lower()
        await self._limits(email, purpose, ip)
        now = utcnow()
        await self.col.insert_one(
            {"kind": "email_send_log", "email": email, "purpose": purpose, "ip": ip, "created_at": now}
        )
        out = OtpSentOut(sent=True, expires_in=self.s.otp_ttl_seconds, resend_after=self.s.otp_resend_cooldown_seconds)
        if not deliver:
            return out
        code = generate_otp()
        await self.col.delete_many({"kind": "email_code", "email": email, "purpose": purpose})
        await self.col.insert_one(
            {
                "kind": "email_code",
                "email": email,
                "purpose": purpose,
                "code_hash": hash_secret(code),
                "attempts": 0,
                "expires_at": now + timedelta(seconds=self.s.otp_ttl_seconds),
                "created_at": now,
            }
        )
        what = "create your OneShort account" if purpose == "signup" else "reset your OneShort password"
        await self.c.email.send(
            email,
            f"{code} is your OneShort code",
            f"Your code to {what} is {code}.\n\nIt expires in 5 minutes. Don't share it with anyone.\n"
            "If you didn't ask for this, you can ignore this email.\n\n— OneShort",
        )
        expose = self.c.email.exposes_code and ((self.s.is_dev_like and self.s.dev_otp_in_response) or show)
        out.dev_otp = code if expose else None
        return out

    async def consume(self, email: str, purpose: EmailPurpose, code: str) -> None:
        doc = await self.col.find_one_and_update(
            {"kind": "email_code", "email": email.lower(), "purpose": purpose, "expires_at": {"$gt": utcnow()}},
            {"$inc": {"attempts": 1}},
        )
        if not doc:
            raise Unauthorized("Code expired or not requested", code="OTP_EXPIRED")
        if doc["attempts"] >= self.s.otp_max_attempts:
            await self.col.delete_one({"_id": doc["_id"]})
            raise Unauthorized("Too many incorrect attempts. Request a new code.", code="OTP_LOCKED")
        if not verify_secret(code, doc["code_hash"]):
            raise Unauthorized("Incorrect code", code="OTP_INVALID")
        if (await self.col.delete_one({"_id": doc["_id"]})).deleted_count != 1:  # single use under concurrency
            raise Unauthorized("Code expired or not requested", code="OTP_EXPIRED")


def _tester(c: Container, mobile: str) -> bool:
    p = c.settings.tester_signup_prefix
    return bool(p and p.strip()) and c.settings.app_env not in ("beta", "production") and mobile.startswith(p or "\x00")


async def start_email_signup(c: Container, email: str, mobile: str, ip: str | None) -> OtpSentOut:
    users = c.mongo["users"]
    # Test mode: brand-new test numbers with a free address see their code on screen (never in production).
    show = _tester(c, mobile) and not await users.find_one({"email": email.lower()}, {"_id": 1})
    return await EmailCodes(c).send(email, "signup", ip, show=show)


async def finish_email_signup(
    c: Container,
    *,
    full_name: str,
    email: str,
    mobile: str,
    password: str,
    city: str | None,
    code: str,
    user_agent: str | None,
) -> TokenOut:
    from app.modules.auth.service import AuthService  # circular: the service owns token issuance

    await EmailCodes(c).consume(email, "signup", code)
    email = email.lower()
    users = c.mongo["users"]
    if await users.find_one({"email": email}, {"_id": 1}):
        raise Conflict("This email already has a OneShort account. Log in instead.", code="ACCOUNT_EXISTS")
    if await users.find_one({"mobile_number": mobile}, {"_id": 1}):
        raise Conflict(
            "This mobile number already has a OneShort account. Log in with it, or use a different number.",
            code="MOBILE_IN_USE",
        )
    now = utcnow()
    fields: dict[str, Any] = {
        "full_name": full_name,
        "mobile_number": mobile,
        "email": email,
        "email_verified": True,
        "email_verified_at": now,
        "mobile_verified": False,  # recorded, not proven: see the module docstring
        "phone_verified_at": None,
        "verified_via": "email",
        "password_hash": hash_secret(password),
        "profile_image": None,
        "roles": [Role.PLAYER.value],
        "city": city,
        "timezone": "Asia/Kolkata",
        "account_status": AccountStatus.ACTIVE.value,
        "notification_prefs": {"in_app": True, "push": True, "email": False, "muted_types": []},
        "agreement_version_accepted": None,
        "registration_completed_at": None,  # finished by POST /users/me/registration
        "created_at": now,
        "updated_at": now,
    }
    svc = AuthService(c)
    try:
        doc = await svc.users.insert(fields)
    except AppError as exc:  # lost a race for the same email or number
        raise Conflict(
            "This email or mobile number already has an account. Log in instead.", code="ACCOUNT_EXISTS"
        ) from exc
    await c.audit.log(actor_id=doc["_id"], action="user.registered_email", entity_type="user", entity_id=doc["_id"])
    out = await svc._issue_tokens(doc, user_agent, family_id=None)
    out.is_new_user = True
    return out


async def start_email_reset(c: Container, email: str, ip: str | None) -> OtpSentOut:
    user = await c.mongo["users"].find_one({"email": email.lower()})
    usable = (
        user is not None
        and user.get("email_verified")
        and user.get("account_status") not in (AccountStatus.DELETED, AccountStatus.SUSPENDED)
    )
    # Same reply and limits for unknown or unverified addresses, but no code.
    return await EmailCodes(c).send(email, "reset_password", ip, deliver=bool(usable))


async def finish_email_reset(c: Container, email: str, code: str, new_password: str) -> None:
    await EmailCodes(c).consume(email, "reset_password", code)
    users = c.mongo["users"]
    user = await users.find_one({"email": email.lower(), "email_verified": True})
    if not user:
        raise Unauthorized("Code expired or not requested", code="OTP_EXPIRED")
    await users.update_one(
        {"_id": user["_id"]}, {"$set": {"password_hash": hash_secret(new_password), "updated_at": utcnow()}}
    )
    await c.mongo["refresh_tokens"].update_many(
        {"user_id": user["_id"], "revoked_at": None}, {"$set": {"revoked_at": utcnow()}}
    )
    await c.audit.log(
        actor_id=user["_id"], action="user.password_reset_email", entity_type="user", entity_id=user["_id"]
    )
