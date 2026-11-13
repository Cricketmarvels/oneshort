# Deployment Guide

Hosting is undecided (AWS was explicitly deferred), so this guide is provider-neutral. Every component is a standard container or a static bundle.

## 1. Local development

**Prerequisites:** Node 24+, [uv](https://docs.astral.sh/uv/) (installs Python 3.13), and MongoDB 8 running as a **replica set** (transactions require it).

```bash
# MongoDB: isolated single-node replica set on :27018 (data stays inside the repo, git-ignored)
mkdir -p platform/.data/mongo
mongod --replSet rs0 --port 27018 --bind_ip 127.0.0.1 --dbpath platform/.data/mongo --logpath platform/.data/mongod.log &
# first time only:
cd platform/backend && uv run python -c "from pymongo import MongoClient as M; M('mongodb://127.0.0.1:27018/?directConnection=true').admin.command('replSetInitiate', {'_id':'rs0','members':[{'_id':0,'host':'127.0.0.1:27018'}]})"

# API
cd platform/backend
cp .env.example .env            # dev defaults; OTP_PROVIDER=console returns codes in API responses
uv sync
uv run python -m scripts.seed_data --reset     # realistic Noida data
uv run uvicorn app.main:create_app --factory --reload --port 8000 --no-access-log

# Web (proxies /api and /uploads to :8000)
cd platform/frontend && npm install && npm run dev      # http://localhost:5173

# Mobile
cd platform/mobile && npm install
EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:8000/api/v1 npx expo start   # Android emulator: http://10.0.2.2:8000/api/v1
```
`platform/dev.sh` starts Mongo, the API and the web app together.

**Demo logins** (the OTP is shown on screen in dev): captain `+447700900001`, player `+447700900002`, admin `+447700900099` (fictional range; type the full number).

**Tests:** `cd backend && uv run pytest` · `cd frontend && npm test && npm run test:e2e` · `cd mobile && npx jest`.

**Docker alternative:** `docker compose up --build` runs Mongo (replica set), the API on `:8000` and the web app (nginx) on `:8080`.

## 2. Environments
| Env | `APP_ENV` | OTP | Notes |
|---|---|---|---|
| development | development | console | `.env` from `.env.example`; relaxed limits allowed |
| test | test | console | pytest uses DB `cricket_test` |
| staging | staging | msg91/twilio | Production-like, separate Atlas cluster and secrets |
| production | production | msg91/twilio | The app **refuses to start** with a default `JWT_SECRET`, `OTP_PROVIDER=console` or `DEBUG=true` |

All configuration comes from environment variables (see `backend/.env.example`). Keep secrets in the host's secret manager, never in git.

## 3. Production topology
```
CDN / static hosting ── web (Vite build, or the nginx image)
        │  /api, /api/v1/ws
Load balancer (TLS) ── API containers (uvicorn, stateless) ── MongoDB Atlas (replica set, M10+)
                                    │
                    SMS (MSG91/Twilio) · FCM · Cloudinary/S3 · (optional) Anthropic API
```
- **API container:** `backend/Dockerfile` runs as non-root with a healthcheck. Set `FORWARDED_ALLOW_IPS` to the load balancer's address or CIDR so client IPs (used for rate limiting) can't be spoofed. Keep `--no-access-log`: the app writes its own structured logs, which are redacted and record only paths.
- **Instances:** 2+ for availability. Before scaling past one instance, either set `SCHEDULER_ENABLED=true` on exactly one instance, or swap in the Redis rate limiter and realtime hub (interfaces are in `core/middleware.py` and `infrastructure/realtime/hub.py`). WebSockets need sticky sessions, or Redis pub/sub once added.
- **Web:** the `frontend/Dockerfile` (nginx with SPA fallback, security headers and an API proxy), or any static host with `/api` proxied. Build with `VITE_API_URL` when the API is on another origin, and add that origin to `CORS_ORIGINS`.
- **Mobile (iOS + Android):** builds run in the cloud on EAS, so no Xcode or Android Studio is needed locally. Use `mobile/eas.json` profiles:
  - `simulator`: iOS simulator `.app` and Android `.apk`
  - `preview`: an internal `.apk`, plus an ad-hoc iOS build for registered devices
  - `production`: Play Store `.aab` and App Store build
  Run `npx eas-cli@latest build -p all --profile preview`. Set the API URL per environment with `eas env:create --name EXPO_PUBLIC_API_URL --value https://<api-host>/api/v1 --environment preview`. Release builds need HTTPS, since iOS ATS blocks plain http. Bundle id and package: `com.cricketmarvels.play`. An Apple Developer account is required for iOS device or App Store builds. Push needs FCM and APNs credentials.
  For quick testing on a phone, install **Expo Go**, run `EXPO_PUBLIC_API_URL=http://<LAN-IP>:8000/api/v1 npx expo start` in `mobile/`, and scan the QR code. Start the API with `--host 0.0.0.0`.

## 4. MongoDB Atlas
- Create a replica-set cluster (M10+ for production backups). Restrict network access to the API's egress IPs and create a least-privilege `readWrite` user for the `cricket_platform` DB.
- Indexes and JSON-schema validators are created idempotently on API startup (`infrastructure/database/indexes.py`).
- **Backups:** enable continuous cloud backup with point-in-time recovery (7-day window), plus daily snapshots retained 30 days and monthly snapshots retained 12 months. Test a restore into staging each quarter.
- **Data retention:** TTL indexes purge OTPs, refresh tokens and notifications older than 180 days. The scheduler purges availability older than 180 days. Audit and payment records are retained (pseudonymised on account deletion).

## 5. Integrations checklist
| Integration | Env | Done when |
|---|---|---|
| SMS OTP | `OTP_PROVIDER=msg91` + `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID` (DLT-approved template in India) | An OTP is received on a real handset in staging |
| Email codes (sign-up, password reset), deferred: needs `EMAIL_OTP_ENABLED=true` first, see `docs/AUTHENTICATION.md` | `EMAIL_PROVIDER=smtp`, `SMTP_HOST`, `SMTP_PORT` (587 STARTTLS or 465 TLS), `SMTP_USERNAME`, `SMTP_PASSWORD`, `EMAIL_FROM`. Free, no domain needed: Gmail with an app password (`smtp.gmail.com`, about 500 a day) or Brevo free (`smtp-relay.brevo.com`, 300 a day). `console` (default) sends nothing and is refused in beta/production; `none` turns email codes off and the app falls back to SMS sign-up. | A sign-up code arrives in a real inbox |
| Push | `PUSH_PROVIDER=fcm`, `FCM_PROJECT_ID`, `FCM_SERVICE_ACCOUNT_JSON`. Finish `FcmPushProvider.send` (OAuth via `google-auth`). | A notification arrives on Android and iOS |
| Images | `STORAGE_PROVIDER=cloudinary`, `CLOUDINARY_URL`. Implement the signed upload in `CloudinaryStorage`. | An upload succeeds and the URL is served over HTTPS |
| Ground search | `PLACES_PROVIDER=osm` (free, no key), `ola` + `PLACES_API_KEY` (Ola Maps: free key, no card, 100k events/month) or `google` + `PLACES_API_KEY` (best coverage, needs a Google Cloud project with billing). `PLACES_COUNTRY=in` filters suggestions; `none` searches only grounds OneShort already knows. See `docs/GROUND_SEARCH_SETUP.md`. | Searching a ground that isn't seeded (e.g. a local turf arena) finds it, and picking it creates the venue once |
| Maps | Web: `VITE_MAP_TILE_URL` / `VITE_MAP_ATTRIBUTION` (e.g. Mapbox). Respect OSM tile usage policy in production. | Tiles load under production traffic terms |
| AI triage (optional) | `ANTHROPIC_API_KEY`, `AI_MODEL=claude-opus-5-5` | Admin sees an advisory triage on new reports |

## 6. Monitoring
- **Health:** `/health/live` (liveness), `/health/ready` (Mongo readiness, 503 when down). Wire both to the orchestrator.
- **Logs:** JSON on stdout with `request_id`, `method`, `path`, `status`, `duration_ms`. Ship them to the provider's log service. Alert on 5xx rate > 1% and p95 > 1 s.
- **Errors:** add Sentry (or similar) at the `unhandled` exception handler in `app/main.py`. Scrub PII the same way `redact_processor` does.
- **Database:** Atlas alerts on replication lag, connections > 80%, slow queries > 200 ms (review `$geoNear` plans), and disk > 75%.

## 7. CI/CD
`.github/workflows/ci.yml` runs:
- backend: ruff, format check, mypy and pytest against a Mongo 8 replica set service
- contracts: fails if `shared/openapi.json` or the TS types are stale
- web: typecheck, Vitest, build
- mobile: typecheck, jest, expo-doctor

Recommended CD: on merge to `main`, build and push images tagged with the git SHA, deploy to staging, run Playwright against staging, then promote to production manually.

## 8. Release checklist
- [ ] Strong `JWT_SECRET` (≥ 32 random bytes), production SMS provider, `DEBUG=false`
- [ ] `CORS_ORIGINS` set to the production web origin only; HTTPS everywhere (HSTS is sent automatically in production)
- [ ] `FORWARDED_ALLOW_IPS` set to the load balancer only
- [ ] Agreement text reviewed by legal counsel and published as a new version if changed
- [ ] Atlas backups verified with a test restore
- [ ] Rate limits reviewed (auth 10/min/IP default)
- [ ] Seed script **not** run against production (it refuses to unless `OTP_PROVIDER=console` and env ≠ production)

## 9. Public demo from a Mac (Cloudflare quick tunnels)
`./public-demo.sh` serves the production web build and the Expo dev server over HTTPS through two `trycloudflare.com` tunnels, so the app works on any network. `./public-demo.sh stop` stops it.
- **Safety preconditions** (the script refuses to start without them): `DEV_OTP_IN_RESPONSE=false` (OTP codes are never shown) and a non-default `JWT_SECRET`. The API binds to 127.0.0.1 and trusts `X-Forwarded-For` only from the local proxy, so per-visitor rate limits keep working behind the tunnel.
- **Login:** email + password. `uv run python -m scripts.set_demo_passwords` (in `backend/`) sets random passwords for the demo accounts and writes them to `.data/demo-logins.txt` (mode 600).
- **Limits:**
  - New sign-ups and OTP login don't work until an SMS provider is configured.
  - Links change on every run.
  - Quick tunnels have no uptime guarantee and are meant for testing.
  - The Mac must stay awake.
- **Back to local development and e2e:** set `DEV_OTP_IN_RESPONSE=true` (and the relaxed `RATE_LIMIT_AUTH_PER_MINUTE` / `OTP_RESEND_COOLDOWN_SECONDS` values) in `backend/.env`, then run `./dev.sh`. Playwright's OTP journeys need on-screen codes.
