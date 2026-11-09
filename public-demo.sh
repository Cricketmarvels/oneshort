#!/usr/bin/env bash
# Public demo: exposes the app over HTTPS via Cloudflare quick tunnels so it works on any network.
#   ./public-demo.sh            start (or restart) everything and print the links
#   ./public-demo.sh reload     restart API, web build and Expo with new code, keeping the same links
#   ./public-demo.sh stop       stop the tunnels, web preview and Expo (API/Mongo keep running)
# Requires backend/.env with DEV_OTP_IN_RESPONSE=false and a strong JWT_SECRET (refuses otherwise).
# Login is email + password: run `cd backend && uv run python -m scripts.set_demo_passwords` for demo accounts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"; D="$ROOT/.data"; mkdir -p "$D/mongo"
wait_for() { for _ in $(seq 1 60); do curl -s -o /dev/null "$1" && return 0; sleep 1; done; echo "timed out: $1"; return 1; }
tunnel() { # $1 port, $2 name -> prints URL
  nohup cloudflared tunnel --no-autoupdate --url "http://127.0.0.1:$1" </dev/null > "$D/tunnel-$2.log" 2>&1 &
  for _ in $(seq 1 60); do u=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$D/tunnel-$2.log" | head -1 || true); [ -n "$u" ] && { echo "$u" > "$D/tunnel-$2.url"; echo "$u"; return; }; sleep 1; done
  echo "tunnel $2 failed" >&2; exit 1
}
stop_public() { pkill -f "cloudflared tunnel --no-autoupdate" || true; stop_apps; }
stop_apps() { pkill -f "vite preview" || true; pkill -f "serve-web.mjs" || true; pkill -f "expo start" || true; }
[ "${1:-}" = "stop" ] && { stop_public; echo "stopped"; exit 0; }
RELOAD=0
if [ "${1:-}" = "reload" ]; then
  RELOAD=1
  pgrep -f "cloudflared tunnel --no-autoupdate" >/dev/null && [ -f "$D/tunnel-web.url" ] && [ -f "$D/tunnel-expo.url" ] \
    || { echo "No running tunnels to reuse; run ./public-demo.sh first"; exit 1; }
fi

grep -q '^DEV_OTP_IN_RESPONSE=false' "$ROOT/backend/.env" || { echo "Set DEV_OTP_IN_RESPONSE=false in backend/.env first"; exit 1; }
grep -q '^JWT_SECRET=change-me' "$ROOT/backend/.env" && { echo "Replace the default JWT_SECRET in backend/.env first"; exit 1; }
command -v cloudflared >/dev/null || { echo "brew install cloudflared"; exit 1; }
if [ "$RELOAD" = 1 ]; then stop_apps; else stop_public; fi

if ! pgrep -f "port 27018" >/dev/null; then
  mongod --replSet rs0 --port 27018 --bind_ip 127.0.0.1 --dbpath "$D/mongo" --logpath "$D/mongod.log" </dev/null >/dev/null 2>&1 &
  sleep 3
fi
# Tunnels first: the API needs the public web address for links it puts in messages (invite/join links).
if [ "$RELOAD" = 1 ]; then WEB=$(cat "$D/tunnel-web.url"); EXPO=$(cat "$D/tunnel-expo.url"); else WEB=$(tunnel 4173 web); EXPO=$(tunnel 8081 expo); fi
pkill -f "uvicorn app.main:create_app" || true; sleep 1
(cd "$ROOT/backend" && APP_BASE_URL="$WEB" exec nohup uv run uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000 --no-access-log \
  --proxy-headers --forwarded-allow-ips 127.0.0.1) </dev/null >> "$D/api.log" 2>&1 &
wait_for http://127.0.0.1:8000/health/ready

# Website = the PlayR app itself (Expo web export); the previous React web app stays at /classic
(cd "$ROOT/mobile" && EXPO_PUBLIC_API_URL=/api/v1 EXPO_PUBLIC_DEFAULT_LOGIN=email EXPO_PUBLIC_USE_DEFAULT_LOCATION=true \
  npx expo export --platform web --output-dir "$D/web-app" >/dev/null)
(cd "$ROOT/frontend" && npx vite build --mode tunnel --base /classic/ --outDir "$D/web-classic" --emptyOutDir >/dev/null)
(PUBLIC_URL="$WEB" exec nohup node "$ROOT/scripts/serve-web.mjs") </dev/null >> "$D/web.log" 2>&1 &
wait_for http://127.0.0.1:4173/
(cd "$ROOT/mobile" && EXPO_PUBLIC_API_URL="$WEB/api/v1" EXPO_PUBLIC_DEFAULT_LOGIN=email EXPO_PACKAGER_PROXY_URL="$EXPO" CI=1 \
  exec nohup npx expo start --port 8081 --clear) </dev/null > "$D/expo.log" 2>&1 &
wait_for http://127.0.0.1:8081/status
wait_for "$WEB/"

cat <<MSG

  Website (any network):   $WEB      (previous web app: $WEB/classic/)
  iPhone app (Expo Go):    exps://${EXPO#https://}
  Demo logins:             $D/demo-logins.txt
  Links change every time this script runs without "reload". Keep the Mac awake (e.g. \`caffeinate -dis\`).
MSG
