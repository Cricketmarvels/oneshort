#!/usr/bin/env bash
# Build the web app into a temporary folder and swap it in atomically, so the running web server never sees a
# half-built or empty .data/web-app (which used to answer 502 and crash the server mid-export).
#   scripts/web-export.sh            # defaults: API at /api/v1 (same origin), email login
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; D="$ROOT/.data"; OUT="$D/web-app"; TMP="$D/web-app.next"; OLD="$D/web-app.prev"
rm -rf "$TMP" "$OLD"
(cd "$ROOT/mobile" && EXPO_PUBLIC_API_URL="${EXPO_PUBLIC_API_URL:-/api/v1}" EXPO_PUBLIC_DEFAULT_LOGIN="${EXPO_PUBLIC_DEFAULT_LOGIN:-email}" \
  npx expo export --platform web --output-dir "$TMP" >/dev/null)
[ -f "$TMP/index.html" ] || { echo "export produced no index.html"; exit 1; }
[ -d "$OUT" ] && mv "$OUT" "$OLD"
mv "$TMP" "$OUT"
rm -rf "$OLD"
echo "web app updated: $OUT"
