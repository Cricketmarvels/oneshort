"""Uploaded photos are private: no public folder, only signed links that expire and cannot be forged."""

import time

import httpx
from bson import ObjectId

from app.common.media_sign import media_signer
from app.core.container import Container
from app.infrastructure.integrations.storage import normalize_media_key
from tests.api.test_competition import SECTOR_18, player
from tests.api.test_media import _jpeg_with_gps, _upload

API = "/api/v1"


async def test_uploads_only_readable_through_valid_signed_links(
    client: httpx.AsyncClient, container: Container
) -> None:
    u = await player(client, "Private Media", "batsman", SECTOR_18)
    link = await _upload(client, u.h, _jpeg_with_gps((600, 600)), "profile")
    key = normalize_media_key(link, container.settings)
    assert key and key.startswith("/uploads/profile/")

    # The raw path is not served at all (there is no static mount), with or without a token.
    assert (await client.get(key)).status_code == 404
    assert (await client.get(key, headers=u.h)).status_code == 404

    # The signed link works without a session (image tags cannot send Authorization headers).
    ok = await client.get(link)
    assert ok.status_code == 200 and ok.headers["content-type"] == "image/jpeg"
    assert "private" in ok.headers["cache-control"]

    # Tampered signature, wrong file for a valid signature, and an expired link all fail identically.
    path, qs = link.split("?")
    e = int(qs.split("e=")[1].split("&")[0])
    s = qs.split("s=")[1]
    assert (await client.get(f"{path}?e={e}&s={'0' * len(s)}")).status_code == 404
    assert (await client.get(f"{path}?e={e + 1}&s={s}")).status_code == 404
    folder, name = key.removeprefix("/uploads/").split("/")
    other = f"{API}/media/{folder}/{'a' * 32}.jpg?e={e}&s={s}"
    assert (await client.get(other)).status_code == 404
    past = int(time.time()) - 10
    expired = f"{path}?e={past}&s={media_signer._sig(folder, name, past)}"  # noqa: SLF001
    assert (await client.get(expired)).status_code == 404
    assert (await client.get(f"{API}/media/../../etc/passwd?e={e}&s={s}")).status_code in (404, 422)


async def test_signed_link_round_trips_to_private_key(client: httpx.AsyncClient, container: Container) -> None:
    """Clients send back whatever the API gave them; the database still stores only the private key."""
    u = await player(client, "Round Trip", "bowler", SECTOR_18)
    link = await _upload(client, u.h, _jpeg_with_gps((500, 500)), "profile")
    r = await client.put(f"{API}/users/me", headers=u.h, json={"profile_image": link})
    assert r.status_code == 200
    doc = await container.mongo["users"].find_one({"_id": ObjectId(u.id)}, {"profile_image": 1})
    assert doc and doc["profile_image"] == normalize_media_key(link, container.settings)
    me = (await client.get(f"{API}/users/me", headers=u.h)).json()["data"]
    assert me["profile_image"].startswith(f"{API}/media/profile/") and "s=" in me["profile_image"]
