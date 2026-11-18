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
    CarriedDueOut,
    ExpenseIn,
    ExpenseOut,
    ExpenseSnapshot,
    ExtraPlayerIn,
    ManualDueIn,
    OtherDueIn,
    OtherDueOut,
    PreviousDueOut,
    SettlementDraftIn,
    SettlementLineOut,
    SettlementOut,
)
from app.modules.users.schemas import public_user


def _norm(name: str | None) -> str:
    return " ".join((name or "").lower().split())


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
        if seat or await self.records.count_documents({"match_id": match_id, "player_id": user.id}, limit=1):
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
        if data.player_ids is not None:  # the captain ticked who shares the fee
            ticked = {ObjectId(x) for x in data.player_ids}
            if ticked - {r["player_id"] for r in roster}:
                raise BusinessRuleViolation("Ticked players must be in the squad", code="NOT_ON_ROSTER")
            roster = [r for r in roster if r["player_id"] in ticked]
        extras = await self._extras(match_id, data.extra_players, {r["player_id"] for r in roster})
        if not roster and not extras:
            raise BusinessRuleViolation("Pick at least one player to share the fee", code="EMPTY_SQUAD")
        roster_ids = {r["player_id"] for r in roster}
        everyone = roster_ids | {x["player_id"] for x in extras}
        for pid in [*data.exempt_player_ids, *(a.player_id for a in data.adjustments), *data.contribution_overrides]:
            if ObjectId(pid) not in everyone:
                raise BusinessRuleViolation("Adjustments can only reference players in the split", code="NOT_ON_ROSTER")
        users = {u["_id"]: u async for u in self.c.mongo["users"].find({"_id": {"$in": list(roster_ids)}})}
        people = [
            {**r, "name": users.get(r["player_id"], {}).get("full_name", "Player"), "guest": False, "added": False}
            for r in roster
        ] + extras
        flags = {str(x["player_id"]): x for x in people}
        fixed = {a.player_id: a.amount_paise for a in data.adjustments}
        exempt = set(data.exempt_player_ids)
        participants = [
            Participant(
                player_id=str(r["player_id"]),
                name=r["name"],
                contribution_type=ContributionType(
                    data.contribution_overrides.get(str(r["player_id"])) or r["contribution_type"]
                ),
                exempt=str(r["player_id"]) in exempt,
                fixed_amount_paise=fixed.get(str(r["player_id"])),
            )
            for r in people
        ]
        total = sum(e["amount_paise"] for e in expenses)
        calc = calculate(total, participants, data.rounding_mode)
        carries = await self._carries(match, data.carry_record_ids, people)
        priors = self._priors(data.manual_dues, people)
        others = self._others(data.other_dues)
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
            "carried_paise": sum(i["amount_paise"] for items in carries.values() for i in items),
            "prior_paise": sum(v["amount_paise"] for v in priors.values()),
            "other_dues": others,
            "lines": [
                {
                    "player_id": ObjectId(line.player_id),
                    "name": line.name,
                    "contribution_type": line.contribution_type.value,
                    "eligible": line.eligible,
                    "exempt": line.exempt,
                    "adjusted": line.adjusted,
                    "share_paise": line.amount_paise,
                    "carried_paise": (owed := sum(i["amount_paise"] for i in carries.get(line.player_id, []))),
                    "carried": carries.get(line.player_id, []),
                    "prior_paise": (prior := priors.get(line.player_id, {}).get("amount_paise", 0)),
                    "prior_note": priors.get(line.player_id, {}).get("note"),
                    # An advance can bring the amount down to zero, never below.
                    "amount_paise": (total := max(0, line.amount_paise + owed + prior)),
                    "credited_paise": min(credited.get(ObjectId(line.player_id), 0), total),
                    "guest": flags[line.player_id]["guest"],
                    "added": flags[line.player_id]["added"],
                }
                for line in calc.lines
            ],
            "payment_instructions": data.payment_instructions,
            "upi_id": data.upi_id,
            "created_by": user.id,
            "updated_at": now,
        }
        if data.upi_id and data.upi_id != user.doc.get("fee_upi_id"):
            await self.c.mongo["users"].update_one({"_id": user.id}, {"$set": {"fee_upi_id": data.upi_id}})
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

    async def _extras(
        self, match_id: ObjectId, extras: list[ExtraPlayerIn], taken: set[ObjectId]
    ) -> list[dict[str, Any]]:
        """Resolve last-minute players: registered users by id, guests by name. A guest keeps the id they were
        given in an earlier split of this match, so recalculating or revising never bills them twice."""
        known_guests = {
            line["player_id"]
            async for st in self.col.find({"match_id": match_id}, {"lines": 1})
            for line in st["lines"]
            if line.get("guest")
        }
        out: list[dict[str, Any]] = []
        seen = set(taken)
        for x in extras:
            if x.user_id:
                u = await self.c.mongo["users"].find_one(
                    {"_id": ObjectId(x.user_id), "account_status": {"$ne": "deleted"}}, {"full_name": 1}
                )
                if not u:
                    raise NotFound("Player not found")
                pid, name, guest = u["_id"], u.get("full_name") or x.name, False
            else:
                gid = ObjectId(x.guest_id) if x.guest_id else None
                pid, name, guest = (gid if gid in known_guests else ObjectId()), x.name, True
            if pid in seen:
                raise BusinessRuleViolation(f"{name} is already in the split", code="DUPLICATE_PARTICIPANT")
            seen.add(pid)
            out.append(
                {
                    "player_id": pid,
                    "name": name,
                    "contribution_type": ContributionType.PAYEE.value,
                    "guest": guest,
                    "added": True,
                }
            )
        return out

    # ------------------------------------------------------- previous dues
    async def _fixture_info(self, match_id: ObjectId) -> dict[str, Any]:
        m = await self.c.mongo["matches"].find_one({"_id": match_id}, {"title": 1, "start_at": 1})
        if not m:
            m = await self.c.mongo["fee_sides"].find_one({"_id": match_id}, {"title": 1, "start_at": 1})
        return m or {}

    async def _carryable(self, match: dict[str, Any]) -> list[dict[str, Any]]:
        """Unpaid records from this team's other matches that may be added to this match's fee: still pending on
        a current (published) split, or already moved to an earlier version of this match's split."""
        mine = [s["_id"] async for s in self.col.find({"match_id": match["_id"]}, {"_id": 1})]
        others = [
            s["_id"]
            async for s in self.col.find(
                {
                    "team_id": match["team_id"],
                    "match_id": {"$ne": match["_id"]},
                    "settlement_status": SettlementStatus.PUBLISHED.value,
                },
                {"_id": 1},
            )
        ]
        if not others:
            return []
        q = {
            "settlement_id": {"$in": others},
            "$or": [
                {"status": PaymentStatus.PENDING.value, "carried_to": None},
                {"status": PaymentStatus.CARRIED.value, "carried_to": {"$in": mine}},
            ],
        }
        return [r async for r in self.records.find(q).limit(500) if r["amount_paise"] - r.get("credited_paise", 0) > 0]

    async def _due_item(self, r: dict[str, Any], cache: dict[ObjectId, dict[str, Any]]) -> dict[str, Any]:
        if r["match_id"] not in cache:
            cache[r["match_id"]] = await self._fixture_info(r["match_id"])
        fx = cache[r["match_id"]]
        return {
            "record_id": r["_id"],
            "match_id": r["match_id"],
            "match_title": fx.get("title") or "Match",
            "match_start_at": fx.get("start_at"),
            "amount_paise": int(r["amount_paise"] - r.get("credited_paise", 0)),
        }

    async def previous_dues(self, user: CurrentUser, match_id: ObjectId) -> list[PreviousDueOut]:
        """Who still owes this team from earlier matches, so the captain can add it to this match's fee.
        Guests have no account, so a guest is recognised across matches by name."""
        match, _ = await self.access.load_managed(match_id, user)
        recs = await self._carryable(match)
        users = {
            u["_id"]: u
            async for u in self.c.mongo["users"].find(
                {"_id": {"$in": list({r["player_id"] for r in recs if not r.get("is_guest")})}}, {"full_name": 1}
            )
        }
        cache: dict[ObjectId, dict[str, Any]] = {}
        groups: dict[str, dict[str, Any]] = {}
        for r in recs:
            guest = bool(r.get("is_guest"))
            name = r.get("player_name") if guest else users.get(r["player_id"], {}).get("full_name")
            key = f"guest:{_norm(name)}" if guest else str(r["player_id"])
            g = groups.setdefault(
                key, {"player_id": r["player_id"], "name": name or "Player", "guest": guest, "items": []}
            )
            g["items"].append(await self._due_item(r, cache))
        out = []
        for g in groups.values():
            items = sorted(g["items"], key=lambda i: i["match_start_at"] or utcnow())
            if g["guest"]:
                g["player_id"] = next(r["player_id"] for r in recs if r["_id"] == items[-1]["record_id"])
            out.append(
                PreviousDueOut(
                    player_id=str(g["player_id"]),
                    name=g["name"],
                    guest=g["guest"],
                    total_paise=sum(i["amount_paise"] for i in items),
                    items=[self._due_out(i) for i in items],
                )
            )
        return sorted(out, key=lambda d: (-d.total_paise, d.name.lower()))

    @staticmethod
    def _due_out(i: dict[str, Any]) -> CarriedDueOut:
        return CarriedDueOut(
            record_id=str(i["record_id"]),
            match_id=str(i["match_id"]),
            match_title=i["match_title"],
            match_start_at=i.get("match_start_at"),
            amount_paise=i["amount_paise"],
        )

    async def _carries(
        self, match: dict[str, Any], record_ids: list[str], people: list[dict[str, Any]]
    ) -> dict[str, list[dict[str, Any]]]:
        """Earlier unpaid fees the captain chose to add, keyed by the line (player id) they land on. A registered
        player's due lands on their own line; a guest's on the guest of the same name in this split."""
        if not record_ids:
            return {}
        allowed = {r["_id"]: r for r in await self._carryable(match)}
        guests = {_norm(p["name"]): str(p["player_id"]) for p in people if p.get("guest")}
        players = {str(p["player_id"]) for p in people}
        cache: dict[ObjectId, dict[str, Any]] = {}
        out: dict[str, list[dict[str, Any]]] = {}
        for rid in dict.fromkeys(ObjectId(x) for x in record_ids):
            r = allowed.get(rid)
            if not r:
                raise BusinessRuleViolation(
                    "That earlier fee is no longer unpaid. Refresh and try again.", code="PREVIOUS_DUE_CHANGED"
                )
            target = guests.get(_norm(r.get("player_name"))) if r.get("is_guest") else str(r["player_id"])
            if target not in players:
                raise BusinessRuleViolation(
                    "Earlier dues can only be added for players in this split", code="NOT_IN_SPLIT"
                )
            out.setdefault(target, []).append(await self._due_item(r, cache))
        return out

    @staticmethod
    def _priors(dues: list[ManualDueIn], people: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
        """Earlier balances kept outside OneShort, keyed by the line (player id) they land on. A guest added by
        name in this request is found by name."""
        if not dues:
            return {}
        ids = {str(p["player_id"]) for p in people}
        guests = {_norm(p["name"]): str(p["player_id"]) for p in people if p.get("guest")}
        out: dict[str, dict[str, Any]] = {}
        for d in dues:
            target = d.player_id if d.player_id in ids else guests.get(_norm(d.name)) if d.name else None
            if target is None:
                raise BusinessRuleViolation(
                    "Earlier dues can only be added for players in this split", code="NOT_IN_SPLIT"
                )
            if d.amount_paise == 0:
                continue
            prev = out.get(target)
            out[target] = {
                "amount_paise": (prev["amount_paise"] if prev else 0) + d.amount_paise,
                "note": d.note or (prev or {}).get("note") or ("Advance" if d.amount_paise < 0 else "Previous dues"),
            }
        return out

    @staticmethod
    def _others(dues: list[OtherDueIn]) -> list[dict[str, Any]]:
        """Balances of people not playing this match, one row per person (same name merged), zeros dropped."""
        out: dict[str, dict[str, Any]] = {}
        for d in dues:
            if d.amount_paise == 0:
                continue
            key = _norm(d.name)
            prev = out.get(key)
            out[key] = {
                "name": prev["name"] if prev else d.name.strip(),
                "amount_paise": (prev["amount_paise"] if prev else 0) + d.amount_paise,
                "note": d.note or (prev or {}).get("note") or ("Advance" if d.amount_paise < 0 else "Previous dues"),
            }
        return list(out.values())

    async def outside_dues(self, user: CurrentUser, match_id: ObjectId) -> list[OtherDueOut]:
        """Balances of people not playing, kept from this team's most recent split, so the list rolls forward to
        the next match without pasting it again. Empty once this match has its own split."""
        match, _ = await self.access.load_managed(match_id, user)
        if await self.col.find_one({"match_id": match_id}, projection={"_id": 1}):
            return []
        latest = await self.col.find_one(
            {"team_id": match["team_id"], "match_id": {"$ne": match_id}}, sort=[("created_at", -1)]
        )
        return [OtherDueOut(**d) for d in (latest or {}).get("other_dues", [])]

    async def captain_upi(self, captain_id: ObjectId) -> str | None:
        """The captain's saved UPI ID: used when a split was shared before they added one, so the group
        message and reminders still tell players where to pay without revising the split."""
        u = await self.c.mongo["users"].find_one({"_id": captain_id}, {"fee_upi_id": 1}) or {}
        return u.get("fee_upi_id")

    async def _credits(self, settlement_id: ObjectId) -> dict[ObjectId, int]:
        out: dict[ObjectId, int] = {}
        async for r in self.records.find({"settlement_id": settlement_id}):
            # A due moved onto a later match's fee is settled here: revising this split must not bill it again.
            settled = r["status"] in (PaymentStatus.PAID, PaymentStatus.CARRIED)
            paid = r["amount_paise"] if settled else r.get("credited_paise", 0)
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
            await self._move_dues(st, user.id, match.get("title") or "Match", now, s)
            docs = []
            for line in st["lines"]:
                credited = int(line.get("credited_paise", 0))
                if not line["eligible"] and line["amount_paise"] == 0:
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
                        "player_name": line.get("name"),
                        "is_guest": bool(line.get("guest")),
                        "captain_id": st["captain_id"],
                        "amount_paise": int(line["amount_paise"]),
                        "credited_paise": credited,
                        "carried_paise": int(line.get("carried_paise", 0)),
                        "prior_paise": int(line.get("prior_paise", 0)),
                        "prior_note": line.get("prior_note"),
                        "carried_record_ids": [i["record_id"] for i in line.get("carried", [])],
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

    async def _move_dues(self, st: dict[str, Any], by: ObjectId, title: str, now: Any, s: AsyncClientSession) -> None:
        """Inside the publish transaction: earlier unpaid fees added to this split move here (their old record says
        where they went), and any a revision dropped go back to pending on their own match."""
        moving = {i["record_id"] for line in st["lines"] for i in line.get("carried", [])}
        prev = st.get("revises_settlement_id")
        for rid in moving:
            res = await self.records.update_one(
                {
                    "_id": rid,
                    "$or": [
                        {"status": PaymentStatus.PENDING.value, "carried_to": None},
                        *([{"status": PaymentStatus.CARRIED.value, "carried_to": prev}] if prev else []),
                    ],
                },
                {
                    "$set": {
                        "status": PaymentStatus.CARRIED.value,
                        "carried_to": st["_id"],
                        "carried_to_match_id": st["match_id"],
                        "remarks": f"Added to the {title} fee",
                        "updated_by": by,
                        "updated_at": now,
                    },
                    "$push": {
                        "status_history": {
                            "from": PaymentStatus.PENDING.value,
                            "to": PaymentStatus.CARRIED.value,
                            "by": by,
                            "at": now,
                            "reason": f"Added to the {title} fee",
                        }
                    },
                },
                session=s,
            )
            if res.modified_count == 0:
                raise Conflict(
                    "An earlier fee in this split was paid or changed. Recalculate the split.",
                    code="PREVIOUS_DUE_CHANGED",
                )
        if prev:
            await self.records.update_many(
                {"status": PaymentStatus.CARRIED.value, "carried_to": prev, "_id": {"$nin": list(moving)}},
                {
                    "$set": {
                        "status": PaymentStatus.PENDING.value,
                        "carried_to": None,
                        "remarks": None,
                        "updated_at": now,
                    },
                    "$push": {
                        "status_history": {
                            "from": PaymentStatus.CARRIED.value,
                            "to": PaymentStatus.PENDING.value,
                            "by": by,
                            "at": now,
                            "reason": f"Removed from the {title} fee",
                        }
                    },
                },
                session=s,
            )

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
                    guest=bool(line.get("guest")),
                    added=bool(line.get("added")),
                    share_paise=line.get("share_paise", line["amount_paise"] - line.get("carried_paise", 0)),
                    carried_paise=line.get("carried_paise", 0),
                    carried=[self._due_out(i) for i in line.get("carried", [])],
                    prior_paise=line.get("prior_paise", 0),
                    prior_note=line.get("prior_note"),
                )
                for line in st["lines"]
            ],
            carried_paise=st.get("carried_paise", 0),
            prior_paise=st.get("prior_paise", 0),
            other_dues=[OtherDueOut(**d) for d in st.get("other_dues", [])],
            payment_instructions=st.get("payment_instructions"),
            upi_id=st.get("upi_id") or await self.captain_upi(st["captain_id"]),
            created_at=st["created_at"],
            published_at=st.get("published_at"),
        )
