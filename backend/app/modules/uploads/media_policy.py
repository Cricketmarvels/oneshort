"""Bring stored media fields in line with the media policy: only files PlayR stored itself may be shown.

This uses the same rule the API enforces on write (``is_own_media``, behind ``OwnMediaUrl``). It only removes values
that fail it, so every client falls back to the branded initials or banner. Nothing new is ever written into a
media field. Each removal is audited, and the update matches on the old value so a concurrent valid upload is never
overwritten. Valid uploads, including legacy absolute URLs on our own base, are left untouched.
"""

from dataclasses import dataclass, field

from app.core.config import Settings
from app.infrastructure.database.mongo import Mongo
from app.infrastructure.integrations.storage import is_own_media
from app.modules.audit.service import AuditService

# collection → (audit entity type, media fields)
MEDIA_FIELDS: dict[str, tuple[str, tuple[str, ...]]] = {
    "users": ("user", ("profile_image",)),
    "teams": ("team", ("logo", "cover_image")),
    "matches": ("match", ("cover_image",)),
}
ACTION = "media.policy_cleanup"


@dataclass
class PolicyReport:
    checked: int = 0
    kept: int = 0
    removed: dict[str, int] = field(default_factory=dict)  # "collection.field" → count
    hosts: dict[str, int] = field(default_factory=dict)  # offending origin → count (for the log, never the full URL)

    @property
    def total_removed(self) -> int:
        return sum(self.removed.values())


def _origin(url: str) -> str:
    if "://" not in url:
        return "(relative path)"
    scheme, rest = url.split("://", 1)
    return f"{scheme}://{rest.split('/', 1)[0]}"


async def enforce_media_policy(mongo: Mongo, settings: Settings, *, apply: bool) -> PolicyReport:
    """Dry run unless ``apply``; returns what was (or would be) removed."""
    audit = AuditService(mongo)
    report = PolicyReport()
    for coll, (entity, fields) in MEDIA_FIELDS.items():
        query = {"$or": [{f: {"$type": "string", "$ne": ""}} for f in fields]}
        async for doc in mongo[coll].find(query, {f: 1 for f in fields}):
            for f in fields:
                value = doc.get(f)
                if not isinstance(value, str) or not value:
                    continue
                report.checked += 1
                if is_own_media(value, settings):
                    report.kept += 1
                    continue
                key = f"{coll}.{f}"
                report.removed[key] = report.removed.get(key, 0) + 1
                host = _origin(value)
                report.hosts[host] = report.hosts.get(host, 0) + 1
                if not apply:
                    continue
                res = await mongo[coll].update_one({"_id": doc["_id"], f: value}, {"$unset": {f: ""}})
                if res.modified_count:
                    await audit.log(
                        actor_id=None,
                        action=ACTION,
                        entity_type=entity,
                        entity_id=doc["_id"],
                        previous_value={f: value},
                        new_value={f: None, "reason": "not a PlayR upload"},
                    )
    return report
