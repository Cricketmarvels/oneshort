"""Error tracking (Sentry). Off unless SENTRY_DSN is set.

Privacy defaults: no request bodies, cookies, auth headers, query strings or local variables are sent; the only user
detail is the internal user id. Exception messages and breadcrumbs pass through the same phone/email scrubber as logs.
"""

from typing import Any

import sentry_sdk

from app.core.config import Settings
from app.core.logging import SENSITIVE_KEYS, scrub_text

_DROP_HEADERS = {"authorization", "cookie", "x-hub-signature-256", "x-forwarded-for", "x-real-ip"}


def _scrub_event(event: dict[str, Any], _hint: dict[str, Any] | None = None) -> dict[str, Any]:
    req = event.get("request")
    if isinstance(req, dict):
        req.pop("data", None)
        req.pop("cookies", None)
        req["query_string"] = ""
        headers = req.get("headers")
        if isinstance(headers, dict):
            req["headers"] = {k: v for k, v in headers.items() if k.lower() not in _DROP_HEADERS}
    user = event.get("user")
    if isinstance(user, dict):
        event["user"] = {"id": user["id"]} if "id" in user else {}
    for exc in (event.get("exception") or {}).get("values") or []:
        if isinstance(exc.get("value"), str):
            exc["value"] = scrub_text(exc["value"])
        for frame in (exc.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)
    if isinstance(event.get("message"), str):
        event["message"] = scrub_text(event["message"])
    extra = event.get("extra")
    if isinstance(extra, dict):
        event["extra"] = {k: ("[REDACTED]" if k.lower() in SENSITIVE_KEYS else v) for k, v in extra.items()}
    return event


def _scrub_breadcrumb(crumb: dict[str, Any], _hint: dict[str, Any] | None = None) -> dict[str, Any] | None:
    if isinstance(crumb.get("message"), str):
        crumb["message"] = scrub_text(crumb["message"])
    data = crumb.get("data")
    if isinstance(data, dict):
        for k in ("url", "http.query", "http.fragment"):
            if isinstance(data.get(k), str):
                data[k] = data[k].split("?", 1)[0] if k == "url" else ""
    return crumb


def init_sentry(settings: Settings) -> bool:
    """Initialise Sentry once. Returns True when error tracking is on."""
    if not settings.sentry_dsn:
        return False
    if sentry_sdk.get_client().is_active():
        return True
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.app_env,
        release=settings.sentry_release,
        send_default_pii=False,
        include_local_variables=False,
        max_request_body_size="never",
        traces_sample_rate=settings.sentry_traces_sample_rate,
        before_send=_scrub_event,  # type: ignore[arg-type]
        before_breadcrumb=_scrub_breadcrumb,
    )
    return True


def tag_user(user_id: str) -> None:
    """Attach the internal user id (never name, phone or email) to the current scope."""
    sentry_sdk.set_user({"id": user_id})
