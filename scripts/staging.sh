#!/usr/bin/env bash
# Isolated staging backend for Android beta and automated tests. Separate from the demo and from production:
#   own database (oneshort_staging), own uploads folder, own JWT secret (generated once into .data/staging.env,
#   which git ignores), APP_ENV=staging (startup refuses weak secrets and debug), no codes in API replies.
#   Only brand-new numbers in the fictional +44 7700 900xxx range see their code on screen (tester mode);
#   real numbers get real SMS once OTP_PROVIDER is set in .data/staging.env (paid: needs owner approval).
#
#   ./scripts/staging.sh start     start the API on 127.0.0.1:8001 (MongoDB must be running, see public-demo.sh)
#   ./scripts/staging.sh seed      wipe and reseed the STAGING database with the synthetic demo data
#   ./scripts/staging.sh tunnel    expose it over HTTPS (temporary Cloudflare address; printed)
#   ./scripts/staging.sh stop      stop the staging API and its tunnel
#   ./scripts/staging.sh status
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; D="$ROOT/.data"; ENVF="$D/staging.env"; PORT=8001
mkdir -p "$D/staging-uploads"
if [ ! -f "$ENVF" ]; then
  umask 077
  cat > "$ENVF" <<CFG
APP_ENV=staging
MONGODB_DB=oneshort_staging
LOCAL_UPLOAD_DIR=$D/staging-uploads
JWT_SECRET=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))')
OTP_PROVIDER=console
DEV_OTP_IN_RESPONSE=false
TESTER_SIGNUP_PREFIX=+447700900
WHATSAPP_PROVIDER=simulator
EMAIL_OTP_ENABLED=false
INVITE_REGISTER_ENABLED=false
DEBUG=false
CFG
  echo "created $ENVF (staging secrets; never commit or copy it to production)"
fi
# Runs from its own folder so backend/.env (the demo's settings and secrets) is never read: staging uses only
# .data/staging.env plus code defaults.
RUN="$D/staging-run"; mkdir -p "$RUN"; cp "$ENVF" "$RUN/.env"
UV=(uv run --project "$ROOT/backend")
case "${1:-status}" in
  start)
    pkill -f "uvicorn app.main:create_app.*--port $PORT" || true
    (cd "$RUN" && nohup "${UV[@]}" uvicorn app.main:create_app --factory --app-dir "$ROOT/backend" \
      --host 127.0.0.1 --port $PORT --no-access-log --proxy-headers --forwarded-allow-ips 127.0.0.1) </dev/null >> "$D/staging-api.log" 2>&1 &
    for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/health/ready" >/dev/null && { echo "staging API ready on :$PORT"; exit 0; }; sleep 1; done
    echo "staging API did not start; see $D/staging-api.log"; exit 1 ;;
  seed)
    (cd "$RUN" && PYTHONPATH="$ROOT/backend" "${UV[@]}" python -m scripts.seed_data --reset) ;;
  tunnel)
    pkill -f "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PORT" || true
    nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$PORT" </dev/null > "$D/tunnel-staging.log" 2>&1 &
    for _ in $(seq 1 60); do u=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$D/tunnel-staging.log" | head -1 || true)
      [ -n "$u" ] && { echo "$u" > "$D/tunnel-staging.url"; echo "Staging server for the app: $u/api/v1"; exit 0; }; sleep 1; done
    echo "tunnel failed; see $D/tunnel-staging.log"; exit 1 ;;
  stop)
    pkill -f "uvicorn app.main:create_app.*--port $PORT" || true
    pkill -f "cloudflared tunnel --no-autoupdate --url http://127.0.0.1:$PORT" || true; echo stopped ;;
  status)
    curl -sf "http://127.0.0.1:$PORT/api/v1/auth/options" && echo || echo "staging API not running"
    [ -f "$D/tunnel-staging.url" ] && echo "tunnel: $(cat "$D/tunnel-staging.url")/api/v1" || true ;;
  *) echo "usage: $0 start|seed|tunnel|stop|status"; exit 2 ;;
esac
