"""Email delivery. Business logic depends only on the ``EmailSender`` protocol.

Providers (EMAIL_PROVIDER):
- ``console``: development adapter. Sends nothing; the code may be shown on screen in dev/test mode. Never logs
  the address or the code. Refused in beta/production by config.
- ``smtp``: any SMTP server with STARTTLS (587) or implicit TLS (465). Free options that need no domain:
  Gmail with an app password (smtp.gmail.com, ~500/day) or Brevo's free plan (smtp-relay.brevo.com, 300/day).
  Uses the standard library, so there is no extra dependency or vendor SDK.
"""

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol

from app.core.config import Settings
from app.core.exceptions import AppError
from app.core.logging import get_logger

log = get_logger("email")


class EmailSender(Protocol):
    #: True for the dev adapter: nothing is delivered, so a code may be shown on screen in test mode.
    exposes_code: bool
    configured: bool

    async def send(self, to: str, subject: str, text: str) -> None: ...


class ConsoleEmailSender:
    exposes_code = True
    configured = True

    async def send(self, to: str, subject: str, text: str) -> None:
        log.info("email.dev_adapter.issued")  # deliberately no address, subject or body


class SmtpEmailSender:
    exposes_code = False
    configured = True

    def __init__(self, s: Settings) -> None:
        assert s.smtp_host and s.email_from
        self.host, self.port = s.smtp_host, s.smtp_port
        self.username = s.smtp_username
        self.password = s.smtp_password.get_secret_value() if s.smtp_password else None
        self.sender = s.email_from

    def _send(self, msg: EmailMessage) -> None:
        ctx = ssl.create_default_context()
        if self.port == 465:
            with smtplib.SMTP_SSL(self.host, self.port, context=ctx, timeout=15) as smtp:
                if self.username and self.password:
                    smtp.login(self.username, self.password)
                smtp.send_message(msg)
        else:
            with smtplib.SMTP(self.host, self.port, timeout=15) as smtp:
                smtp.starttls(context=ctx)
                if self.username and self.password:
                    smtp.login(self.username, self.password)
                smtp.send_message(msg)

    async def send(self, to: str, subject: str, text: str) -> None:
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = self.sender, to, subject
        msg.set_content(text)
        try:
            await asyncio.to_thread(self._send, msg)
        except (smtplib.SMTPException, OSError) as exc:
            log.error("email.smtp.failed", error=type(exc).__name__)  # never the address or the code
            raise AppError(
                "We couldn't send the email. Please try again.", code="EMAIL_DELIVERY_FAILED", status_code=502
            ) from exc


class DisabledEmailSender:
    exposes_code = False
    configured = False

    async def send(self, to: str, subject: str, text: str) -> None:
        raise AppError(
            "Email codes aren't available yet. Use your mobile number.", code="EMAIL_UNAVAILABLE", status_code=422
        )


def build_email_sender(s: Settings) -> EmailSender:
    if s.email_provider == "smtp" and s.smtp_host and s.email_from:
        return SmtpEmailSender(s)
    if s.email_provider == "console":
        return ConsoleEmailSender()
    return DisabledEmailSender()
