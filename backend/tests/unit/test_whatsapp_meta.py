"""Meta WhatsApp Cloud API adapter: payload shapes and error capture (no network — httpx MockTransport)."""

import json

import httpx

from app.infrastructure.integrations.whatsapp import MetaWhatsApp, failure_reason


def _adapter(templates: dict[str, str | None], reply: httpx.Response, seen: list[dict]) -> MetaWhatsApp:  # type: ignore[type-arg]
    def handler(req: httpx.Request) -> httpx.Response:
        seen.append({"url": str(req.url), "auth": req.headers.get("authorization"), "json": json.loads(req.content)})
        return reply

    return MetaWhatsApp("tok", "PHONE1", templates, "en", "v25.0", transport=httpx.MockTransport(handler))


async def test_text_fallback_without_template() -> None:
    seen: list[dict] = []  # type: ignore[type-arg]
    wa = _adapter({}, httpx.Response(200, json={"messages": [{"id": "wamid.1"}]}), seen)
    assert await wa.send("+919800000001", "PlayR · hello", ["hello"], "notify") == "sent"
    assert seen[0]["url"] == "https://graph.facebook.com/v25.0/PHONE1/messages" and seen[0]["auth"] == "Bearer tok"
    assert seen[0]["json"] == {
        "messaging_product": "whatsapp",
        "to": "919800000001",
        "type": "text",
        "text": {"body": "PlayR · hello", "preview_url": False},
    }


async def test_otp_template_has_body_and_copy_code_button() -> None:
    seen: list[dict] = []  # type: ignore[type-arg]
    wa = _adapter({"otp": "playr_login_code"}, httpx.Response(200, json={}), seen)
    assert await wa.send("+919800000001", "123456 is your code", ["123456"], "otp") == "sent"
    t = seen[0]["json"]["template"]
    assert t["name"] == "playr_login_code" and t["language"] == {"code": "en"}
    assert t["components"][0] == {"type": "body", "parameters": [{"type": "text", "text": "123456"}]}
    assert t["components"][1]["type"] == "button" and t["components"][1]["parameters"] == [
        {"type": "text", "text": "123456"}
    ]


async def test_meta_error_code_is_kept_and_explained() -> None:
    seen: list[dict] = []  # type: ignore[type-arg]
    wa = _adapter(
        {}, httpx.Response(400, json={"error": {"code": 131030, "message": "Recipient not in allowed list"}}), seen
    )
    assert await wa.send("+919800000001", "x", ["x"], "notify") == "failed"
    assert wa.last_error == 131030 and "test list" in failure_reason(wa)
    wa2 = _adapter({}, httpx.Response(400, json={"error": {"code": 131047}}), [])
    assert await wa2.send("+919800000001", "x", ["x"], "notify") == "failed" and "message PlayR" in failure_reason(wa2)
