import pytest

from app.core.logging import REDACTED, redact_processor


def test_sensitive_fields_are_redacted_recursively() -> None:
    event = {
        "event": "x",
        "otp": "123456",
        "payload": {"location": {"coordinates": [77.6, 12.9]}, "password": "p", "ok": 1},
        "items": [{"access_token": "t"}],
    }
    out = redact_processor(None, "info", event)
    assert out["otp"] == REDACTED
    assert out["payload"]["location"] == REDACTED and out["payload"]["password"] == REDACTED
    assert out["payload"]["ok"] == 1
    assert out["items"][0]["access_token"] == REDACTED


def test_uvicorn_websocket_url_token_is_masked(caplog: pytest.LogCaptureFixture) -> None:
    import logging

    from app.core.logging import install_query_secret_filter

    install_query_secret_filter()
    with caplog.at_level(logging.INFO, logger="uvicorn.error"):
        logging.getLogger("uvicorn.error").info(
            '%s - "WebSocket %s" %d', "127.0.0.1:5000", "/api/v1/ws?token=eyJhbGciOi.secret.sig&x=1", 403
        )
    text = caplog.text
    assert "eyJhbGciOi" not in text and "token=[REDACTED]&x=1" in text
