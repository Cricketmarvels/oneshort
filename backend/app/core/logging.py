"""Structured JSON logging with sensitive-field redaction.

Never log OTPs, passwords, tokens or precise locations: the redaction processor
masks any of these keys wherever they appear in a log event.
"""

import logging
import re
import sys
from collections.abc import MutableMapping
from typing import Any

import structlog

SENSITIVE_KEYS = frozenset(
    {
        "otp",
        "code",
        "password",
        "password_hash",
        "token",
        "access_token",
        "refresh_token",
        "authorization",
        "location",
        "coordinates",
        "home_location",
        "lat",
        "lng",
        "latitude",
        "longitude",
        "mobile_number",
        "email",
        "secret",
        "api_key",
        "cookie",
        "x-hub-signature-256",
    }
)
REDACTED = "[REDACTED]"


def _redact(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: (REDACTED if k.lower() in SENSITIVE_KEYS else _redact(v)) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [_redact(v) for v in value]
    return value


def redact_processor(_logger: Any, _method: str, event_dict: MutableMapping[str, Any]) -> MutableMapping[str, Any]:
    for key in list(event_dict.keys()):
        if key.lower() in SENSITIVE_KEYS:
            event_dict[key] = REDACTED
        else:
            event_dict[key] = _redact(event_dict[key])
    return event_dict


_PHONE = re.compile(r"\+\d{10,15}\b")
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


def scrub_text(text: str) -> str:
    """Mask phone numbers and email addresses in free text (exception messages, e.g. Mongo duplicate-key errors)."""
    return _EMAIL.sub("[EMAIL]", _PHONE.sub("[PHONE]", text))


def scrub_exception_processor(
    _logger: Any, _method: str, event_dict: MutableMapping[str, Any]
) -> MutableMapping[str, Any]:
    exc = event_dict.get("exception")
    if isinstance(exc, str):
        event_dict["exception"] = scrub_text(exc)
    return event_dict


_QUERY_SECRET = re.compile(r"([?&](?:token|access_token|refresh_token|otp|code)=)[^&\s\"']+", re.IGNORECASE)


class QuerySecretFilter(logging.Filter):
    """Masks secrets in URL query strings inside stdlib log records.

    Uvicorn logs the full WebSocket URL (including ``?token=``) when it rejects a handshake,
    even with ``--no-access-log``. This filter rewrites such records before any handler sees them.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        msg = record.getMessage()
        redacted = _QUERY_SECRET.sub(r"\1" + REDACTED, msg)
        if redacted != msg:
            record.msg, record.args = redacted, None
        return True


_SERVER_LOGGERS = ("", "uvicorn", "uvicorn.error", "uvicorn.access", "websockets", "websockets.server")


def install_query_secret_filter() -> None:
    """Attach the filter to server loggers and their handlers (idempotent)."""
    for name in _SERVER_LOGGERS:
        lg = logging.getLogger(name)
        targets: list[logging.Filterer] = [lg, *lg.handlers]
        for target in targets:
            if not any(isinstance(f, QuerySecretFilter) for f in target.filters):
                target.addFilter(QuerySecretFilter())


def configure_logging(level: str = "INFO", json_logs: bool = True) -> None:
    logging.basicConfig(format="%(message)s", stream=sys.stdout, level=level.upper())
    install_query_secret_filter()
    renderer: Any = structlog.processors.JSONRenderer() if json_logs else structlog.dev.ConsoleRenderer()
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            redact_processor,
            structlog.processors.format_exc_info,
            scrub_exception_processor,
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> Any:
    return structlog.get_logger(name)
