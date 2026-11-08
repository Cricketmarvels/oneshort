"""Notification fan-out: in-app (persisted), real-time (WebSocket), push (FCM adapter) and WhatsApp (opt-in).

Delivery failures of secondary channels never fail the business operation.
"""

import asyncio
from typing import Any

from bson import ObjectId

from app.common.enums import NotificationType
from app.common.response import PageParams
from app.common.types import utcnow
from app.core.exceptions import NotFound
from app.core.logging import get_logger
from app.infrastructure.database.mongo import Mongo
from app.infrastructure.integrations.push import PushProvider, stringify
from app.infrastructure.integrations.whatsapp import DisabledWhatsApp, WhatsAppSender
from app.infrastructure.realtime.hub import RealtimeHub

log = get_logger("notifications")


#: Types worth a WhatsApp message (player_invitation is excluded: invitations send their own detailed message).
WHATSAPP_TYPES = {
    NotificationType.TEAM_INVITATION,
    NotificationType.INVITATION_ACCEPTED,
    NotificationType.INVITATION_REJECTED,
    NotificationType.INVITATION_CANCELLED,
    NotificationType.MATCH_CANCELLED,
    NotificationType.MATCH_RESCHEDULED,
    NotificationType.TEAM_CHALLENGE,
    NotificationType.CHALLENGE_ACCEPTED,
    NotificationType.CHALLENGE_COUNTER,
    NotificationType.CHALLENGE_CONFIRMED,
    NotificationType.CHALLENGE_REJECTED,
    NotificationType.RESULT_SUBMITTED,
    NotificationType.RESULT_CONFIRMED,
    NotificationType.RESULT_DISPUTED,
    NotificationType.PAYMENT_REMINDER,
    NotificationType.CHAT_MESSAGE,
}


class NotificationService:
    def __init__(
        self, mongo: Mongo, hub: RealtimeHub, push: PushProvider, whatsapp: WhatsAppSender | None = None, link: str = ""
    ) -> None:
        self.mongo = mongo
        self.col = mongo["notifications"]
        self.hub = hub
        self.push = push
        self.whatsapp = whatsapp or DisabledWhatsApp()
        self.link = link.rstrip("/")

    async def notify(
        self,
        user_ids: list[ObjectId],
        ntype: NotificationType,
        title: str,
        body: str,
        data: dict[str, Any] | None = None,
    ) -> None:
        if not user_ids:
            return
        data = {k: (str(v) if isinstance(v, ObjectId) else v) for k, v in (data or {}).items()}
        users = {
            u["_id"]: u
            async for u in self.mongo["users"].find(
                {"_id": {"$in": list(set(user_ids))}, "account_status": {"$ne": "deleted"}},
                {"notification_prefs": 1, "mobile_number": 1},
            )
        }
        now = utcnow()
        docs = []
        push_targets: list[ObjectId] = []
        wa_targets: list[str] = []
        for uid in users:
            prefs = users[uid].get("notification_prefs") or {}
            if ntype.value in (prefs.get("muted_types") or []):
                continue
            docs.append(
                {
                    "user_id": uid,
                    "type": ntype.value,
                    "title": title,
                    "body": body,
                    "data": data,
                    "read_at": None,
                    "created_at": now,
                }
            )
            if prefs.get("push", True):
                push_targets.append(uid)
            if prefs.get("whatsapp") and users[uid].get("mobile_number") and ntype in WHATSAPP_TYPES:
                wa_targets.append(users[uid]["mobile_number"])
        if not docs:
            return
        await self.col.insert_many(docs)
        try:
            await self.hub.publish(
                [str(d["user_id"]) for d in docs],
                "notification.created",
                {"type": ntype.value, "title": title, "body": body, "data": data},
            )
            if self.push.configured and push_targets:
                tokens = [d["push_token"] async for d in self.mongo["devices"].find({"user_id": {"$in": push_targets}})]
                await self.push.send(tokens, title, body, stringify(data))
        except Exception as exc:  # noqa: BLE001 - secondary channels must not break the flow
            log.warning("notification.secondary_channel_failed", error=type(exc).__name__)
        if wa_targets and self.whatsapp.configured:
            await self._whatsapp(wa_targets, title, body)

    async def _whatsapp(self, numbers: list[str], title: str, body: str) -> None:
        """Opt-in WhatsApp copy. Logs only counts — never numbers or message text."""
        text = f"PlayR · {title}\n{body}" + (f"\nOpen PlayR: {self.link}" if self.link else "")
        try:
            results = await asyncio.wait_for(
                asyncio.gather(
                    *(self.whatsapp.send(n, text, [title, body, self.link or "PlayR app"], "notify") for n in numbers)
                ),
                timeout=15,
            )
            log.info("notification.whatsapp", sent=sum(r == "sent" for r in results), total=len(results))
        except Exception as exc:  # noqa: BLE001
            log.warning("notification.whatsapp_failed", error=type(exc).__name__)

    async def emit(self, user_ids: list[ObjectId], event: str, payload: dict[str, Any]) -> None:
        """Real-time state-change event without a persisted notification."""
        try:
            await self.hub.publish([str(u) for u in user_ids], event, payload)
        except Exception as exc:  # noqa: BLE001
            log.warning("realtime.publish_failed", error=type(exc).__name__)

    async def list_for_user(
        self, user_id: ObjectId, params: PageParams, unread_only: bool
    ) -> tuple[list[dict[str, Any]], int, int]:
        q: dict[str, Any] = {"user_id": user_id}
        if unread_only:
            q["read_at"] = None
        total = await self.col.count_documents(q)
        unread = await self.col.count_documents({"user_id": user_id, "read_at": None})
        cursor = self.col.find(q).sort("created_at", -1).skip(params.skip).limit(params.page_size)
        return [d async for d in cursor], total, unread

    async def mark_read(self, user_id: ObjectId, notification_id: ObjectId) -> None:
        res = await self.col.update_one({"_id": notification_id, "user_id": user_id}, {"$set": {"read_at": utcnow()}})
        if res.matched_count == 0:
            raise NotFound("Notification not found")

    async def mark_all_read(self, user_id: ObjectId) -> int:
        res = await self.col.update_many({"user_id": user_id, "read_at": None}, {"$set": {"read_at": utcnow()}})
        return res.modified_count
