"""Expenses and settlements (Split a Fee).

A settlement is created as a DRAFT for the captain to review, then PUBLISHED. Published
settlements are immutable: any change creates version n+1 which supersedes version n.
Amounts already marked paid under the superseded version are carried forward as
``credited_paise`` so nobody is asked to pay twice.
"""

import secrets
from typing import Any

from bson import ObjectId
from pymongo.asynchronous.client_session import AsyncClientSession

from app.api.dependencies import CurrentUser
from app.common.enums import (
    ContributionType,
    MatchStatus,
    NotificationType,
    PaymentStatus,
    SettlementStatus,
)
from app.common.types import utcnow
from app.core.container import Container
from app.core.exceptions import BusinessRuleViolation, Conflict, Forbidden, NotFound
from app.modules.settlements.calculator import Participant, calculate
from app.modules.settlements.context import FeeAccess
from app.modules.settlements.schemas import (
    ExpenseIn,
    ExpenseOut,
    ExpenseSnapshot,
    SettlementDraftIn,
    SettlementLineOut,
    SettlementOut,
)
from app.modules.users.schemas import public_user


def settlement_code() -> str:
    return "ST-" + secrets.token_hex(4).upper()


class SettlementService:
    def __init__(self, c: Container) -> None:
        self.c = c
        self.access = FeeAccess(c)
        self.expenses = c.mongo["expenses"]
        self.col = c.mongo["settlements"]
        self.records = c.mongo["payment_records"]

    # -------------------------------------------------------------- expenses
    async def add_expense(self, user: CurrentUser, match_id: ObjectId, data: ExpenseIn) -> ExpenseOut:
        match, _ = await self.access.load_managed(match_id, user)
        if match["match_status"] == MatchStatus.CANCELLED:
            raise BusinessRuleViolation("Cannot add expenses to a cancelled match", code="MATCH_CANCELLED")
        doc = {
            "match_id": match_id,
            **data.model_dump(mode="json"),
            "added_by": user.id,
            "created_at": utcnow(),
            "deleted_at": None,
        }
        res = await self.expenses.insert_one(doc)
        await self.c.audit.log(
            actor_id=user.id,
            action="expense.added",
            entity_type="match",
            entity_id=match_id,
            new_value=data.model_dump(mode="json"),
            request_id=user.request_id,
        )
        return self._expense_out({**doc, "_id": res.inserted_id})

    async def list_expenses(self, user: CurrentUser, match_id: ObjectId) -> list[ExpenseOut]:
        await self._ensure_can_view(user, match_id)
        return [
            self._expense_out(e)
            async for e in self.expenses.find({"match_id": match_id, "deleted_at": None}).sort("created_at", 1)
        ]

    async def delete_expense(self, user: CurrentUser, match_id: ObjectId, expense_id: ObjectId) -> None:
        await self.access.load_managed(match_id, user)
        res = await self.expenses.update_one(
            {"_id": expense_id, "match_id": match_id, "deleted_at": None},
            {"$set": {"deleted_at": utcnow(), "deleted_by": user.id}},
        )
        if res.modified_count == 0:
            raise NotFound("Expense not found")
        await self.c.audit.log(
            actor_id=user.id,
            action="expense.deleted",
            entity_type="match",
            entity_id=match_id,
            new_value={"expense_id": expense_id},
            request_id=user.request_id,
        )

    @staticmethod
    def _expense_out(e: dict[str, Any]) -> ExpenseOut:
        return ExpenseOut(
            id=str(e["_id"]),
            label=e["label"],
            category=e["category"],
            amount_paise=e["amount_paise"],
            notes=e.get("notes"),
            added_by=str(e["added_by"]),
            created_at=e["created_at"],
        )

    async def _ensure_can_view(self, user: CurrentUser, match_id: ObjectId) -> str:
        match, team = await self.access.load(match_id)
        relation, _ = await self.access.relation(match, team, user.id)
        if relation == "manager":
            return relation
        seat = await self.c.mongo[self.access.squad_collection(match)].count_documents(
            {"match_id": match_id, "player_id": user.id}, limit=1
        )
        if seat:
            return "participant"
        raise Forbidden("Only match participants can view fees", code="FEES_PRIVATE")

    # ----------------------------------------------------------- settlements
    async def create_draft(self, user: CurrentUser, match_id: ObjectId, data: SettlementDraftIn) -> SettlementOut:
        match, _ = await self.access.load_managed(match_id, user)
        if match["match_status"] in (MatchStatus.CANCELLED, MatchStatus.DRAFT):
            raise BusinessRuleViolation(
                "Settlements need a published, non-cancelled match", code="MATCH_NOT_SETTLEABLE"
            )
        expenses = [
            e async for e in self.expenses.find({"match_id": match_id, "deleted_at": None}).sort("created_at", 1)
        ]
        if not expenses:
            raise BusinessRuleViolation("Add at least one expense first", code="NO_EXPENSES")
        roster = [
            r
            async for r in self.c.mongo[self.access.squad_collection(match)].find(
                {"match_id": match_id, "is_active": True}
            )
        ]
        if not roster:
            raise BusinessRuleViolation("The squad is empty", code="EMPTY_SQUAD")
        roster_ids = {r["player_id"] for r in roster}
        for pid in [*data.exempt_player_ids, *(a.player_id for a in data.adjustments), *data.contribution_overrides]:
            if ObjectId(pid) not in roster_ids:
                raise BusinessRuleViolation("Adjustments can only reference squad players", code="NOT_ON_ROSTER")
        users = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": list(roster_ids)}})}
        fixed = {a.player_id: a.amount_paise for a in data.adjustments}
        exempt = set(data.exempt_player_ids)
        participants = [
            Participant(
                player_id=str(r["player_id"]),
                name=users.get(r["player_id"], {}).get("full_name", "Player"),
                contribution_type=ContributionType(
                    data.contribution_overrides.get(str(r["player_id"])) or r["contribution_type"]
                ),
                exempt=str(r["player_id"]) in exempt,
                fixed_amount_paise=fixed.get(str(r["player_id"])),
            )
            for r in roster
        ]
        total = sum(e["amount_paise"] for e in expenses)
        calc = calculate(total, participants, data.rounding_mode)
        published = await self.col.find_one({"match_id": match_id, "settlement_status": SettlementStatus.PUBLISHED})
        latest = await self.col.find_one({"match_id": match_id}, sort=[("version", -1)])
        draft = await self.col.find_one({"match_id": match_id, "settlement_status": SettlementStatus.DRAFT})
        credited = await self._credits(published["_id"]) if published else {}
        now = utcnow()
        doc = {
            "match_id": match_id,
            "team_id": match["team_id"],
            "captain_id": match["captain_id"],
            "version": draft["version"] if draft else ((latest or {}).get("version", 0) + 1),
            "revises_settlement_id": published["_id"] if published else None,
            "revision_reason": data.revision_reason,
            "settlement_status": SettlementStatus.DRAFT.value,
            "expenses_snapshot": [
                {"label": e["label"], "category": e["category"], "amount_paise": e["amount_paise"]} for e in expenses
            ],
            "total_expenses_paise": calc.total_expenses_paise,
            "eligible_players": calc.eligible_players,
            "individual_contribution_paise": calc.individual_contribution_paise,
            "rounding_mode": calc.rounding_mode.value,
            "rounding_adjustment_paise": calc.rounding_adjustment_paise,
            "total_assigned_paise": calc.total_assigned_paise,
            "lines": [
                {
                    "player_id": ObjectId(line.player_id),
                    "name": line.name,
                    "contribution_type": line.contribution_type.value,
                    "eligible": line.eligible,
                    "exempt": line.exempt,
                    "adjusted": line.adjusted,
                    "amount_paise": line.amount_paise,
                    "credited_paise": min(credited.get(ObjectId(line.player_id), 0), line.amount_paise),
                }
                for line in calc.lines
            ],
            "payment_instructions": data.payment_instructions,
            "created_by": user.id,
            "updated_at": now,
        }
        if draft:
            await self.col.update_one({"_id": draft["_id"]}, {"$set": doc})
            sid = draft["_id"]
        else:
            res = await self.col.insert_one(
                {**doc, "settlement_code": settlement_code(), "created_at": now, "published_at": None}
            )
            sid = res.inserted_id
        await self.c.audit.log(
            actor_id=user.id,
            action="settlement.draft_saved",
            entity_type="settlement",
            entity_id=sid,
            new_value={"total": total, "version": doc["version"]},
            request_id=user.request_id,
        )
        return await self.get_out(sid)

    async def _credits(self, settlement_id: ObjectId) -> dict[ObjectId, int]:
        out: dict[ObjectId, int] = {}
        async for r in self.records.find({"settlement_id": settlement_id}):
            paid = r["amount_paise"] if r["status"] == PaymentStatus.PAID else r.get("credited_paise", 0)
            out[r["player_id"]] = paid
        return out

    async def publish(self, user: CurrentUser, settlement_id: ObjectId) -> SettlementOut:
        st = await self.col.find_one({"_id": settlement_id})
        if not st:
            raise NotFound("Settlement not found")
        await self.access.load_managed(st["match_id"], user)
        if st["settlement_status"] != SettlementStatus.DRAFT:
            raise Conflict(
                "Only a draft can be published; published settlements are immutable", code="SETTLEMENT_IMMUTABLE"
            )
        match, team = await self.access.load(st["match_id"])
        now = utcnow()

        async def txn(s: AsyncClientSession) -> None:
            if st.get("revises_settlement_id"):
                res = await self.col.update_one(
                    {"_id": st["revises_settlement_id"], "settlement_status": SettlementStatus.PUBLISHED.value},
                    {
                        "$set": {
                            "settlement_status": SettlementStatus.SUPERSEDED.value,
                            "superseded_at": now,
                            "superseded_by": settlement_id,
                        }
                    },
                    session=s,
                )
                if res.modified_count == 0:
                    raise Conflict(
                        "The settlement being revised changed, please regenerate the draft", code="CONCURRENT_UPDATE"
                    )
            res = await self.col.update_one(
                {"_id": settlement_id, "settlement_status": SettlementStatus.DRAFT.value},
                {
                    "$set": {
                        "settlement_status": SettlementStatus.PUBLISHED.value,
                        "published_at": now,
                        "published_by": user.id,
                    }
                },
                session=s,
            )
            if res.modified_count == 0:
                raise Conflict("Settlement was already published", code="SETTLEMENT_IMMUTABLE")
            docs = []
            for line in st["lines"]:
                credited = int(line.get("credited_paise", 0))
                if not line["eligible"]:
                    status = PaymentStatus.EXEMPTED
                elif line["amount_paise"] == 0 or credited >= line["amount_paise"]:
                    status = PaymentStatus.PAID
                else:
                    status = PaymentStatus.PENDING
                docs.append(
                    {
                        "settlement_id": settlement_id,
                        "match_id": st["match_id"],
                        "team_id": st["team_id"],
                        "player_id": line["player_id"],
                        "captain_id": st["captain_id"],
                        "amount_paise": int(line["amount_paise"]),
                        "credited_paise": credited,
                        "currency": "INR",
                        "status": status.value,
                        "method": None,
                        "verification": "manual_captain_confirmed",
                        "updated_by": user.id,
                        "updated_at": now,
                        "remarks": "Carried over from previous settlement"
                        if credited and status == PaymentStatus.PAID
                        else None,
                        "status_history": [
                            {
                                "from": None,
                                "to": status.value,
                                "by": user.id,
                                "at": now,
                                "reason": "settlement published",
                            }
                        ],
                        "dispute": None,
                    }
                )
            if docs:
                await self.records.insert_many(docs, session=s)
            await self.c.audit.log(
                actor_id=user.id,
                action="settlement.published",
                entity_type="settlement",
                entity_id=settlement_id,
                new_value={
                    "version": st["version"],
                    "total": st["total_expenses_paise"],
                    "revises": st.get("revises_settlement_id"),
                },
                request_id=user.request_id,
                session=s,
            )

        await self.c.mongo.transaction(txn)
        payees = [line["player_id"] for line in st["lines"] if line["eligible"] and line["player_id"] != user.id]
        await self.c.notifications.notify(
            payees,
            NotificationType.SETTLEMENT_CREATED,
            f"Match fee{' (revised)' if st.get('revises_settlement_id') else ''}: {match.get('title', 'Match')}",
            f"{(team or {}).get('team_name', 'Team')}: see your contribution and payment instructions.",
            {"match_id": st["match_id"], "settlement_id": settlement_id},
        )
        await self.c.notifications.emit(
            [line["player_id"] for line in st["lines"]], "payment.updated", {"settlement_id": str(settlement_id)}
        )
        return await self.get_out(settlement_id)

    async def list_for_match(self, user: CurrentUser, match_id: ObjectId) -> list[SettlementOut]:
        relation = await self._ensure_can_view(user, match_id)
        q: dict[str, Any] = {"match_id": match_id}
        if relation != "manager":
            q["settlement_status"] = {"$ne": SettlementStatus.DRAFT}
        return [await self.get_out(s["_id"]) async for s in self.col.find(q, {"_id": 1}).sort("version", -1)]

    async def get_out(self, settlement_id: ObjectId) -> SettlementOut:
        st = await self.col.find_one({"_id": settlement_id})
        if not st:
            raise NotFound("Settlement not found")
        ids = [line["player_id"] for line in st["lines"]]
        users = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": ids}})}
        return SettlementOut(
            id=str(st["_id"]),
            settlement_code=st["settlement_code"],
            match_id=str(st["match_id"]),
            version=st["version"],
            settlement_status=st["settlement_status"],
            revises_settlement_id=str(st["revises_settlement_id"]) if st.get("revises_settlement_id") else None,
            revision_reason=st.get("revision_reason"),
            expenses=[ExpenseSnapshot(**e) for e in st["expenses_snapshot"]],
            total_expenses_paise=st["total_expenses_paise"],
            eligible_players=st["eligible_players"],
            individual_contribution_paise=st["individual_contribution_paise"],
            rounding_mode=st["rounding_mode"],
            rounding_adjustment_paise=st["rounding_adjustment_paise"],
            total_assigned_paise=st["total_assigned_paise"],
            lines=[
                SettlementLineOut(
                    player=public_user(
                        users.get(line["player_id"], {"_id": line["player_id"], "full_name": line["name"]})
                    ),
                    contribution_type=line["contribution_type"],
                    eligible=line["eligible"],
                    exempt=line["exempt"],
                    adjusted=line["adjusted"],
                    amount_paise=line["amount_paise"],
                    credited_paise=line.get("credited_paise", 0),
                )
                for line in st["lines"]
            ],
            payment_instructions=st.get("payment_instructions"),
            created_at=st["created_at"],
            published_at=st.get("published_at"),
        )
