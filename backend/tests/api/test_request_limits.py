"""Request-size and list-size limits."""

from collections.abc import AsyncIterator

import httpx

from tests.api.test_competition import SECTOR_18, player

API = "/api/v1"


async def test_oversized_json_body_rejected_before_parsing(client: httpx.AsyncClient) -> None:
    u = await player(client, "Limits JSON", "batsman", SECTOR_18)
    big = b'{"full_name": "' + b"x" * (600 * 1024) + b'"}'
    r = await client.put(f"{API}/users/me", headers={**u.h, "content-type": "application/json"}, content=big)
    assert r.status_code == 413 and r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


async def test_chunked_body_without_length_is_counted(client: httpx.AsyncClient) -> None:
    u = await player(client, "Limits Chunked", "batsman", SECTOR_18)

    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(80):
            yield b"x" * 8192

    r = await client.put(f"{API}/users/me", headers={**u.h, "content-type": "application/json"}, content=chunks())
    assert r.status_code == 413


async def test_oversized_upload_rejected(client: httpx.AsyncClient) -> None:
    u = await player(client, "Limits Upload", "batsman", SECTOR_18)
    blob = b"\xff\xd8\xff" + b"0" * (6 * 1024 * 1024)
    r = await client.post(
        f"{API}/uploads/images",
        headers=u.h,
        files={"file": ("big.jpg", blob, "image/jpeg")},
        data={"purpose": "profile"},
    )
    assert r.status_code == 413


async def test_normal_requests_and_list_caps(client: httpx.AsyncClient) -> None:
    u = await player(client, "Limits Normal", "batsman", SECTOR_18)
    assert (
        await client.put(f"{API}/users/me", headers=u.h, json={"full_name": "Limits Normal Two"})
    ).status_code == 200
    prefs = lambda n: {"notification_prefs": {"muted_types": ["player_invitation"] * n}}  # noqa: E731
    assert (await client.put(f"{API}/users/me", headers=u.h, json=prefs(2))).status_code == 200
    assert (await client.put(f"{API}/users/me", headers=u.h, json=prefs(51))).status_code == 422
    r = await client.put(
        f"{API}/players/me", headers=u.h, json={"cricheroes_profile_url": "https://cricheroes.com/" + "a" * 400}
    )
    assert r.status_code == 422


async def test_strict_auth_limit_only_counts_credential_endpoints() -> None:
    """Page loads call /auth/options and /auth/refresh; they must not use up the login budget and sign people out."""
    from fastapi import FastAPI

    from app.core.config import Settings
    from app.core.middleware import InMemoryRateLimiter, RateLimitMiddleware

    mini = FastAPI()
    for path in ("/auth/options", "/auth/refresh", "/auth/sessions", "/auth/login"):
        mini.add_api_route(f"{API}{path}", lambda: {"ok": True}, methods=["GET", "POST"])
    s = Settings(rate_limit_auth_per_minute=3, rate_limit_default_per_minute=1000)
    mini.add_middleware(RateLimitMiddleware, settings=s, limiter=InMemoryRateLimiter())
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=mini), base_url="http://t") as c:
        for _ in range(20):
            assert (await c.get(f"{API}/auth/options")).status_code == 200
            assert (await c.post(f"{API}/auth/refresh")).status_code == 200
            assert (await c.get(f"{API}/auth/sessions")).status_code == 200
        codes = [(await c.post(f"{API}/auth/login")).status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]
