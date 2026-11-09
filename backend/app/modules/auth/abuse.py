"""OTP send budgets (SMS-pumping / toll-fraud protection, auth review H1).

Enforced only when the send would cost real money — a real SMS provider or a non-simulator WhatsApp
channel. The console sender (development, tests) and the WhatsApp simulator are free, so development
flows and the seeded fictional +44 7700 900xxx numbers stay unaffected.

Budgets (all configurable):
- country allowlist (default +91): a rotating script can't burn spend on premium international numbers
- per number: `otp_max_sends_per_hour` (existing) and `otp_max_sends_per_day`
- per IP: `otp_ip_max_sends_per_hour`
- global: `otp_daily_budget` across all numbers, alerting at 80% and refusing at 100%
"""

from datetime import timedelta
from typing import Any

from app.common.types import utcnow
from app.core.container import Container
from app.core.exceptions import AppError, RateLimited
from app.core.logging import get_logger

log = get_logger("auth.abuse")


def send_costs_money(c: Container, channel: str) -> bool:
    if channel == "whatsapp":
        return c.whatsapp.configured and c.settings.whatsapp_provider != "simulator"
    return not c.otp_sender.exposes_code


async def enforce_send_budgets(c: Container, mobile: str, ip: str | None, channel: str) -> None:
    """Raise before a paid OTP send that breaks a budget. Free senders return immediately."""
    if not send_costs_money(c, channel):
        return
    s = c.settings
    if not any(mobile.startswith(p) for p in s.otp_allowed_prefixes):
        raise AppError(
            "PlayR can only send codes to Indian mobile numbers right now.",
            code="OTP_REGION_UNSUPPORTED",
            status_code=422,
        )
    col = c.mongo["otp_codes"]
    now = utcnow()
    day_ago, hour_ago = now - timedelta(hours=24), now - timedelta(hours=1)
    q_day: dict[str, Any] = {"kind": "send_log", "created_at": {"$gte": day_ago}}

    if await col.count_documents({**q_day, "mobile_number": mobile}) >= s.otp_max_sends_per_day:
        raise RateLimited("Too many codes for this number today. Try again tomorrow.", code="OTP_RATE_LIMITED")
    if (
        ip
        and await col.count_documents({"kind": "send_log", "ip": ip, "created_at": {"$gte": hour_ago}})
        >= s.otp_ip_max_sends_per_hour
    ):
        raise RateLimited("Too many OTP requests. Please try again later.", code="OTP_RATE_LIMITED")

    global_day = await col.count_documents(q_day)
    if global_day >= s.otp_daily_budget:
        log.error("otp.budget_exhausted", sent_24h=global_day, budget=s.otp_daily_budget)
        raise RateLimited("We can't send more codes right now. Please try again later.", code="OTP_BUDGET_EXHAUSTED")
    if global_day >= int(s.otp_daily_budget * 0.8):
        log.warning("otp.budget_nearly_exhausted", sent_24h=global_day, budget=s.otp_daily_budget)
