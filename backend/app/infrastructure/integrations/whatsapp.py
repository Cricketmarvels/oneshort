"""WhatsApp message delivery. Business logic depends only on the ``WhatsAppSender`` protocol.

Status values recorded on the invitation (never the phone number or text):
  sent            provider accepted the message
  failed          provider rejected it or was unreachable
  not_configured  no provider set up (the default) — nothing was sent
  opted_out       the player hasn't switched on WhatsApp updates
  no_number       the player has no verified mobile number

Both real adapters are UNCONFIGURED and UNTESTED until credentials are set and a test message
is confirmed on a real handset. WhatsApp only allows business-initiated messages through an
approved template: Twilio sends the body as given (works in the Twilio sandbox and with a
matching approved template); Meta sends the named template with the message lines as
parameters.
"""

import json
from typing import Any, Literal, Protocol

import httpx

from app.core.config import Settings
from app.core.logging import get_logger

log = get_logger("whatsapp")
Status = Literal["sent", "failed", "not_configured", "opted_out", "no_number"]


Kind = Literal["invite", "notify", "otp"]


class WhatsAppSender(Protocol):
    configured: bool

    async def send(self, to_e164: str, body: str, params: list[str], kind: Kind = "invite") -> Status: ...


#: Provider error codes that mean "the recipient has no open WhatsApp session" (sandbox not joined / window closed).
NEEDS_SESSION = {21654, 63015, 63016, 63051, 131047}  # Twilio + Meta (131047 = outside 24-hour window)


def failure_reason(sender: object) -> str:
    """Plain-English reason for the last failed send (from the provider's numeric code)."""
    code = getattr(sender, "last_error", None)
    if code in NEEDS_SESSION:
        return (
            "WhatsApp needs you to message OneShort's WhatsApp number first (any message, or the sandbox join "
            "code). Then tap the button again within 24 hours."
        )
    if code in (21211, 21614, 63003):
        return "That number can't receive WhatsApp messages. Check the number or use SMS."
    if code == 63007:
        return "OneShort's WhatsApp sender isn't set up correctly yet. Use SMS for now."
    if code in (131031, 368):
        return "OneShort's WhatsApp business account is restricted by Meta right now. Use SMS for now."
    if code == 131030:
        return (
            "This number isn't on OneShort's WhatsApp test list yet. "
            "Add it as a recipient in Meta's WhatsApp test setup."
        )
    if code in (190, 10, 200):
        return "OneShort's WhatsApp access has expired. Use SMS for now."
    if code in (132001, 132000, 132012):
        return "OneShort's WhatsApp message template isn't approved yet. Use SMS for now."
    return "Couldn't send the code on WhatsApp. Try again or use SMS."


class DisabledWhatsApp:
    """Default: no provider. Sends nothing and says so."""

    configured = False

    async def send(self, to_e164: str, body: str, params: list[str], kind: Kind = "invite") -> Status:
        return "not_configured"


class TwilioWhatsApp:
    """Twilio WhatsApp. Free-form bodies only work inside WhatsApp's 24-hour window (the recipient messaged
    the sender recently — for the sandbox, the `join` message). Outside it, Twilio needs an approved Content
    template (error 21654): set TWILIO_CONTENT_*_SID and the template is sent with the params as variables."""

    configured = True
    #: Twilio's numeric error code from the last failed send (no PII), for user-facing reasons.
    last_error: int | None = None

    def __init__(
        self, sid: str, token: str, from_number: str, content_sids: dict[str, str | None] | None = None
    ) -> None:
        self._sid, self._token = sid, token
        self._from = from_number if from_number.startswith("whatsapp:") else f"whatsapp:{from_number}"
        self._content = content_sids or {}

    async def send(self, to_e164: str, body: str, params: list[str], kind: Kind = "invite") -> Status:
        data = {"To": f"whatsapp:{to_e164}", "From": self._from}
        content_sid = self._content.get(kind)
        if content_sid:
            data["ContentSid"] = content_sid
            data["ContentVariables"] = json.dumps({str(i + 1): p[:1000] for i, p in enumerate(params)})
        else:
            data["Body"] = body
        try:
            async with httpx.AsyncClient(timeout=10, auth=(self._sid, self._token)) as client:
                resp = await client.post(
                    f"https://api.twilio.com/2010-04-01/Accounts/{self._sid}/Messages.json", data=data
                )
        except httpx.HTTPError:
            log.error("whatsapp.twilio.unreachable")
            return "failed"
        if resp.status_code >= 400:
            try:
                self.last_error = int(resp.json().get("code") or 0) or None
            except (ValueError, TypeError):
                self.last_error = None
            log.error("whatsapp.twilio.failed", status=resp.status_code, twilio_code=self.last_error)
            return "failed"
        self.last_error = None
        return "sent"


class MetaWhatsApp:
    """WhatsApp Cloud API (Meta). Works with Meta's free test number (up to 5 verified recipients).

    For each message kind it sends the approved template when one is configured (needed outside
    WhatsApp's 24-hour window — always for login codes in production); otherwise it sends plain text,
    which Meta delivers only inside the 24-hour window that opens when the recipient messages the
    business number. Meta's numeric error code is kept in ``last_error`` (no PII) for user-facing reasons.
    """

    configured = True
    last_error: int | None = None

    def __init__(
        self,
        token: str,
        phone_number_id: str,
        templates: dict[str, str | None],
        language: str,
        api_version: str = "v25.0",
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._token, self._phone_id, self._templates, self._lang = token, phone_number_id, templates, language
        self._version, self._transport = api_version, transport

    def _payload(self, to_e164: str, body: str, params: list[str], kind: Kind) -> dict[str, object]:
        to = to_e164.lstrip("+")
        template = self._templates.get(kind)
        if not template:
            return {
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": {"body": body[:4096], "preview_url": False},
            }
        components: list[dict[str, object]] = []
        if params:
            components.append({"type": "body", "parameters": [{"type": "text", "text": p[:1000]} for p in params]})
        if kind == "otp":  # authentication templates repeat the code in the copy-code button
            components.append(
                {"type": "button", "sub_type": "url", "index": "0", "parameters": [{"type": "text", "text": params[0]}]}
            )
        return {
            "messaging_product": "whatsapp",
            "to": to,
            "type": "template",
            "template": {"name": template, "language": {"code": self._lang}, "components": components},
        }

    async def send(self, to_e164: str, body: str, params: list[str], kind: Kind = "invite") -> Status:
        try:
            async with httpx.AsyncClient(timeout=10, transport=self._transport) as client:
                resp = await client.post(
                    f"https://graph.facebook.com/{self._version}/{self._phone_id}/messages",
                    headers={"Authorization": f"Bearer {self._token}"},
                    json=self._payload(to_e164, body, params, kind),
                )
        except httpx.HTTPError:
            log.error("whatsapp.meta.unreachable")
            return "failed"
        if resp.status_code >= 400:
            try:
                self.last_error = int((resp.json().get("error") or {}).get("code") or 0) or None
            except (ValueError, TypeError, AttributeError):
                self.last_error = None
            log.error("whatsapp.meta.failed", status=resp.status_code, meta_code=self.last_error)
            return "failed"
        self.last_error = None
        return "sent"


class SimulatorWhatsApp:
    """TEST MODE: delivers nothing. Each message is stored in `whatsapp_outbox` (auto-expires after 24 h) and shown
    in OneShort's "WhatsApp simulator" screen, so OTP login, invitations and notifications can be tested end to end
    without a provider. Refused in production (see Settings). Message text is never logged."""

    configured = True
    last_error: int | None = None

    def __init__(self, mongo: Any) -> None:
        self._col = mongo["whatsapp_outbox"]

    async def send(self, to_e164: str, body: str, params: list[str], kind: Kind = "invite") -> Status:
        from app.common.types import utcnow  # local import keeps this module free of app-layer imports at load

        await self._col.insert_one(
            {"to": to_e164, "body": body, "kind": kind, "params": params, "created_at": utcnow()}
        )
        log.info("whatsapp.simulator.stored", kind=kind)
        return "sent"


def build_whatsapp_sender(settings: Settings, mongo: Any = None) -> WhatsAppSender:
    p = settings.whatsapp_provider
    if p == "simulator" and mongo is not None:
        return SimulatorWhatsApp(mongo)
    if p == "twilio" and settings.twilio_account_sid and settings.twilio_auth_token and settings.twilio_whatsapp_from:
        content = {
            "otp": settings.twilio_content_otp_sid,
            "notify": settings.twilio_content_notify_sid,
            "invite": settings.twilio_content_invite_sid,
        }
        return TwilioWhatsApp(
            settings.twilio_account_sid, settings.twilio_auth_token, settings.twilio_whatsapp_from, content
        )
    if p == "meta" and settings.whatsapp_meta_token and settings.whatsapp_meta_phone_number_id:
        templates = {
            "invite": settings.whatsapp_meta_template,
            "notify": settings.whatsapp_meta_notify_template,
            "otp": settings.whatsapp_meta_otp_template,
        }
        return MetaWhatsApp(
            settings.whatsapp_meta_token,
            settings.whatsapp_meta_phone_number_id,
            templates,
            settings.whatsapp_meta_language,
        )
    if p != "none":
        raise RuntimeError(f"WhatsApp provider '{p}' selected but not configured")
    return DisabledWhatsApp()
