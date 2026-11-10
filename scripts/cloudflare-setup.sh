#!/usr/bin/env bash
# One-time: give the public demo FIXED addresses on your own domain with a Cloudflare named tunnel (free).
#
#   1. cloudflared tunnel login          # opens a browser; pick the domain you have on Cloudflare
#   2. scripts/cloudflare-setup.sh yourdomain.com
#   3. ./public-demo.sh                  # now serves https://yourdomain and exps://expo.yourdomain
#
# Creates tunnel "gofindr", DNS records <domain> + www.<domain> (website + API) and expo.<domain> (Expo Go bundle),
# and writes ~/.cloudflared/gofindr.yml plus .data/named-tunnel.env, which public-demo.sh picks up.
# Re-running is safe. Undo: `cloudflared tunnel delete gofindr` and remove the two DNS records.
set -euo pipefail
DOMAIN="${1:?usage: scripts/cloudflare-setup.sh yourdomain.com}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CF="$HOME/.cloudflared"
[ -f "$CF/cert.pem" ] || { echo "Run 'cloudflared tunnel login' first (it opens your browser)."; exit 1; }
NAME=gofindr; WEB_HOST="$DOMAIN"; WWW_HOST="www.$DOMAIN"; EXPO_HOST="expo.$DOMAIN"

if ! cloudflared tunnel info "$NAME" >/dev/null 2>&1; then cloudflared tunnel create "$NAME"; fi
TID=$(cloudflared tunnel info "$NAME" 2>/dev/null | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
[ -n "$TID" ] || { echo "Couldn't find the tunnel id"; exit 1; }
cloudflared tunnel route dns --overwrite-dns "$NAME" "$WEB_HOST"
cloudflared tunnel route dns --overwrite-dns "$NAME" "$WWW_HOST"
cloudflared tunnel route dns --overwrite-dns "$NAME" "$EXPO_HOST"

cat > "$CF/gofindr.yml" <<YML
tunnel: $TID
credentials-file: $CF/$TID.json
ingress:
  - hostname: $WEB_HOST
    service: http://127.0.0.1:4173
  - hostname: $WWW_HOST
    service: http://127.0.0.1:4173
  - hostname: $EXPO_HOST
    service: http://127.0.0.1:8081
  - service: http_status:404
YML
mkdir -p "$ROOT/.data"
printf 'TUNNEL_NAME=%s\nWEB_HOST=%s\nEXPO_HOST=%s\n' "$NAME" "$WEB_HOST" "$EXPO_HOST" > "$ROOT/.data/named-tunnel.env"
echo "Done. Run ./public-demo.sh — website https://$WEB_HOST · Expo Go exps://$EXPO_HOST"
