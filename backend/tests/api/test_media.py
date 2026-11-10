"""Media: uploads are re-encoded (resized, metadata stripped); image fields only accept GoFindr uploads."""

import io
from pathlib import Path

import httpx
from PIL import Image
from PIL.TiffImagePlugin import IFDRational

from app.core.container import Container
from tests.api.test_competition import SECTOR_18, player, team
from tests.conftest import future, make_match

API = "/api/v1"


def _jpeg_with_gps(size: tuple[int, int] = (3000, 2000)) -> bytes:
    img = Image.new("RGB", size, (20, 120, 60))
    exif = Image.Exif()
    exif[0x010F] = "PhoneMaker"  # camera make
    gps = exif.get_ifd(0x8825)  # GPS IFD
    gps.update(
        {
            1: "N",
            2: (IFDRational(28), IFDRational(36), IFDRational(0)),
            3: "E",
            4: (IFDRational(77), IFDRational(25), IFDRational(0)),
        }
    )
    buf = io.BytesIO()
    img.save(buf, "JPEG", exif=exif)
    return buf.getvalue()


async def _upload(client: httpx.AsyncClient, h: dict[str, str], data: bytes, purpose: str) -> str:
    r = await client.post(
        f"{API}/uploads/images", headers=h, files={"file": ("p.jpg", data, "image/jpeg")}, data={"purpose": purpose}
    )
    assert r.status_code == 201, r.text
    return str(r.json()["data"]["url"])


async def test_upload_strips_metadata_resizes_and_is_relative(client: httpx.AsyncClient, container: Container) -> None:
    u = await player(client, "Media ME", "batsman", SECTOR_18)
    url = await _upload(client, u.h, _jpeg_with_gps(), "team_cover")
    assert url.startswith("/uploads/team_cover/") and url.endswith(".jpg")
    rel = url.removeprefix("/uploads/")
    candidates = (Path("/tmp/cricket-test-uploads") / rel, Path(container.settings.local_upload_dir) / rel)
    stored = next(p for p in candidates if p.exists())
    with Image.open(stored) as im:
        assert max(im.size) <= 1800
        ex = im.getexif()
        assert not ex.get_ifd(0x8825) and not ex.get(0x010F)  # GPS + camera tags gone
    poly = b"\xff\xd8\xff" + b"<html><script>alert(1)</script></html>"
    bad = await client.post(f"{API}/uploads/images", headers=u.h, files={"file": ("x.jpg", poly, "image/jpeg")})
    assert bad.status_code == 422


async def test_media_fields_accept_only_playr_uploads_and_owners(client: httpx.AsyncClient) -> None:
    cap = await player(client, "Captain MEF", "all_rounder", SECTOR_18)
    other = await player(client, "Other MEF", "bowler", SECTOR_18)
    tid = await team(client, cap, "Team MEF", SECTOR_18, [])
    mid = (await make_match(client, cap, tid, start=future(5, 7), at=SECTOR_18, capacity=11))["id"]
    img = await _upload(client, cap.h, _jpeg_with_gps((800, 600)), "team_cover")

    assert (
        await client.put(f"{API}/users/me", headers=cap.h, json={"profile_image": "https://evil.example/pixel.gif"})
    ).status_code == 422
    assert (await client.put(f"{API}/users/me", headers=cap.h, json={"profile_image": img})).status_code == 200

    assert (
        await client.put(f"{API}/teams/{tid}", headers=cap.h, json={"cover_image": "https://evil.example/c.jpg"})
    ).status_code == 422
    r = await client.put(f"{API}/teams/{tid}", headers=cap.h, json={"cover_image": img, "logo": img})
    assert r.status_code == 200 and r.json()["data"]["cover_image"] == img
    assert (await client.put(f"{API}/teams/{tid}", headers=other.h, json={"cover_image": img})).status_code == 403
    dash = (await client.get(f"{API}/teams/{tid}/dashboard", headers=other.h)).json()["data"]
    assert dash["team"]["cover_image"] == img and dash["team"]["logo"] == img

    r = await client.put(f"{API}/matches/{mid}", headers=cap.h, json={"cover_image": img})
    assert r.status_code == 200 and r.json()["data"]["cover_image"] == img
    assert (await client.put(f"{API}/matches/{mid}", headers=other.h, json={"cover_image": img})).status_code in (
        403,
        404,
    )
    assert (await client.put(f"{API}/matches/{mid}", headers=cap.h, json={"cover_image": None})).json()["data"][
        "cover_image"
    ] is None


async def test_media_policy_cleanup_removes_external_and_keeps_uploads(
    client: httpx.AsyncClient, container: Container
) -> None:
    """Legacy records (written before the policy) are cleaned through the policy check, not by hand."""
    from bson import ObjectId

    from app.modules.uploads.media_policy import enforce_media_policy

    cap = await player(client, "Captain MPC", "all_rounder", SECTOR_18)
    keep = await player(client, "Keeper MPC", "batsman", SECTOR_18)
    tid = await team(client, cap, "Team MPC", SECTOR_18, [])
    img = await _upload(client, keep.h, _jpeg_with_gps((400, 400)), "profile")
    assert (await client.put(f"{API}/users/me", headers=keep.h, json={"profile_image": img})).status_code == 200
    db = container.mongo
    # Simulate pre-policy seed data (the API now refuses these values).
    dice = "https://api.dicebear.com/9.x/initials/svg?seed=Captain"
    await db["users"].update_one({"_id": ObjectId(cap.id)}, {"$set": {"profile_image": dice}})
    await db["teams"].update_one(
        {"_id": ObjectId(tid)}, {"$set": {"logo": "https://api.dicebear.com/9.x/shapes/svg?seed=T", "cover_image": img}}
    )

    dry = await enforce_media_policy(db, container.settings, apply=False)
    assert dry.removed.get("users.profile_image", 0) >= 1 and dry.removed.get("teams.logo", 0) >= 1
    assert (await db["users"].find_one({"_id": ObjectId(cap.id)}))["profile_image"] == dice  # dry run changes nothing

    await enforce_media_policy(db, container.settings, apply=True)
    u = await db["users"].find_one({"_id": ObjectId(cap.id)})
    t = await db["teams"].find_one({"_id": ObjectId(tid)})
    assert u is not None and "profile_image" not in u
    assert t is not None and "logo" not in t and t["cover_image"] == img  # valid upload kept
    assert (await db["users"].find_one({"_id": ObjectId(keep.id)}))["profile_image"] == img
    log = await db["audit_logs"].find_one({"action": "media.policy_cleanup", "entity_id": ObjectId(cap.id)})
    assert log is not None and log["previous_value"] == {"profile_image": dice}
    # API falls back cleanly and a second run is a no-op for these records.
    me = (await client.get(f"{API}/users/me", headers=cap.h)).json()["data"]
    assert me["profile_image"] is None
    again = await enforce_media_policy(db, container.settings, apply=True)
    assert again.total_removed == 0
