"""WhatsApp Cloud API webhook: Meta's delivery reports (sent/delivered/read/failed + error codes) and inbound messages.

GET  verifies the subscription (hub.verify_token must equal WHATSAPP_WEBHOOK_VERIFY_TOKEN).
POST stores a minimal record per event in `whatsapp_events` — status, error code/title, the last 4 digits of the
     number only, timestamps — never message text or full numbers. When WHATSAPP_META_APP_SECRET is set, the
     X-Hub-Signature-256 header is verified and unsigned posts are rejected.
"""

import hashlib
import hmac
import json
import re
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Header, Query, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from app.api.dependencies import ContainerDep, UserDep
from app.common.response import Envelope, ok
from app.common.types import utcnow
from app.core.exceptions import Forbidden, NotFound
from app.core.logging import get_logger

router = APIRouter(prefix="/whatsapp", tags=["WhatsApp webhook"])
log = get_logger("whatsapp.webhook")


@router.get("/webhook", response_class=PlainTextResponse, include_in_schema=False)
async def verify(
    c: ContainerDep,
    mode: str = Query("", alias="hub.mode"),
    token: str = Query("", alias="hub.verify_token"),
    challenge: str = Query("", alias="hub.challenge"),
) -> str:
    expected = c.settings.whatsapp_webhook_verify_token
    if mode == "subscribe" and expected and hmac.compare_digest(token, expected):
        return challenge
    raise Forbidden("Webhook verification failed")


def _events(payload: dict[str, Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            v = change.get("value", {})
            for st in v.get("statuses", []):
                err = (st.get("errors") or [{}])[0]
                out.append(
                    {
                        "kind": "status",
                        "status": st.get("status"),
                        "message_id": st.get("id"),
                        "number_last4": str(st.get("recipient_id", ""))[-4:],
                        "error_code": err.get("code"),
                        "error_title": err.get("title"),
                        "error_details": (err.get("error_data") or {}).get("details"),
                    }
                )
            for m in v.get("messages", []):
                out.append(
                    {
                        "kind": "inbound",
                        "status": "received",
                        "number_last4": str(m.get("from", ""))[-4:],
                        "message_type": m.get("type"),
                    }
                )
    return out


@router.post("/webhook", include_in_schema=False)
async def receive(request: Request, c: ContainerDep) -> dict[str, bool]:
    raw = await request.body()
    secret = c.settings.whatsapp_meta_app_secret
    if secret:
        sig = request.headers.get("x-hub-signature-256", "")
        good = "sha256=" + hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, good):
            raise Forbidden("Bad signature")
    try:
        events = _events(json.loads(raw or b"{}"))
    except (ValueError, AttributeError):
        events = []
    now = utcnow()
    if events:
        await c.mongo["whatsapp_events"].insert_many([{**e, "received_at": now} for e in events])
    for e in events:
        log.info("whatsapp.event", kind=e["kind"], status=e["status"], error_code=e.get("error_code"))
    return {"ok": True}


# ---------------------------------------------------------------- simulator inbox (test mode only)
class SimMessage(BaseModel):
    id: str
    to_last4: str
    kind: str
    body: str
    code: str | None = Field(description="One-time code, for the copy-code button (OTP messages only)")
    created_at: datetime


def _sim_enabled(c: ContainerDep) -> None:
    if c.settings.whatsapp_provider != "simulator":
        raise NotFound("WhatsApp simulator is off")


async def _inbox(c: ContainerDep, number: str) -> list[SimMessage]:
    rows = [r async for r in c.mongo["whatsapp_outbox"].find({"to": number}).sort("created_at", -1).limit(50)]
    return [
        SimMessage(
            id=str(r["_id"]),
            to_last4=number[-4:],
            kind=r["kind"],
            body=r["body"],
            code=(r.get("params") or [None])[0] if r["kind"] == "otp" else None,
            created_at=r["created_at"],
        )
        for r in rows
    ]


@router.get(
    "/simulator/me", response_model=Envelope[list[SimMessage]], summary="Simulated WhatsApp inbox for my number"
)
async def sim_me(user: UserDep, c: ContainerDep) -> Envelope[list[SimMessage]]:
    _sim_enabled(c)
    number = user.doc.get("mobile_number")
    return ok(await _inbox(c, number) if number else [])


@router.get(
    "/simulator/inbox",
    response_model=Envelope[list[SimMessage]],
    summary="Simulated inbox for a number (needs simulator key)",
)
async def sim_inbox(
    c: ContainerDep,
    phone: Annotated[str, Query(min_length=8, max_length=20)],
    x_simulator_key: Annotated[str, Header()] = "",
) -> Envelope[list[SimMessage]]:
    _sim_enabled(c)
    key = c.settings.whatsapp_simulator_key
    if not key or not hmac.compare_digest(x_simulator_key, key):
        raise Forbidden("Simulator key required")
    digits = re.sub(r"[^0-9]", "", phone)
    number = "+" + (digits if len(digits) > 10 else "91" + digits)
    return ok(await _inbox(c, number))
