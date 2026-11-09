#!/usr/bin/env bash
# Point-in-time-consistent backup of the PlayR database (self-hosted / pilot setup).
# Production uses MongoDB Atlas continuous backup instead: see docs/design/DATABASE_RELIABILITY.md.
#
#   scripts/db/backup.sh              # one backup now
# Env: MONGODB_URI (default local rs0), BACKUP_DIR (default .data/backups),
#      BACKUP_RCLONE_REMOTE (optional, e.g. "r2:playr-backups"): copies each backup off this machine.
# Output: playr-<UTC time>.archive.gz (+ .sha256, + .manifest.json with per-collection counts)
# Retention: every backup for 48 h, then one per day for 35 days.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URI="${MONGODB_URI:-mongodb://127.0.0.1:27018/?replicaSet=rs0}"
DB="${MONGODB_DB:-cricket_platform}"
DIR="${BACKUP_DIR:-$ROOT/.data/backups}"
mkdir -p "$DIR"; chmod 700 "$DIR"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$DIR/playr-$TS.archive.gz"
LOG="$DIR/backup.log"

# --oplog captures writes made during the dump, so the restore is consistent to a single moment.
# (--oplog needs a whole-deployment dump; restores select only the PlayR database with --nsInclude.)
mongodump --uri="$URI" --oplog --gzip --archive="$OUT.partial" --quiet
mv "$OUT.partial" "$OUT"
shasum -a 256 "$OUT" | awk '{print $1}' > "$OUT.sha256"

# Manifest: document counts at backup time, used by restore-verify.sh
(cd "$ROOT/backend" && uv run python - "$URI" "$DB" "$OUT.manifest.json" <<'PY'
import json, sys
from datetime import UTC, datetime
from pymongo import MongoClient
uri, db, out = sys.argv[1:]
d = MongoClient(uri)[db]
counts = {c: d[c].estimated_document_count() for c in sorted(d.list_collection_names()) if not c.startswith("system.")}
json.dump({"database": db, "taken_at": datetime.now(UTC).isoformat(), "collections": counts}, open(out, "w"), indent=1)
PY
)
chmod 600 "$OUT" "$OUT.sha256" "$OUT.manifest.json"

# Off-machine copy (strongly recommended): a backup on the same disk does not survive losing the disk.
if [ -n "${BACKUP_RCLONE_REMOTE:-}" ] && command -v rclone >/dev/null; then
  rclone copy "$DIR" "$BACKUP_RCLONE_REMOTE" --include "playr-$TS.*" --quiet
fi

# Retention: keep everything from the last 48 h; older than that keep the first backup of each day, up to 35 days.
(cd "$ROOT/backend" && uv run python - "$DIR") <<'PY'
import re, sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
d = Path(sys.argv[1]); now = datetime.now(UTC); kept_days = set()
for f in sorted(d.glob("playr-*.archive.gz")):
    ts = datetime.strptime(re.search(r"playr-(\d{8}T\d{6}Z)", f.name).group(1), "%Y%m%dT%H%M%SZ").replace(tzinfo=UTC)
    age, day = now - ts, ts.date()
    keep = age < timedelta(hours=48) or (age < timedelta(days=35) and day not in kept_days)
    if age >= timedelta(hours=48) and keep: kept_days.add(day)
    if not keep:
        for p in d.glob(f.name + "*"): p.unlink()
PY
echo "$(date -u +%FT%TZ) ok $(basename "$OUT") $(du -h "$OUT" | cut -f1)" >> "$LOG"
echo "$OUT"
