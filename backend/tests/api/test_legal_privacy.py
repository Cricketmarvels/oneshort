"""Terms v2 + Privacy Notice (DPDP Act 2023): public documents, informed acceptance with age confirmation, privacy
requests with deadlines, and erasure on account deletion."""

import httpx
from bson import ObjectId

from app.core.config import Settings
from app.core.container import Container
from tests.api.test_competition import SECTOR_18, player
from tests.conftest import register

API = "/api/v1"


async def test_public_terms_and_privacy_need_no_login(client: httpx.AsyncClient) -> None:
    t = (await client.get(f"{API}/legal/terms")).json()["data"]
    p = (await client.get(f"{API}/legal/privacy")).json()["data"]
    assert t["title"] == "PlayR Terms of Use" and t["version"] == 2
    assert p["title"] == "PlayR Privacy Notice" and p["version"] == 1
    text = " ".join(s["body"] for s in t["sections"] + p["sections"])
    assert "CricketMarvels" not in text and "Draft" not in t["title"]
    for must in ("18 or older", "Grievance Officer", "Data Protection Board", "nominate", "48 hours", "one year"):
        assert must in text, must


async def test_acceptance_requires_age_and_privacy_and_records_fingerprints(
    client: httpx.AsyncClient, container: Container
) -> None:
    u = await register(client, "Legal Accept", agree=False)
    cur = (await client.get(f"{API}/agreements/current", headers=u.h)).json()["data"]
    assert cur["version"] == 2 and cur["privacy_version"] == 1 and cur["effective_date"]
    base = {"version": 2, "accepted": True}
    r = await client.post(f"{API}/agreements/acceptance", headers=u.h, json={**base, "privacy_acknowledged": True})
    assert r.status_code == 422 and r.json()["error"]["code"] == "AGE_NOT_CONFIRMED"
    r = await client.post(f"{API}/agreements/acceptance", headers=u.h, json={**base, "age_confirmed": True})
    assert r.status_code == 422 and r.json()["error"]["code"] == "PRIVACY_NOT_ACKNOWLEDGED"
    r = await client.post(
        f"{API}/agreements/acceptance", headers=u.h, json={**base, "age_confirmed": True, "privacy_acknowledged": True}
    )
    assert r.status_code == 200 and r.json()["data"]["satisfied"] is True
    rec = await container.mongo["user_agreements"].find_one({"user_id": ObjectId(u.id), "agreement_version": 2})
    assert rec and rec["age_confirmed"] and rec["privacy_version"] == 1
    assert len(rec["terms_sha256"]) == 64 and len(rec["privacy_sha256"]) == 64


async def test_company_details_render_and_production_requires_them() -> None:
    from app.modules.agreements.legal import privacy

    s = Settings(legal_entity_name="PlayR Sports Pvt Ltd", grievance_email="privacy@playr.app")
    body = " ".join(x["body"] for x in privacy(s)["sections"])
    assert "PlayR Sports Pvt Ltd" in body and "privacy@playr.app" in body
    try:
        Settings(app_env="production", jwt_secret="x" * 40, otp_provider="msg91", whatsapp_provider="meta", debug=False)
    except ValueError as e:
        assert "LEGAL_ENTITY_NAME" in str(e) and "GRIEVANCE_EMAIL" in str(e)
    else:
        raise AssertionError("production must require legal details")


async def test_privacy_requests_have_deadlines_and_admin_workflow(
    client: httpx.AsyncClient, container: Container
) -> None:
    u = await player(client, "Legal Requester", "batsman", SECTOR_18)
    r = await client.post(
        f"{API}/privacy/requests", headers=u.h, json={"type": "nomination", "details": "Please record my nominee."}
    )
    assert r.status_code == 422  # nominee details required
    r = await client.post(
        f"{API}/privacy/requests",
        headers=u.h,
        json={
            "type": "nomination",
            "details": "Please record my nominee.",
            "nominee_name": "A. Sharma",
            "nominee_contact": "a@example.in",
        },
    )
    assert r.status_code == 201
    req = r.json()["data"]
    assert req["reference"].startswith("PR-") and req["status"] == "open"
    from datetime import datetime

    days = (datetime.fromisoformat(req["legal_deadline"]) - datetime.fromisoformat(req["created_at"])).days
    assert days == 90
    mine = (await client.get(f"{API}/privacy/requests/me", headers=u.h)).json()["data"]
    assert [m["reference"] for m in mine] == [req["reference"]]
    # Only admins see the queue
    assert (await client.get(f"{API}/admin/privacy-requests", headers=u.h)).status_code == 403
    await container.mongo["users"].update_one({"_id": ObjectId(u.id)}, {"$addToSet": {"roles": "admin"}})
    q = (await client.get(f"{API}/admin/privacy-requests", headers=u.h)).json()["data"]
    assert any(x["reference"] == req["reference"] and x["nominee"]["name"] == "A. Sharma" for x in q)
    r = await client.post(
        f"{API}/admin/privacy-requests/{req['id']}/resolve",
        headers=u.h,
        json={"status": "resolved", "resolution": "Nominee recorded."},
    )
    assert r.status_code == 200 and r.json()["data"]["status"] == "resolved"
    assert await container.mongo["audit_logs"].count_documents({"entity_id": ObjectId(req["id"])}) == 2


async def test_account_deletion_erases_user_content(client: httpx.AsyncClient, container: Container) -> None:
    u = await player(client, "Legal Eraser", "bowler", SECTOR_18)
    uid = ObjectId(u.id)
    db = container.mongo
    await db["chat_messages"].insert_one({"sender_id": uid, "body": "my number is 98xxxx", "invitation_id": ObjectId()})
    await db["community_posts"].insert_one(
        {"author_id": uid, "body": "hello from me", "community_id": ObjectId(), "removed": False}
    )
    await db["notifications"].insert_one({"user_id": uid, "title": "t", "body": "b"})
    r = await client.request("DELETE", f"{API}/users/me", headers=u.h, json={"confirm": "DELETE"})
    assert r.status_code == 204
    assert (await db["chat_messages"].find_one({"sender_id": uid}))["body"] == "[message deleted]"
    post = await db["community_posts"].find_one({"author_id": uid})
    assert post["body"] == "" and post["removed"] is True
    assert await db["notifications"].count_documents({"user_id": uid}) == 0
    user = await db["users"].find_one({"_id": uid})
    assert user["mobile_number"] is None and user["email"] is None and user["full_name"] == "Deleted player"
