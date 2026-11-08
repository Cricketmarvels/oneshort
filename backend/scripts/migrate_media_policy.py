"""Remove stored media values that break the media policy (e.g. legacy DiceBear avatars and logos).

    uv run python -m scripts.migrate_media_policy           # dry run: report only
    uv run python -m scripts.migrate_media_policy --apply   # remove and audit each value

Safe to re-run. Valid PlayR uploads are kept. See app/modules/uploads/media_policy.py.
"""

import asyncio
import sys

from app.core.config import get_settings
from app.infrastructure.database.mongo import Mongo
from app.modules.uploads.media_policy import enforce_media_policy


async def main() -> None:
    apply = "--apply" in sys.argv
    s = get_settings()
    mongo = Mongo(s.mongodb_uri, s.mongodb_db)
    try:
        r = await enforce_media_policy(mongo, s, apply=apply)
    finally:
        await mongo.close()
    verb = "Removed" if apply else "Would remove"
    print(f"Checked {r.checked} media values; kept {r.kept} PlayR uploads. {verb} {r.total_removed}.")
    for k, n in sorted(r.removed.items()):
        print(f"  {k}: {n}")
    for h, n in sorted(r.hosts.items()):
        print(f"  from {h}: {n}")
    if not apply and r.total_removed:
        print("Dry run only. Re-run with --apply to remove them.")


if __name__ == "__main__":
    asyncio.run(main())
