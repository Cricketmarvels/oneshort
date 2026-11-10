#!/usr/bin/env bash
# Isolated stack for the Playwright critical-path tests (never touches the demo database):
#   API  http://127.0.0.1:8002  (MongoDB database "cricket_e2e", reseeded, dev OTP shown on screen)
#   Web  http://127.0.0.1:4174  (PlayR app web export)
#   ./scripts/e2e-stack.sh start | stop
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; D="$ROOT/.data/e2e"; mkdir -p "$D"
export MONGODB_DB=cricket_e2e APP_ENV=development DEV_OTP_IN_RESPONSE=true SCHEDULER_ENABLED=false WHATSAPP_PROVIDER=simulator \
  RATE_LIMIT_AUTH_PER_MINUTE=10000 RATE_LIMIT_DEFAULT_PER_MINUTE=100000 APP_BASE_URL=http://127.0.0.1:4174 SENTRY_DSN= TESTER_SIGNUP_PREFIX= PLAYR_BETA_SPORT=cricket
stop() { pkill -f "port 8002" || true; pkill -f "PORT=4174" || true; lsof -ti tcp:4174 | xargs kill 2>/dev/null || true; }
wait_for() { for _ in $(seq 1 90); do curl -s -o /dev/null "$1" && return 0; sleep 1; done; echo "timed out: $1"; exit 1; }
case "${1:-start}" in
  stop) stop ;;
  start)
    stop
    (cd "$ROOT/backend" && uv run python -m scripts.seed_data --reset >"$D/seed.log" 2>&1)
    # Known password for the seeded test accounts (throwaway database only), so tests log in by email.
    (cd "$ROOT/backend" && uv run python - <<'PY'
import asyncio
from app.core.config import get_settings
from app.core.security import hash_secret
from app.infrastructure.database.mongo import Mongo
from scripts.demo_numbers import demo_mobile
async def main() -> None:
    s = get_settings(); assert s.mongodb_db == "cricket_e2e", s.mongodb_db
    m = Mongo(s.mongodb_uri, s.mongodb_db)
    for slot in (1, 2, 3, 4):
        await m["users"].update_one({"mobile_number": demo_mobile(slot)}, {"$set": {"password_hash": hash_secret("E2ePlayr2026")}})
    await m["otp_codes"].delete_many({})  # the seed's sign-up codes would trip the resend cooldown
    await m.close()
asyncio.run(main())
PY
    )
    (cd "$ROOT/backend" && exec nohup uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8002 --no-access-log) </dev/null >"$D/api.log" 2>&1 &
    wait_for http://127.0.0.1:8002/health/ready
    (cd "$ROOT/mobile" && EXPO_PUBLIC_API_URL=/api/v1 EXPO_PUBLIC_USE_DEFAULT_LOCATION=true npx expo export --platform web --output-dir "$D/web" >/dev/null)
    (PORT=4174 API_PORT=8002 WEB_ROOT="$D/web" PUBLIC_URL=http://127.0.0.1:4174 exec nohup node "$ROOT/scripts/serve-web.mjs") </dev/null >"$D/web.log" 2>&1 &
    wait_for http://127.0.0.1:4174/
    echo "E2E stack ready: web http://127.0.0.1:4174  api http://127.0.0.1:8002"
    ;;
esac
