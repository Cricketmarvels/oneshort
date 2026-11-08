# Security Design

## Authentication
- **OTP:** 6-digit, generated with `secrets`, stored only as an Argon2 hash, 5-minute TTL, at most 5 verification attempts per code, at most 5 sends per mobile per hour (persisted in Mongo so the limit holds across instances), and 30 seconds between resends. Codes are never logged. The dev `console` adapter returns the code in the API response only when `APP_ENV != production`. Configuration validation blocks the console adapter in production.
- **Password (optional):** Argon2id, minimum 8 characters with a letter and a digit. Login failures return a generic error.
- **Access token:** JWT HS256, 15 minutes, with claims `sub`, `roles`, `type=access`, `jti`, `iat`, `exp`, `iss`.
- **Refresh token:** an opaque random value stored as SHA-256, 30 days, **rotated on every use**. Reusing a revoked token revokes the whole token family (theft detection). Logout revokes the family.
- **Account status** is checked on every authenticated request:
  - `suspended`: 403 everywhere except reading your own profile and appealing.
  - `restricted`: matchmaking endpoints are blocked.
  - `deleted`: 401.

## Authorization
- Global RBAC roles: `player`, `captain`, `admin`.
- Resource-level guards in services:
  - `TeamPolicy.can_manage(team, user)`: captain or admin_ids.
  - `MatchPolicy.can_manage(match, user)`: match captain or team admin.
  - Payment marking: `MatchPolicy.can_manage`. A player can only raise a dispute on their own record.
  - Ratings: verified roster participation.
- The agreement gate (`require_agreement`) protects discovery, invitations, matches, teams (writes), settlements, and ratings.
- IDs in paths are always resolved together with an ownership or participation check. This prevents IDOR: unauthorised access returns 404 where existence would leak information, otherwise 403.

## Input safety
- Every request body is a Pydantic v2 model (`extra="forbid"`), and strings are bounded (`max_length`).
- **NoSQL injection:** queries are built from typed values only. A middleware also rejects any JSON body containing keys that start with `$` or contain `.`. ObjectIds are parsed strictly (422 on failure).
- Uploads: content-type allow-list (jpeg/png/webp), magic-byte check, 5 MB cap, randomised filenames.
- Free text (bio, messages, comments) is stored as plain text and the frontend renders it escaped (React default). No HTML is accepted.

## Transport & headers
- CORS is an explicit origin allow-list from `CORS_ORIGINS`.
- Headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: geolocation=(self)`, `Strict-Transport-Security` (production), and a restrictive CSP on API responses.
- Rate limiting: a sliding window per IP and route group (auth: 10/min, default: 120/min). The in-memory store sits behind an interface and can swap to Redis for multiple instances.

## Location privacy
- Device location is requested only after an explanation screen, through the browser or Expo permission APIs.
- `home_location` and availability locations are **never** included in another user's response. The DTOs for others have no coordinate fields at all.
- Distances are returned rounded to 0.5 km (`approx_distance_km`), with a minimum of 0.5.
- The match venue address and coordinates are visible only to the captain, team admins, invitees, and roster members. Everyone else sees `area` and `city`.
- The logging redaction processor strips `location`, `coordinates`, `otp`, `code`, `password`, `token`, and `authorization`.
- Availability visibility can be `private` (excluded from discovery).

## Payments (MVP = manual tracking)
- No gateway, no bank details, no UPI PIN, no card data. Payment instructions are free text the captain writes, for example "UPI to captain@okaxis".
- Records carry `verification: "manual_captain_confirmed"`, and the UI says "Marked paid by captain", never "verified".
- Every status change is written to the record's `status_history` and to `audit_logs`, inside the same transaction.

## Privacy controls
- `GET /users/me/export` returns a JSON export of the user's data.
- `DELETE /users/me` anonymises PII:
  - name becomes "Deleted player", mobile and email are nulled, the image is removed
  - profile locations and availability are deleted
  - pending invitations are cancelled and tokens are revoked
  - financial and audit records are kept, pseudonymised
- Secrets come only from environment variables. `.env` is git-ignored and `.env.example` contains placeholders.

## AI assistant (optional)
- Disabled unless `ANTHROPIC_API_KEY` is set. It only receives the report category, description, and counts. Names, phone numbers, emails, and locations are stripped before sending.
- Output is stored as `ai_triage` marked `advisory: true`. Moderation actions always require a human admin.

## Threat checklist
| Threat | Mitigation |
|---|---|
| OTP brute force | Attempt cap, hashed codes, per-mobile and per-IP rate limits |
| Token theft | Short access TTL, refresh rotation, reuse detection |
| IDOR | Policy checks in services, tested |
| Overbooking race | Transactional guarded increment, tested with concurrent requests |
| Rating manipulation | Verified participation, unique index, moderation |
| Payment status tampering | Policy, audit trail, players cannot mark their own records paid (tested) |
| Location leakage | DTO separation, rounding, log redaction (tested) |

## Security review findings (2026-11-04)
| Finding | Status |
|---|---|
| Uvicorn's default access log recorded the WebSocket `?token=` query string (confirmed in the dev log) | **Fixed:** run with `--no-access-log`. The app's structured log records only paths. Dev log wiped. |
| `--forwarded-allow-ips "*"` would let clients spoof IPs and evade rate limits | **Fixed:** `FORWARDED_ALLOW_IPS` defaults to `127.0.0.1` and must be set to the load balancer |
| Rate limiter caught e2e traffic at 10 auth req/min | Working as designed. Relaxed only in the local dev `.env`. |

## Residual risks (accepted for MVP, revisit before launch)
- **Distance trilateration:** repeated ad-hoc searches from many origins could narrow a player's *availability area* to about 0.5 km. Mitigations: 5 km minimum radius, 0.5 km rounding, rate limiting, private visibility option, and slot locations that can differ from home. Consider snapping stored availability points to a ~300 m grid.
- **Web refresh token in `localStorage`:** exposed to XSS. Mitigations: React escaping, strict CSP (nginx), rotation and reuse detection. Planned: an HttpOnly, SameSite=Strict refresh cookie.
- **WebSocket token in the query string:** short-lived access token, logs exclude query strings. Alternative: a first-message auth frame.
- **In-memory rate limiter and realtime hub:** per instance. Use Redis before scaling out.
| Uvicorn's *error* logger still wrote the full WebSocket URL (`?token=…`) when it rejected a handshake. `--no-access-log` does not cover this, and 43 lines were confirmed in the dev log on 2026-11-04. | **Fixed:** `QuerySecretFilter` (core/logging.py) masks `token`/`otp`/`code` query values on uvicorn and root loggers. Tested in a unit test and against the live server. Dev log wiped. |
| CricHeroes imports could carry arbitrary links | **Mitigated:** only https CricHeroes hosts are kept, sizes are capped, and the NoSQL guard applies. Data is labelled "provided by the team; not verified". |
| The local dev `.env` used the `JWT_SECRET` published in source (`change-me-dev-only…`). Anyone could have forged admin tokens once the server was reachable. | **Fixed** before public exposure: rotated to a 64-character random secret. `public-demo.sh` refuses to run with the default. Production config validation already rejected it. |
