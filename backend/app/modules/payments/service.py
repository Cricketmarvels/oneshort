"""Manual payment tracking (MVP). No payment gateway.

Players pay captains directly (cash, UPI, PhonePe, GPay, Paytm, bank transfer). The app
records the status the captain confirms. Every change is authorised, timestamped,
appended to the record's history, written to the audit log (same transaction),
pushed in real time and notified to the player.

``PaymentProvider`` marks the seam for a future "App Pro" gateway integration.
"""

from typing import Any, Protocol
from urllib.parse import quote

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.dependencies import CurrentUser
from app.common.enums import NotificationType, PaymentStatus, SettlementStatus
from app.common.types import utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, Forbidden, NotFound
from app.modules.settlements.context import FeeAccess
from app.modules.settlements.schemas import (
    CaptainDashboardOut,
    DiscussionOut,
    PaymentRecordOut,
    PlayerDashboardOut,
    ShareOut,
    StatusChange,
)
from app.modules.settlements.service import SettlementService
from app.modules.teams.policy import can_manage_match
from app.modules.users.schemas import public_user

P = PaymentStatus


class PaymentProvider(Protocol):
    """Future App Pro seam (online payments). Not implemented in the MVP by design."""

    async def initiate(self, record_id: ObjectId, amount_paise: int) -> str: ...


def rupees(paise: int) -> str:
    r, p = divmod(paise, 100)
    return f"₹{r:,}" + (f".{p:02d}" if p else "")


#: Allowed manual transitions: (from, to) → who may perform it.
MANAGER_TRANSITIONS = {
    (P.PENDING, P.PAID),
    (P.DISPUTED, P.PAID),
    (P.PENDING, P.EXEMPTED),
    (P.DISPUTED, P.EXEMPTED),
}


class PaymentService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.records = c.mongo["payment_records"]
        self.access = FeeAccess(c)
        self.settlements = SettlementService(c)

    # ------------------------------------------------------------ helpers
    async def _record(self, settlement_id: ObjectId, player_id: ObjectId) -> dict[str, Any]:
        r = await self.records.find_one({"settlement_id": settlement_id, "player_id": player_id})
        if not r:
            raise NotFound("Payment record not found")
        return r

    async def _is_manager(self, record: dict[str, Any], user: CurrentUser) -> bool:
        match, team = await self.access.load(record["match_id"])
        return can_manage_match(match, team, user.id)

    async def _ensure_current(self, settlement_id: ObjectId) -> dict[str, Any]:
        st = await self.c.mongo["settlements"].find_one({"_id": settlement_id})
        if not st:
            raise NotFound("Settlement not found")
        if st["settlement_status"] != SettlementStatus.PUBLISHED:
            raise BusinessRuleViolation(
                "Payments can only be updated on the current published settlement", code="SETTLEMENT_NOT_CURRENT"
            )
        return st

    async def _change(
        self,
        user: CurrentUser,
        record: dict[str, Any],
        target: P,
        reason: str | None,
        extra: dict[str, Any] | None = None,
        action: str | None = None,
    ) -> dict[str, Any]:
        now = utcnow()
        prev = record["status"]

        async def txn(s: AsyncClientSession) -> None:
            res = await self.records.update_one(
                {"_id": record["_id"], "status": prev},
                {
                    "$set": {
                        "status": target.value,
                        "updated_by": user.id,
                        "updated_at": now,
                        **({"remarks": reason} if reason is not None else {}),
                        **(extra or {}),
                    },
                    "$push": {
                        "status_history": {"from": prev, "to": target.value, "by": user.id, "at": now, "reason": reason}
                    },
                },
                session=s,
            )
            if res.modified_count == 0:
                raise Conflict("Payment status changed concurrently, please refresh", code="CONCURRENT_UPDATE")
            await self.c.audit.log(
                actor_id=user.id,
                action=action or f"payment.{target.value}",
                entity_type="payment_record",
                entity_id=record["_id"],
                previous_value={"status": prev},
                new_value={"status": target.value, "reason": reason, **(extra or {})},
                request_id=user.request_id,
                session=s,
            )

        await self.c.mongo.transaction(txn)
        updated = await self.records.find_one({"_id": record["_id"]})
        assert updated is not None
        await self.c.notifications.emit(
            [record["player_id"], record["captain_id"]],
            "payment.updated",
            {
                "settlement_id": str(record["settlement_id"]),
                "player_id": str(record["player_id"]),
                "status": target.value,
            },
        )
        return updated

    # ------------------------------------------------------------ captain actions
    async def mark(
        self,
        user: CurrentUser,
        settlement_id: ObjectId,
        player_id: ObjectId,
        target: P,
        remarks: str | None,
        method: str | None = None,
    ) -> PaymentRecordOut:
        await self._ensure_current(settlement_id)
        rec = await self._record(settlement_id, player_id)
        if not await self._is_manager(rec, user):
            raise Forbidden("Only the captain or a team admin can update payment status", code="NOT_MATCH_MANAGER")
        if (P(rec["status"]), target) not in MANAGER_TRANSITIONS:
            raise BusinessRuleViolation(
                f"Cannot mark a '{rec['status']}' payment as '{target.value}'. Use correction with a reason.",
                code="INVALID_PAYMENT_TRANSITION",
            )
        extra: dict[str, Any] = {}
        if target == P.PAID:
            extra["method"] = method
            if rec.get("dispute"):
                extra["dispute.resolved_at"] = utcnow()
                extra["dispute.resolution"] = "marked_paid"
        updated = await self._change(user, rec, target, remarks, extra)
        match, _ = await self.access.load(rec["match_id"])
        if target == P.PAID:
            await self.c.notifications.notify(
                [player_id],
                NotificationType.PAYMENT_MARKED_PAID,
                "Payment recorded",
                f"Your captain marked {rupees(rec['amount_paise'])} as paid for {match.get('title', 'the match')}.",
                {"settlement_id": settlement_id, "match_id": rec["match_id"]},
            )
        else:
            await self.c.notifications.notify(
                [player_id],
                NotificationType.PAYMENT_STATUS_CHANGED,
                "You're exempted",
                f"No contribution needed for {match.get('title', 'the match')}.",
                {"settlement_id": settlement_id, "match_id": rec["match_id"]},
            )
        return await self._out(updated)

    async def correct(
        self, user: CurrentUser, settlement_id: ObjectId, player_id: ObjectId, target: P, reason: str
    ) -> PaymentRecordOut:
        """Fix an incorrectly recorded status. Any status → any other, but always with a reason."""
        await self._ensure_current(settlement_id)
        rec = await self._record(settlement_id, player_id)
        if not await self._is_manager(rec, user):
            raise Forbidden("Only the captain or a team admin can correct payment status", code="NOT_MATCH_MANAGER")
        if rec["status"] == target.value:
            raise BusinessRuleViolation("Status is already set", code="NO_CHANGE")
        if target == P.DISPUTED:
            raise BusinessRuleViolation("Only the player can raise a dispute", code="INVALID_PAYMENT_TRANSITION")
        updated = await self._change(user, rec, target, reason, action="payment.corrected")
        await self.c.notifications.notify(
            [player_id],
            NotificationType.PAYMENT_STATUS_CHANGED,
            "Payment status corrected",
            f"Status changed from {rec['status']} to {target.value}: {reason}",
            {"settlement_id": settlement_id, "match_id": rec["match_id"]},
        )
        return await self._out(updated)

    # ------------------------------------------------------------ player actions
    async def dispute(
        self, user: CurrentUser, settlement_id: ObjectId, player_id: ObjectId, reason: str
    ) -> PaymentRecordOut:
        if player_id != user.id:
            raise Forbidden("You can only dispute your own payment record", code="NOT_OWN_RECORD")
        await self._ensure_current(settlement_id)
        rec = await self._record(settlement_id, player_id)
        if rec["status"] not in (P.PENDING, P.PAID):
            raise BusinessRuleViolation("This payment cannot be disputed", code="INVALID_PAYMENT_TRANSITION")
        updated = await self._change(
            user,
            rec,
            P.DISPUTED,
            reason,
            {
                "dispute": {
                    "reason": reason,
                    "raised_at": utcnow(),
                    "resolved_at": None,
                    "previous_status": rec["status"],
                }
            },
        )
        match, team = await self.access.load(rec["match_id"])
        managers = list({rec["captain_id"], *((team or {}).get("admin_ids") or [])})
        await self.c.notifications.notify(
            managers,
            NotificationType.PAYMENT_DISPUTE,
            f"Payment dispute from {user.full_name}",
            f"{match.get('title', 'Match')}: {reason}",
            {"settlement_id": settlement_id, "match_id": rec["match_id"]},
        )
        return await self._out(updated)

    # ------------------------------------------------------------ dashboards
    async def captain_dashboard(self, user: CurrentUser, settlement_id: ObjectId) -> CaptainDashboardOut:
        st = await self.c.mongo["settlements"].find_one({"_id": settlement_id})
        if not st:
            raise NotFound("Settlement not found")
        match, team = await self.access.load(st["match_id"])
        manager = can_manage_match(match, team, user.id)
        q: dict[str, Any] = {"settlement_id": settlement_id}
        if not manager:
            if not await self.records.count_documents({"settlement_id": settlement_id, "player_id": user.id}, limit=1):
                raise Forbidden("Only match participants can view payments", code="FEES_PRIVATE")
        recs = [r async for r in self.records.find(q)]
        cache: dict[Any, Any] = {}
        outs = [await self._out(r, cache) for r in recs]
        collected = sum(r["amount_paise"] if r["status"] == P.PAID else r.get("credited_paise", 0) for r in recs)
        owed = sum(r["amount_paise"] for r in recs if r["status"] != P.EXEMPTED)
        return CaptainDashboardOut(
            settlement=await self.settlements.get_out(settlement_id),
            total_paise=st["total_expenses_paise"],
            eligible_players=st["eligible_players"],
            individual_contribution_paise=st["individual_contribution_paise"],
            collected_paise=collected,
            outstanding_paise=max(0, owed - collected),
            exempted_count=sum(1 for r in recs if r["status"] == P.EXEMPTED),
            disputed_count=sum(1 for r in recs if r["status"] == P.DISPUTED),
            records=outs,
        )

    async def player_dashboard(self, user: CurrentUser, status: P | None) -> PlayerDashboardOut:
        current = [
            s["_id"]
            async for s in self.c.mongo["settlements"].find(
                {"settlement_status": SettlementStatus.PUBLISHED.value, "lines.player_id": user.id}, {"_id": 1}
            )
        ]
        q: dict[str, Any] = {"player_id": user.id, "settlement_id": {"$in": current}}
        all_recs = [r async for r in self.records.find(q).sort("updated_at", -1)]
        shown = [r for r in all_recs if status is None or r["status"] == status.value]
        cache: dict[Any, Any] = {}
        return PlayerDashboardOut(
            outstanding_paise=sum(
                r["amount_paise"] - r.get("credited_paise", 0)
                for r in all_recs
                if r["status"] in (P.PENDING, P.DISPUTED)
            ),
            paid_paise=sum(r["amount_paise"] for r in all_recs if r["status"] == P.PAID),
            pending_count=sum(1 for r in all_recs if r["status"] == P.PENDING),
            disputed_count=sum(1 for r in all_recs if r["status"] == P.DISPUTED),
            exempted_count=sum(1 for r in all_recs if r["status"] == P.EXEMPTED),
            records=[await self._out(r, cache) for r in shown],
        )

    async def _out(self, r: dict[str, Any], cache: dict[Any, Any] | None = None) -> PaymentRecordOut:
        cache = cache if cache is not None else {}

        async def get(col: str, _id: ObjectId) -> dict[str, Any]:
            key = (col, _id)
            if key not in cache:
                cache[key] = await self.c.mongo[col].find_one({"_id": _id}) or {"_id": _id}
            return dict(cache[key])

        match = await get("matches", r["match_id"])
        if "title" not in match:  # team-vs-team fee side
            match = await get("fee_sides", r["match_id"])
        team = await get("teams", r["team_id"])
        player = await get("users", r["player_id"])
        captain = await get("users", r["captain_id"])
        credited = r.get("credited_paise", 0)
        balance = 0 if r["status"] in (P.PAID, P.EXEMPTED) else max(0, r["amount_paise"] - credited)
        return PaymentRecordOut(
            id=str(r["_id"]),
            settlement_id=str(r["settlement_id"]),
            match_id=str(r["match_id"]),
            match_title=match.get("title", "Match"),
            match_start_at=match.get("start_at", r["updated_at"]),
            team_id=str(r["team_id"]),
            team_name=team.get("team_name", "Team"),
            player=public_user({"full_name": "Player", **player}),
            captain=public_user({"full_name": "Captain", **captain}),
            amount_paise=r["amount_paise"],
            credited_paise=credited,
            balance_paise=balance,
            status=r["status"],
            method=r.get("method"),
            remarks=r.get("remarks"),
            dispute_reason=(r.get("dispute") or {}).get("reason") if r["status"] == P.DISPUTED else None,
            updated_by=str(r["updated_by"]) if r.get("updated_by") else None,
            updated_at=r["updated_at"],
            history=[
                StatusChange(
                    from_status=h.get("from"),
                    to_status=h["to"],
                    by=str(h["by"]) if h.get("by") else None,
                    at=h["at"],
                    reason=h.get("reason"),
                )
                for h in r.get("status_history", [])
            ],
        )

    # ------------------------------------------------------------ discussions
    async def _record_by_id(self, user: CurrentUser, record_id: ObjectId) -> dict[str, Any]:
        r = await self.records.find_one({"_id": record_id})
        if not r or (r["player_id"] != user.id and not await self._is_manager(r, user)):
            raise NotFound("Payment record not found")
        return r

    async def add_discussion(self, user: CurrentUser, record_id: ObjectId, message: str) -> DiscussionOut:
        r = await self._record_by_id(user, record_id)
        now = utcnow()
        res = await self.c.mongo["payment_discussions"].insert_one(
            {
                "payment_record_id": record_id,
                "settlement_id": r["settlement_id"],
                "author_id": user.id,
                "message": message,
                "created_at": now,
            }
        )
        other = r["captain_id"] if user.id == r["player_id"] else r["player_id"]
        await self.c.notifications.notify(
            [other],
            NotificationType.FEE_DISCUSSION,
            f"Fee message from {user.full_name}",
            message[:140],
            {"settlement_id": r["settlement_id"], "payment_record_id": record_id},
        )
        return DiscussionOut(id=str(res.inserted_id), author=public_user(user.doc), message=message, created_at=now)

    async def list_discussion(self, user: CurrentUser, record_id: ObjectId) -> list[DiscussionOut]:
        await self._record_by_id(user, record_id)
        rows = [
            d
            async for d in self.c.mongo["payment_discussions"]
            .find({"payment_record_id": record_id})
            .sort("created_at", 1)
        ]
        users = {
            u["_id"]: u
            async for u in self.c.mongo["users"].find({"_id": {"$in": list({d["author_id"] for d in rows})}})
        }
        return [
            DiscussionOut(
                id=str(d["_id"]),
                author=public_user(users.get(d["author_id"], {"_id": d["author_id"], "full_name": "Player"})),
                message=d["message"],
                created_at=d["created_at"],
            )
            for d in rows
        ]

    # ------------------------------------------------------------ sharing
    async def share_summary(self, user: CurrentUser, settlement_id: ObjectId) -> ShareOut:
        dash = await self.captain_dashboard(user, settlement_id)
        st = dash.settlement
        match, team = await self.access.load(ObjectId(st.match_id))
        lines = [
            f"🏏 {match.get('title', 'Match')} · {(team or {}).get('team_name', '')}",
            f"Total expenses: {rupees(st.total_expenses_paise)}",
        ]
        lines += [f"  • {e.label}: {rupees(e.amount_paise)}" for e in st.expenses]
        lines.append(f"Per head ({st.eligible_players} players): {rupees(st.individual_contribution_paise)}")
        if st.rounding_adjustment_paise:
            lines.append(f"Rounding surplus: {rupees(st.rounding_adjustment_paise)}")
        lines.append("")
        for rec in dash.records:
            mark = {"paid": "✅", "exempted": "➖", "disputed": "⚠️"}.get(rec.status, "⏳")
            lines.append(f"{mark} {rec.player.full_name}: {rupees(rec.amount_paise)} ({rec.status})")
        if st.payment_instructions:
            lines += ["", f"Pay to: {st.payment_instructions}"]
        text = "\n".join(lines)
        return ShareOut(text=text, whatsapp_url=f"https://wa.me/?text={quote(text)}")

    async def remind(self, user: CurrentUser, settlement_id: ObjectId, player_id: ObjectId) -> ShareOut:
        rec = await self._record(settlement_id, player_id)
        if not await self._is_manager(rec, user):
            raise Forbidden("Only the captain or a team admin can send reminders", code="NOT_MATCH_MANAGER")
        if rec["status"] != P.PENDING:
            raise BusinessRuleViolation("Only pending payments need reminders", code="NOT_PENDING")
        st = await self.c.mongo["settlements"].find_one({"_id": settlement_id}) or {}
        match, _ = await self.access.load(rec["match_id"])
        player = await self.c.mongo["users"].find_one({"_id": player_id}) or {}
        amount = rupees(rec["amount_paise"] - rec.get("credited_paise", 0))
        text = (
            f"Hi {player.get('full_name', '')}, a friendly reminder: your contribution of {amount} for "
            f"{match.get('title', 'our match')} is pending."
            + (f" Pay to: {st.get('payment_instructions')}" if st.get("payment_instructions") else "")
        )
        await self.c.notifications.notify(
            [player_id],
            NotificationType.PAYMENT_REMINDER,
            "Payment reminder",
            f"{amount} pending for {match.get('title', 'the match')}.",
            {"settlement_id": settlement_id, "match_id": rec["match_id"]},
        )
        phone = (player.get("mobile_number") or "").lstrip("+")
        url = f"https://wa.me/{phone}?text={quote(text)}" if phone else f"https://wa.me/?text={quote(text)}"
        return ShareOut(text=text, whatsapp_url=url)
