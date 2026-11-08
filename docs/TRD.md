# Technical Requirements Document (TRD)

## Stack (resolved versions)
| Layer | Technology |
|---|---|
| API | Python 3.13, FastAPI, Pydantic v2, Uvicorn, PyMongo Async, PyJWT, argon2-cffi, HTTPX, structlog |
| DB | MongoDB 8.x as a replica set (required for transactions). Local dev uses a single-node RS. Production uses Atlas. |
| Web | React 19, TypeScript (strict), Vite, React Router 7, Tailwind CSS v4, Radix primitives, TanStack Query 5, Zustand, React Hook Form + Zod, Axios, Lucide, Leaflet |
| Mobile | Expo (React Native), Expo Router, expo-secure-store, expo-location, expo-notifications, expo-image-picker |
| Shared | `@cm/shared` holds generated OpenAPI TS types (`openapi-typescript`) and domain helpers (money, roles, statuses) |
| Tests | pytest + pytest-asyncio + HTTPX ASGI client against a real Mongo RS, Vitest + RTL, Playwright |
| Quality | ruff (lint + format), mypy strict, tsc strict, eslint |

## Non-functional targets
| Concern | Target / approach |
|---|---|
| Discovery latency | p95 < 300 ms for 10k players per city (2dsphere + compound filter, candidate cap 500) |
| Payload | Paginated lists (default 20, max 100). Projections exclude internal fields. |
| Availability | Health `/health/live`, `/health/ready` (pings Mongo) |
| Observability | JSON logs with `request_id`, request duration metric in logs, `X-Request-ID` echoed. Sentry DSN hook (`SENTRY_DSN`) is an integration point. |
| Reliability | Idempotent creates (unique indexes plus an `Idempotency-Key` header on invitation and settlement creation), transaction retry on TransientTransactionError |
| Accessibility | WCAG 2.1 AA contrast, keyboard navigation, aria labels, 44px touch targets |
| i18n readiness | All times are UTC in the API. Formatting happens client-side with `Intl` in the user's timezone. Currency formatting goes through one helper. |

## API conventions
- Base path `/api/v1`. JSON only. `snake_case` fields.
- Success: `{"data": <payload>, "meta": {...}?}`.
- Error: `{"error": {"code": "SQUAD_FULL", "message": "...", "details": [...]}, "request_id": "..."}`.
- Pagination: `?page=1&page_size=20`, with `meta = {page, page_size, total, has_next}`.
- Datetimes are ISO-8601 with an offset, stored in UTC.
- IDs are 24-hex ObjectId strings. Matches also have `match_code`.

## Configuration
Everything comes from environment variables (`pydantic-settings`). See `backend/.env.example`. Environments: `development`, `test`, `staging`, `production`. Validation fails fast in production when a secret is the default or a dev adapter is selected.

## Integration matrix
| Integration | Interface | Dev adapter | Production adapter | Status |
|---|---|---|---|---|
| SMS OTP | `OtpSender` | `ConsoleOtpSender` | `Msg91OtpSender` / `TwilioOtpSender` (HTTPX) | Unconfigured: needs credentials |
| Email | `EmailSender` | `ConsoleEmailSender` | SMTP / SES | Unconfigured |
| Push | `PushProvider` | `NullPushProvider` | `FcmPushProvider` (HTTP v1) | Unconfigured: needs a service account |
| Image storage | `StorageProvider` | `LocalStorage` (`/uploads`) | `CloudinaryStorage` | Local works, Cloudinary unconfigured |
| Geocoding | `GeocodingProvider` | Seeded venues | Mapbox / Google | Unconfigured |
| Maps (tiles) | frontend env | OSM tiles | Mapbox token | OSM works |
| WhatsApp | client deep link `https://wa.me/?text=` | n/a | n/a | Works (no delivery claim) |
| AI triage | `AIAssistant` | `NullAssistant` | `ClaudeAssistant` (Anthropic API) | Unconfigured: needs `ANTHROPIC_API_KEY` |
| Payments | `PaymentProvider` (interface only) | `ManualPaymentProvider` | Future (App Pro) | Out of MVP scope |
