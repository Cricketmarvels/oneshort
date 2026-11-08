#!/usr/bin/env bash
# Starts MongoDB (replica set on :27018), the API (:8000) and the web app (:5173) for local development.
#   ./dev.sh          local only (http://localhost:5173)
#   ./dev.sh --phone  also reachable from phones on the same Wi-Fi, plus the Expo dev server for Expo Go
#                     (MongoDB stays bound to 127.0.0.1 either way)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
PHONE=0; [ "${1:-}" = "--phone" ] && PHONE=1
HOST=127.0.0.1; LAN_IP=""
if [ "$PHONE" = 1 ]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  [ -n "$LAN_IP" ] || { echo "No Wi-Fi/LAN IP found"; exit 1; }
  HOST=0.0.0.0
fi
mkdir -p "$ROOT/.data/mongo"

if ! pgrep -f "port 27018" >/dev/null; then
  mongod --replSet rs0 --port 27018 --bind_ip 127.0.0.1 --dbpath "$ROOT/.data/mongo" --logpath "$ROOT/.data/mongod.log" &
  sleep 3
  (cd "$ROOT/backend" && uv run python - <<'PY'
from pymongo import MongoClient
from pymongo.errors import OperationFailure
c = MongoClient("mongodb://127.0.0.1:27018/?directConnection=true")
try:
    c.admin.command("replSetInitiate", {"_id": "rs0", "members": [{"_id": 0, "host": "127.0.0.1:27018"}]})
    print("replica set initiated")
except OperationFailure:
    pass  # already initiated
PY
  )
fi

[ -f "$ROOT/backend/.env" ] || cp "$ROOT/backend/.env.example" "$ROOT/backend/.env"
(cd "$ROOT/backend" && uv sync -q && uv run uvicorn app.main:create_app --factory --reload --host "$HOST" --port 8000 --no-access-log) &
(cd "$ROOT/frontend" && npm install --silent && npx vite --host "$HOST" --port 5173 --strictPort) &
echo "API http://localhost:8000/docs · Web http://localhost:5173 · Seed: (cd backend && uv run python -m scripts.seed_data --reset)"
if [ "$PHONE" = 1 ]; then
  (cd "$ROOT/mobile" && EXPO_PUBLIC_API_URL="http://$LAN_IP:8000/api/v1" npx expo start --lan --port 8081) &
  echo "On your phone (same Wi-Fi):  web  http://$LAN_IP:5173   ·   Expo Go  exp://$LAN_IP:8081"
fi
wait
