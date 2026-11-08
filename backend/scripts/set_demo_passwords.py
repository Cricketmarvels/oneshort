"""Give the seeded demo accounts strong random passwords (email login) for DEVELOPMENT demos.

Used when the dev server is exposed through a public tunnel with DEV_OTP_IN_RESPONSE=false:
OTP codes are no longer shown, so demo users sign in with email + password instead.
Writes the credentials to ../.data/demo-logins.txt (mode 600, git-ignored) and prints them once.

    uv run python -m scripts.set_demo_passwords            # keeps passwords already in the file
    uv run python -m scripts.set_demo_passwords --rotate   # generates new ones
"""

import asyncio
import os
import secrets
import string
import sys
from pathlib import Path

from app.core.config import get_settings
from app.core.security import hash_secret
from app.infrastructure.database.mongo import Mongo

DEMO_MOBILES = {"+919900000001": "Captain", "+919900000002": "Player", "+919900000099": "Admin"}
OUT = Path(__file__).resolve().parents[2] / ".data" / "demo-logins.txt"


def strong_password() -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(14))
        if any(c.isalpha() for c in pw) and any(c.isdigit() for c in pw):
            return pw


async def main() -> None:
    s = get_settings()
    if s.app_env == "production":
        raise SystemExit("Refusing to run in production")
    mongo = Mongo(s.mongodb_uri, s.mongodb_db)
    lines = []
    existing: dict[str, str] = {}
    if OUT.exists() and "--rotate" not in sys.argv:
        for line in OUT.read_text().splitlines():
            parts = line.split()
            if len(parts) == 3:
                existing[parts[1]] = parts[2]
    for mobile, label in DEMO_MOBILES.items():
        user = await mongo["users"].find_one({"mobile_number": mobile})
        if not user or not user.get("email"):
            print(f"skip {label}: not seeded")
            continue
        pw = existing.get(user["email"]) or strong_password()
        await mongo["users"].update_one({"_id": user["_id"]}, {"$set": {"password_hash": hash_secret(pw)}})
        lines.append(f"{label:8} {user['email']:32} {pw}")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("\n".join(lines) + "\n")
    os.chmod(OUT, 0o600)
    print("\n".join(lines))
    print(f"(saved to {OUT})")


if __name__ == "__main__":
    asyncio.run(main())
