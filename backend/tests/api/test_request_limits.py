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
