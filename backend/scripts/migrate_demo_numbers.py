"""Move seeded demo accounts off real-looking Indian numbers onto the reserved fictional range.

Only numbers the seed scripts generated are touched:
    +91 99000 000NN, +91 99000 00101  (named demo logins)
    +91 981 xxxxxxx, +91 982 xxxxxxx  (bulk seed players and team members)
Every other account, including real people's, is left alone.

    uv run python -m scripts.migrate_demo_numbers           # dry run: print the plan
    uv run python -m scripts.migrate_demo_numbers --apply   # remap, validated and audited

Each new number passes the same validator the API uses, and is checked to be unused. Each change is written to
audit_logs. The update matches on the old number, so a concurrent change is never overwritten. Development only.
"""

import asyncio
import re
import sys

from bson import ObjectId

from app.common.validators import _mobile
from app.core.config import get_settings
from app.infrastructure.database.mongo import Mongo
from app.modules.audit.service import AuditService
from scripts.demo_numbers import demo_mobile

NAMED = re.compile(r"^\+9199000(\d{5})$")  # +91 99000 000NN / 00101
BULK_981 = re.compile(r"^\+91981(\d{7})$")
BULK_982 = re.compile(r"^\+91982(\d{7})$")


def planned_slot(number: str) -> int | None:
    """Slot in the fictional range for a seeded number, or None when it isn't seeded or has no fixed slot."""
    if m := NAMED.match(number):
        n = int(m.group(1))
        return {1: 1, 2: 2, 3: 3, 4: 4, 99: 99, 101: 10}.get(n)
    if (m := BULK_981.match(number)) and int(m.group(1)) < 100:
        return 100 + int(m.group(1))
    if (m := BULK_982.match(number)) and int(m.group(1)) < 500:
        return 200 + int(m.group(1))
    return None


def is_seeded(number: str) -> bool:
    return bool(NAMED.match(number) or BULK_981.match(number) or BULK_982.match(number))


async def main() -> None:
    apply = "--apply" in sys.argv
    s = get_settings()
    if s.app_env == "production":
        raise SystemExit("Refusing to run in production")
    mongo = Mongo(s.mongodb_uri, s.mongodb_db)
    audit = AuditService(mongo)
    users = mongo["users"]
    try:
        taken = {
            u["mobile_number"] async for u in users.find({"mobile_number": {"$exists": True}}, {"mobile_number": 1})
        }
        overflow = 700
        plan: list[tuple[ObjectId, str, str, str]] = []
        async for u in users.find({}, {"mobile_number": 1, "full_name": 1}).sort("mobile_number", 1):
            old = u.get("mobile_number") or ""
            if not is_seeded(old):
                continue
            slot = planned_slot(old)
            new = demo_mobile(slot) if slot is not None else None
            while new is None or new in taken:
                new = demo_mobile(overflow)
                overflow += 1
            _mobile(new)  # same rule as the API; raises if invalid
            taken.add(new)
            plan.append((u["_id"], old, new, u.get("full_name", "")))
        for _, old, new, name in plan:
            print(f"  {old} -> {new}  {name}")
        print(f"{len(plan)} seeded accounts {'remapped' if apply else 'to remap'}; other accounts untouched.")
        if not apply:
            if plan:
                print("Dry run only. Re-run with --apply to change them.")
            return
        for uid, old, new, _ in plan:
            res = await users.update_one({"_id": uid, "mobile_number": old}, {"$set": {"mobile_number": new}})
            if res.modified_count:
                await audit.log(
                    actor_id=None,
                    action="user.demo_number_remap",
                    entity_type="user",
                    entity_id=uid,
                    previous_value={"mobile_number": old},
                    new_value={"mobile_number": new, "reason": "seeded demo account moved to fictional range"},
                )
    finally:
        await mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
