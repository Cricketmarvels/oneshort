"""Sentry stays off without a DSN, and events are scrubbed before they leave the server."""

from app.core.config import Settings
from app.core.observability import _scrub_breadcrumb, _scrub_event, init_sentry


def test_sentry_off_without_dsn() -> None:
    assert init_sentry(Settings(sentry_dsn=None)) is False


def test_event_scrubbing_removes_pii_and_secrets() -> None:
    event = {
        "request": {
            "url": "https://api.gofindr.in/api/v1/players/nearby",
            "query_string": "lat=28.57&lng=77.32",
            "data": {"password": "hunter2"},
            "cookies": {"session": "x"},
            "headers": {"Authorization": "Bearer abc", "User-Agent": "ua", "X-Forwarded-For": "1.2.3.4"},
        },
        "user": {"id": "u1", "email": "a@b.in", "ip_address": "1.2.3.4"},
        "exception": {
            "values": [
                {
                    "value": 'E11000 dup key: { mobile_number: "+919876543210" } a.b@x.in',
                    "stacktrace": {"frames": [{"function": "f", "vars": {"password": "p"}}]},
                }
            ]
        },
        "extra": {"otp": "123456", "count": 3},
    }
    out = _scrub_event(event)
    req = out["request"]
    assert "data" not in req and "cookies" not in req and req["query_string"] == ""
    assert req["headers"] == {"User-Agent": "ua"}
    assert out["user"] == {"id": "u1"}
    val = out["exception"]["values"][0]
    assert "+91" not in val["value"] and "@" not in val["value"]
    assert "vars" not in val["stacktrace"]["frames"][0]
    assert out["extra"] == {"otp": "[REDACTED]", "count": 3}


def test_breadcrumb_scrubbing_drops_query_strings() -> None:
    crumb = {"message": "call +447700900001", "data": {"url": "https://x/api?token=abc", "http.query": "token=abc"}}
    out = _scrub_breadcrumb(crumb)
    assert out is not None
    assert out["data"] == {"url": "https://x/api", "http.query": ""} and "+44" not in out["message"]
