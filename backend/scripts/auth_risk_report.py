"""READ-ONLY report: accounts whose credentials predate proof of the mobile number (auth review C1/C2).

    uv run python -m scripts.auth_risk_report

Lists (masked) every account that is not mobile-verified but holds a password or came from an invite
link. These are the accounts the hotfix protects; nothing is modified.
"""

import asyncio

from app.core.config import get_settings
from app.infrastructure.database.mongo import Mongo


def _mask(v: str | None) -> str:
    if not v:
        return "—"
    return v[:4] + "…" + v[-2:] if len(v) > 8 else v[0] + "…"


async def main() -> None:
    s = get_settings()
    mongo = Mongo(s.mongodb_uri, s.mongodb_db)
    try:
        q = {
            "mobile_verified": {"$ne": True},
            "account_status": {"$ne": "deleted"},
            "$or": [{"password_hash": {"$type": "string"}}, {"verified_via": {"$exists": True}}],
        }
        rows = [
            u
            async for u in mongo["users"].find(
                q, {"full_name": 1, "mobile_number": 1, "email": 1, "verified_via": 1, "created_at": 1}
            )
        ]
        print(f"{len(rows)} unverified account(s) holding credentials:")
        for u in rows:
            via = u.get("verified_via") or "self-registration"
            print(
                f"  {_mask(u.get('mobile_number'))}  {_mask(u.get('email'))}  via {via}  created {u.get('created_at'):%Y-%m-%d}"
            )
        print(
            "Read-only. The C1/C2 hotfix already blocks takeover of these accounts; their credentials are"
            " detached automatically the first time the number's owner signs in with an OTP."
        )
    finally:
        await mongo.close()


if __name__ == "__main__":
    asyncio.run(main())
