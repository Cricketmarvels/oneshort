"""Captain ↔ player chat for a match invitation, opened once the player accepts.

Only the invitation's player and captain can read or write. The WhatsApp option is a deep link
(wa.me) to the OTHER person's number, offered only when that person has opted in to WhatsApp
(notification_prefs.whatsapp) — OneShort never shows a number to someone who hasn't been allowed it.
"""

import re
from datetime import datetime
from typing import Any
from urllib.parse import quote
from zoneinfo import ZoneInfo

from bson import ObjectId
from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.api.dependencies import ContainerDep, CurrentUser, UserDep
from app.common.enums import NotificationType
from app.common.response import ERROR_RESPONSES, Envelope, ok
from app.common.types import StrictModel, ensure_utc, parse_object_id, utcnow
from app.core.exceptions import BusinessRuleViolation, NotFound

router = APIRouter(prefix="/invitations", tags=["Chat"], responses=ERROR_RESPONSES)
OPEN = {"accepted", "confirmed"}


class ChatPerson(BaseModel):
    id: str
    full_name: str
    profile_image: str | None


class ChatMessageOut(BaseModel):
    id: str
    body: str
    mine: bool
    sender_name: str
    created_at: datetime


class ChatThreadOut(BaseModel):
    invitation_id: str
    match_id: str
    match_title: str
    match_start_at: datetime
    other: ChatPerson
    can_send: bool
    whatsapp_url: str | None = Field(description="wa.me link to the other person, only if they opted in to WhatsApp")
    messages: list[ChatMessageOut]


class ChatMessageIn(StrictModel):
    body: str = Field(min_length=1, max_length=1000)


async def _load(
    c: ContainerDep, user: CurrentUser, invitation_id: str
) -> tuple[dict[str, Any], dict[str, Any], ObjectId]:
    inv = await c.mongo["invitations"].find_one(
        {"_id": parse_object_id(invitation_id, field="invitation", not_found=True)}
    )
    if not inv or user.id not in (inv["player_id"], inv["captain_id"]):
        raise NotFound("Chat not found")
    match = await c.mongo["matches"].find_one({"_id": inv["match_id"]}, {"title": 1, "start_at": 1}) or {}
    other = inv["captain_id"] if user.id == inv["player_id"] else inv["player_id"]
    return inv, match, other


def _wa_text(to_name: str, from_name: str, match: dict[str, Any], base_url: str) -> str:
    """Opening WhatsApp message with the full match details, so the chat makes sense on its own."""
    tz = ZoneInfo(match.get("timezone") or "Asia/Kolkata")
    lines = [f"Hi {to_name.split()[0]}, it's {from_name} from OneShort about this match:", match.get("title", "Match")]
    if match.get("start_at") and match.get("end_at"):
        start, end = ensure_utc(match["start_at"]).astimezone(tz), ensure_utc(match["end_at"]).astimezone(tz)
        lines.append(f"{start.strftime('%a %d %b, %I:%M %p')} to {end.strftime('%I:%M %p')}".replace(" 0", " "))
    venue = match.get("venue") or {}
    where = ", ".join(x for x in (venue.get("name"), venue.get("area"), venue.get("city")) if x)
    lines.append(where or "Venue to be confirmed")
    if match.get("format"):
        lines.append("Practice" if match["format"] == "OTHER" else str(match["format"]))
    fee = match.get("per_head_fee_paise", 0)
    if fee:
        lines.append(f"About Rs {fee // 100} per head")
    if match.get("_id"):
        lines.append(f"{base_url.rstrip('/')}/match/{match['_id']}")
    return "\n".join(lines)


def _wa_link(mobile: str, text: str) -> str:
    return f"https://wa.me/{re.sub(r'[^0-9]', '', mobile)}?text={quote(text)}"


@router.get("/{invitation_id}/chat", response_model=Envelope[ChatThreadOut], summary="Chat for an accepted invitation")
async def thread(invitation_id: str, user: UserDep, c: ContainerDep) -> Envelope[ChatThreadOut]:
    inv, match, other_id = await _load(c, user, invitation_id)
    other = await c.mongo["users"].find_one(
        {"_id": other_id}, {"full_name": 1, "profile_image": 1, "mobile_number": 1, "notification_prefs": 1}
    ) or {"_id": other_id, "full_name": "OneShort player"}
    is_open = inv["invitation_status"] in OPEN
    wa = None
    if is_open and (other.get("notification_prefs") or {}).get("whatsapp") and other.get("mobile_number"):
        wa = _wa_link(
            other["mobile_number"],
            _wa_text(other["full_name"], user.full_name, match, c.settings.app_base_url or c.settings.web_base_url),
        )
    rows = [
        m async for m in c.mongo["chat_messages"].find({"invitation_id": inv["_id"]}).sort("created_at", 1).limit(500)
    ]
    names = {inv["player_id"]: None, inv["captain_id"]: None}
    async for u in c.mongo["users"].find({"_id": {"$in": list(names)}}, {"full_name": 1}):
        names[u["_id"]] = u["full_name"]
    return ok(
        ChatThreadOut(
            invitation_id=str(inv["_id"]),
            match_id=str(inv["match_id"]),
            match_title=match.get("title", "Match"),
            match_start_at=match.get("start_at", inv["invited_at"]),
            other=ChatPerson(id=str(other_id), full_name=other["full_name"], profile_image=other.get("profile_image")),
            can_send=is_open,
            whatsapp_url=wa,
            messages=[
                ChatMessageOut(
                    id=str(m["_id"]),
                    body=m["body"],
                    mine=m["sender_id"] == user.id,
                    sender_name=names.get(m["sender_id"]) or "Player",
                    created_at=m["created_at"],
                )
                for m in rows
            ],
        )
    )


@router.post(
    "/{invitation_id}/chat", status_code=201, response_model=Envelope[ChatMessageOut], summary="Send a chat message"
)
async def send(invitation_id: str, data: ChatMessageIn, user: UserDep, c: ContainerDep) -> Envelope[ChatMessageOut]:
    inv, match, other_id = await _load(c, user, invitation_id)
    if inv["invitation_status"] not in OPEN:
        raise BusinessRuleViolation("Chat opens once the player accepts the invitation", code="CHAT_CLOSED")
    body = data.body.strip()
    if not body:
        raise BusinessRuleViolation("Write a message first", code="EMPTY_MESSAGE")
    doc = {
        "invitation_id": inv["_id"],
        "match_id": inv["match_id"],
        "sender_id": user.id,
        "body": body,
        "created_at": utcnow(),
    }
    doc["_id"] = (await c.mongo["chat_messages"].insert_one(doc)).inserted_id
    await c.notifications.notify(
        [other_id],
        NotificationType.CHAT_MESSAGE,
        f"New message from {user.full_name}",
        f"{match.get('title', 'Match')}: {body[:120]}",
        {"invitation_id": inv["_id"], "match_id": inv["match_id"]},
    )
    await c.notifications.emit([other_id, user.id], "chat.message", {"invitation_id": str(inv["_id"])})
    return ok(
        ChatMessageOut(
            id=str(doc["_id"]), body=body, mine=True, sender_name=user.full_name, created_at=doc["created_at"]
        )
    )
