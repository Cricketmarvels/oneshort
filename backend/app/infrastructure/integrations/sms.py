"""OTP delivery providers. Business logic depends only on the ``OtpSender`` protocol."""

from typing import Protocol

import httpx

from app.core.config import Settings
from app.core.exceptions import AppError
from app.core.logging import get_logger

log = get_logger("sms")


class OtpSender(Protocol):
    #: True when the code must be returned to the client (dev only).
    exposes_code: bool

    async def send(self, mobile_number: str, code: str) -> None: ...


class ConsoleOtpSender:
    """DEVELOPMENT ADAPTER. Does not send SMS. The code is returned in the API
    response (``dev_otp``) and never written to logs. Blocked in production by config."""

    exposes_code = True

    async def send(self, mobile_number: str, code: str) -> None:
        log.info("otp.dev_adapter.issued")  # deliberately no number or code


class Msg91OtpSender:
    """MSG91 (India) OTP adapter. UNCONFIGURED until MSG91_AUTH_KEY/TEMPLATE_ID are set and tested."""

    exposes_code = False

    def __init__(self, auth_key: str, template_id: str) -> None:
        self._auth_key = auth_key
        self._template_id = template_id

    async def send(self, mobile_number: str, code: str) -> None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://control.msg91.com/api/v5/otp",
                headers={"authkey": self._auth_key},
                json={
                    "template_id": self._template_id,
                    "mobile": mobile_number.lstrip("+"),
                    "otp": code,
                },
            )
        if resp.status_code >= 400:
            log.error("otp.msg91.failed", status=resp.status_code)
            raise AppError("Could not send OTP", code="OTP_DELIVERY_FAILED", status_code=502)


class TwilioOtpSender:
    """Twilio SMS adapter. UNCONFIGURED until credentials are set and tested."""

    exposes_code = False

    def __init__(self, sid: str, token: str, from_number: str) -> None:
        self._sid, self._token, self._from = sid, token, from_number

    async def send(self, mobile_number: str, code: str) -> None:
        async with httpx.AsyncClient(timeout=10, auth=(self._sid, self._token)) as client:
            resp = await client.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{self._sid}/Messages.json",
                data={
                    "To": mobile_number,
                    "From": self._from,
                    "Body": f"{code} is your CricketMarvels verification code. Valid for 5 minutes.",
                },
            )
        if resp.status_code >= 400:
            log.error("otp.twilio.failed", status=resp.status_code)
            raise AppError("Could not send OTP", code="OTP_DELIVERY_FAILED", status_code=502)


def build_otp_sender(settings: Settings) -> OtpSender:
    if settings.otp_provider == "msg91" and settings.msg91_auth_key and settings.msg91_template_id:
        return Msg91OtpSender(settings.msg91_auth_key, settings.msg91_template_id)
    if (
        settings.otp_provider == "twilio"
        and settings.twilio_account_sid
        and settings.twilio_auth_token
        and settings.twilio_from_number
    ):
        return TwilioOtpSender(settings.twilio_account_sid, settings.twilio_auth_token, settings.twilio_from_number)
    if settings.otp_provider != "console":
        raise RuntimeError(f"OTP provider '{settings.otp_provider}' selected but not configured")
    return ConsoleOtpSender()
