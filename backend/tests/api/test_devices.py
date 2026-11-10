"""Push device tokens: registered per user, forgotten on logout, never removable by another user."""

import httpx

from app.core.container import Container
from tests.conftest import register

API = "/api/v1"
TOK = "ExponentPushToken[devicetesttoken0001]"


async def test_device_token_lifecycle(client: httpx.AsyncClient, container: Container) -> None:
    owner = await register(client, "Device Owner")
    other = await register(client, "Device Other")
    assert (
        await client.post(f"{API}/users/me/devices", headers=owner.h, json={"platform": "ios", "push_token": TOK})
    ).status_code == 204
    assert await container.mongo["devices"].count_documents({"push_token": TOK}) == 1
    # someone else can't forget my device
    assert (await client.delete(f"{API}/users/me/devices/{TOK}", headers=other.h)).status_code == 204
    assert await container.mongo["devices"].count_documents({"push_token": TOK}) == 1
    # I can (the app does this on logout)
    assert (await client.delete(f"{API}/users/me/devices/{TOK}", headers=owner.h)).status_code == 204
    assert await container.mongo["devices"].count_documents({"push_token": TOK}) == 0
    assert (await client.delete(f"{API}/users/me/devices/{TOK}")).status_code == 401
