"""Turn a player account into a captain (or back). Players can't do this from inside the app during the beta.

cd backend && PYTHONPATH=. uv run python scripts/grant_captain.py someone@example.in
cd backend && PYTHONPATH=. uv run python scripts/grant_captain.py someone@example.in --revoke
"""

import asyncio
import sys

from app.core.config import Settings
from app.core.container import build_container
from app.modules.captains.service import CaptainService


async def main(email: str, revoke: bool) -> int:
    c = build_container(Settings())
    try:
        user = await c.mongo["users"].find_one({"email": email.lower()}, {"_id": 1, "full_name": 1, "roles": 1})
        if not user:
            print(f"no account with email {email}")
            return 1
        if revoke:
            await c.mongo["users"].update_one({"_id": user["_id"]}, {"$pull": {"roles": "captain"}})
        else:
            await CaptainService(c).ensure_profile(user["_id"])
        fresh = await c.mongo["users"].find_one({"_id": user["_id"]}, {"roles": 1})
        print(f"{user.get('full_name')}: roles = {sorted((fresh or {}).get('roles', []))}")
        return 0
    finally:
        await c.close() if hasattr(c, "close") else None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1], "--revoke" in sys.argv[2:])))
