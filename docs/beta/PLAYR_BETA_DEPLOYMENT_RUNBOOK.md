# OneShort beta — deployment runbook

Status: **not provisioned (paid infrastructure needs approval).** Everything below is ready to execute. Reliability design: `docs/design/DATABASE_RELIABILITY.md`. Date: 2026-11-10.

## Environments

| | Development | Beta | Production |
|---|---|---|---|
| `APP_ENV` | development | **beta** (same guards as production: no console OTP, no on-screen codes, legal identity required, strong JWT) | production |
| Database | local rs0 `cricket_platform` | Atlas M10 Mumbai, db `cricket_beta`, PITR on | Atlas M30, `cricket_platform` |
| API host | this Mac + quick tunnel | 1 container (Fly.io / Render / AWS App Runner, ap-south), 2 instances when load needs it | ≥2 instances, 2 AZs |
| Domain | trycloudflare | `beta-api.gofindr.in`, `beta.gofindr.in` (web) via Cloudflare | `api.gofindr.in` |
| Media | local disk | S3/R2 bucket `playr-beta-media` behind the existing `StorageProvider` (adapter to implement: ~60 lines, signed upload not needed — the API re-encodes everything) | separate bucket |
| OTP | console / tester numbers | Meta WhatsApp (+ MSG91 SMS fallback) | same |
| Push | none | `expo` | `expo` |
| Errors | — | Sentry DSN (scrubbed) | Sentry |
| Rate limits | memory | `RATE_LIMITER_BACKEND=mongo` | mongo / Redis |

The mobile build selects the API by EAS profile (`EXPO_PUBLIC_API_URL`); no secret ever ships in the app.

## Provision (order)

1. **Atlas**: project "OneShort", cluster M10 in `ap-south-1`, 3 nodes, continuous backup 7-day PITR, snapshot copies to Hyderabad, Backup Compliance Policy on, DB user with `readWrite@cricket_beta` only, IP access list = API host egress IPs.
2. **Media bucket**: private, encrypted, lifecycle rule for orphan cleanup; API credentials with put/get/delete on the bucket only.
3. **API host**: container from `backend/` (`uv sync --frozen`, `uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips '*'`), health check `GET /health/ready` (returns `degraded` during an election without failing the LB), 1 vCPU / 1 GB, autoscale 1–2.
4. **Secrets** in the host's secret store (never in the repo): `JWT_SECRET` (≥32 chars), `MONGODB_URI`, `SENTRY_DSN`, WhatsApp tokens, storage keys, `LEGAL_*`. Rotation: change the secret in the store, restart; `JWT_SECRET` rotation signs everyone out (document a maintenance window); WhatsApp system-user tokens are rotated in Meta then updated here.
5. **Web + OG previews**: deploy `scripts/serve-web.mjs` (or any static host + reverse proxy to the API) at `beta.gofindr.in`; set `APP_BASE_URL=https://beta.gofindr.in` so invite links and previews use it.
6. **Cloudflare**: DNS for both hosts, HTTPS (Full strict), WAF managed rules, rate-limit rule 60 req/min on `/api/v1/auth/*` as a second layer.
7. **Backups**: Atlas handles PITR; additionally run `scripts/db/backup.sh` nightly from the API host with `BACKUP_RCLONE_REMOTE` to a second bucket; `restore-verify.sh` weekly. Alerts: backup failure, replication lag > 60 s, no primary, disk > 80 %.
8. **Logs**: ship stdout JSON to the host's log platform with **1-year retention** (DPDP Rules); PII is already redacted at source.

## First deploy checklist

- [ ] `APP_ENV=beta`, `ONESHORT_BETA_SPORT=cricket`, `DEV_OTP_IN_RESPONSE=false`, no `TESTER_SIGNUP_PREFIX` (the app refuses to start otherwise)
- [ ] `LEGAL_ENTITY_NAME/ADDRESS`, `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_EMAIL` set
- [ ] `/health/ready` → `ok`; `/api/v1/auth/options` → `beta_sport: cricket`, `tester_signup_prefix: null`
- [ ] `uv run python -m scripts.seed_data` **not** run — beta holds real records only (venues are seeded separately if needed)
- [ ] Admin account created with a real number; `roles: ["admin"]` set once by hand in Atlas and recorded in the audit log
- [ ] Sentry receives a test event; log platform shows redacted lines

## Rollback

API: redeploy the previous image tag (images are immutable; config lives outside). Database: PITR restore to a new cluster, switch `MONGODB_URI`, redeploy (procedure B in the reliability doc). Mobile: TestFlight lets testers stay on the previous build; expire a bad build in App Store Connect.

## Migrations

Schema changes are additive and index changes run at startup (`ensure_indexes`, idempotent, retired indexes dropped by name). Data migrations are scripts under `backend/scripts/` with a dry-run default and audit-logged writes (`migrate_media_policy.py`, `migrate_demo_numbers.py` are the pattern).

## Retention and deletion

Account deletion anonymises the user and erases their content immediately (tested). Retention schedule: `docs/legal/DPDP_COMPLIANCE.md`. Beta wipe-or-keep decision: see the release plan.
