"""Lightweight in-process scheduler (single instance).

Jobs: expire overdue invitations, send 24h match reminders, purge old availability.
For multi-instance deployments, run with SCHEDULER_ENABLED=true on exactly one instance
or move these jobs to a worker / cron.
"""

import asyncio
from datetime import timedelta

from app.common.enums import MatchStatus, NotificationType
from app.common.types import utcnow
from app.core.container import Container
from app.core.logging import get_logger

log = get_logger("scheduler")


async def send_reminders(c: Container) -> int:
    now = utcnow()
    sent = 0
    async for m in (
        c.mongo["matches"]
        .find(
            {
                "match_status": {"$in": [MatchStatus.SQUAD_CONFIRMED, MatchStatus.SCHEDULED, MatchStatus.RECRUITING]},
                "start_at": {"$gt": now, "$lte": now + timedelta(hours=24)},
                "reminder_sent_at": None,
            }
        )
        .limit(200)
    ):
        claimed = await c.mongo["matches"].update_one(
            {"_id": m["_id"], "reminder_sent_at": None}, {"$set": {"reminder_sent_at": now}}
        )
        if not claimed.modified_count:
            continue
        players = [
            r["player_id"] async for r in c.mongo["match_rosters"].find({"match_id": m["_id"], "is_active": True})
        ]
        await c.notifications.notify(
            players,
            NotificationType.MATCH_REMINDER,
            f"Tomorrow: {m.get('title', 'Match')}",
            f"{(m.get('venue') or {}).get('name', 'Venue')} · check match details for timing.",
            {"match_id": m["_id"]},
        )
        sent += 1
    return sent


async def purge_old_availability(c: Container) -> int:
    res = await c.mongo["availability"].delete_many({"end_at": {"$lt": utcnow() - timedelta(days=180)}})
    return res.deleted_count


async def run_once(c: Container) -> None:
    from app.modules.invitations.service import InvitationService
    from app.modules.notifications.service import check_push_receipts

    expired = await InvitationService(c).expire_due()
    reminded = await send_reminders(c)
    purged = await purge_old_availability(c)
    receipts = await check_push_receipts(c)
    if expired or reminded or purged or receipts:
        log.info("scheduler.tick", expired=expired, reminders=reminded, purged=purged, push_receipts=receipts)


async def run_scheduler(c: Container) -> None:
    while True:
        try:
            await run_once(c)
        except Exception as exc:  # noqa: BLE001 - keep the loop alive
            log.warning("scheduler.error", error=type(exc).__name__)
        await asyncio.sleep(c.settings.scheduler_interval_seconds)
