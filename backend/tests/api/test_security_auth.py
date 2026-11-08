"""Security: per-account password lockout; WhatsApp webhook must be signed."""

import hashlib
import hmac
import json

import httpx

from app.core.container import Container
from tests.conftest import register

API = "/api/v1"


async def test_password_lockout_after_repeated_failures(client: httpx.AsyncClient, container: Container) -> None:
    u = await register(client, "Lockout SEC", password="Correct-Horse-9")
    email = (await client.get(f"{API}/users/me", headers=u.h)).json()["data"]["email"]

    ok = await client.post(f"{API}/auth/login", json={"email": email, "password": "Correct-Horse-9"})
    assert ok.status_code == 200, ok.text
    limit = container.settings.login_max_failures
    for _ in range(limit):
        bad = await client.post(f"{API}/auth/login", json={"email": email, "password": "wrong-password"})
        assert bad.status_code == 401
    locked = await client.post(f"{API}/auth/login", json={"email": email, "password": "Correct-Horse-9"})
    assert locked.status_code == 429 and locked.json()["error"]["code"] == "LOGIN_LOCKED"

    # unknown emails lock the same way (no account enumeration)
    for _ in range(limit):
        await client.post(f"{API}/auth/login", json={"email": "nobody.sec@example.in", "password": "x" * 10})
    ghost = await client.post(f"{API}/auth/login", json={"email": "nobody.sec@example.in", "password": "x" * 10})
    assert ghost.status_code == 429

    # a successful login clears the counter
    await container.mongo["login_failures"].delete_many({"email": email})
    assert (
        await client.post(f"{API}/auth/login", json={"email": email, "password": "Correct-Horse-9"})
    ).status_code == 200
    assert await container.mongo["login_failures"].count_documents({"email": email}) == 0


async def test_whatsapp_webhook_rejects_unsigned_posts(client: httpx.AsyncClient, container: Container) -> None:
    body = json.dumps({"entry": []}).encode()
    original = container.settings.whatsapp_meta_app_secret
    try:
        container.settings.whatsapp_meta_app_secret = None
        r = await client.post(f"{API}/whatsapp/webhook", content=body, headers={"content-type": "application/json"})
        assert r.status_code == 403
        container.settings.whatsapp_meta_app_secret = "test-secret"
        r = await client.post(
            f"{API}/whatsapp/webhook",
            content=body,
            headers={"content-type": "application/json", "x-hub-signature-256": "sha256=bad"},
        )
        assert r.status_code == 403
        sig = "sha256=" + hmac.new(b"test-secret", body, hashlib.sha256).hexdigest()
        r = await client.post(
            f"{API}/whatsapp/webhook",
            content=body,
            headers={"content-type": "application/json", "x-hub-signature-256": sig},
        )
        assert r.status_code == 200
    finally:
        container.settings.whatsapp_meta_app_secret = original
