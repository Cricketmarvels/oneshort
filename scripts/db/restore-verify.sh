#!/usr/bin/env bash
# Prove a backup is usable: checksum, restore into a throwaway database, compare counts with the manifest, drop it.
# Never touches the live database.  Usage: scripts/db/restore-verify.sh [archive]   (default: newest)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
URI="${MONGODB_URI:-mongodb://127.0.0.1:27018/?replicaSet=rs0}"
DB="${MONGODB_DB:-cricket_platform}"
DIR="${BACKUP_DIR:-$ROOT/.data/backups}"
ARCHIVE="${1:-$(ls -t "$DIR"/playr-*.archive.gz | head -1)}"
SCRATCH="playr_restore_check"
[ "$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')" = "$(cat "$ARCHIVE.sha256")" ] || { echo "CHECKSUM MISMATCH: $ARCHIVE"; exit 1; }
START=$(date +%s)
mongorestore --uri="$URI" --gzip --archive="$ARCHIVE" --nsInclude="$DB.*" \
  --nsFrom="$DB.*" --nsTo="$SCRATCH.*" --drop --quiet
SECS=$(( $(date +%s) - START ))
(cd "$ROOT/backend" && uv run python - "$URI" "$SCRATCH" "$ARCHIVE.manifest.json" "$SECS" <<'PY'
import json, sys
from pymongo import MongoClient
uri, scratch, manifest, secs = sys.argv[1:]
m = json.load(open(manifest)); c = MongoClient(uri); d = c[scratch]
bad = {k: (v, d[k].estimated_document_count()) for k, v in m["collections"].items() if d[k].estimated_document_count() < v}
total = sum(m["collections"].values())
c.drop_database(scratch)
if bad:
    print("RESTORE CHECK FAILED (expected, restored):", bad); sys.exit(1)
print(f"Restore OK: {len(m['collections'])} collections, {total} documents, taken {m['taken_at']}, restored in {secs}s")
PY
)
