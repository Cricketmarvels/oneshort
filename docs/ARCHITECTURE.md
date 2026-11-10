# Architecture

## 1. System context

```
 ┌──────────────┐   ┌──────────────┐
 │ Web (React19)│   │ Mobile (Expo)│
 └──────┬───────┘   └──────┬───────┘
        │ HTTPS REST /api/v1 + WebSocket /api/v1/ws
        ▼
 ┌─────────────────────────────────────────────┐
 │ FastAPI modular monolith (Python 3.13)      │
 │  middleware: request-id · security headers  │
 │              · CORS · rate-limit · logging  │
 │  api/v1 router → module routers             │
 │  module services (business rules)           │
 │  repositories (PyMongo Async)               │
 │  infrastructure adapters (SMS, push,        │
 │   storage, geocoding, AI)                   │
 └──────┬───────────────────────┬──────────────┘
        ▼                       ▼
 MongoDB 8 (replica set,   External providers (env-configured,
 2dsphere, transactions)   dev adapters when unconfigured)
```

## 2. Repository layout

```
platform/
  docs/                  design documents (this folder)
  backend/               FastAPI service (uv-managed, Python 3.13)
    app/
      main.py            app factory, lifespan, middleware
      core/              config, security, logging, exceptions, middleware, rate limiting
      api/               dependencies.py (auth, RBAC guards), v1/router.py (aggregates modules)
      common/            enums, pagination, response envelope, ObjectId and time helpers
      infrastructure/
        database/        client, indexes, transactions
        integrations/    sms, email, push (FCM), storage, geocoding, ai
        realtime/        WebSocket connection manager (pub/sub interface)
      modules/<domain>/  schemas.py · repository.py · service.py · router.py
    scripts/seed_data.py realistic Noida sample data
    tests/
  shared/                @cm/shared: generated OpenAPI types + shared domain helpers (web + mobile)
  frontend/              React 19 + Vite + TS (feature-based)
  mobile/                Expo (React Native) app
  docker-compose.yml     mongo (replica set) + api + web
```

The specification also suggests `api/v1/<module>/` folders. Instead, routers live next to their module (`modules/<m>/router.py`), and `api/v1/router.py` only aggregates them. Keeping a module self-contained (routes, schemas, service, repository) makes it easier to extract into a service later.

## 3. Backend layering

`Router (HTTP only)` → `Dependencies (auth, RBAC, agreement gate)` → `Service (business rules, transactions, audit, notifications)` → `Repository (Mongo queries)` → `MongoDB`

- Routers only parse input, call one service method, and wrap the result. They contain no business rules.
- Services receive their collaborators through constructors, wired in `api/dependencies.py` using FastAPI `Depends`. Tests can override any of them.
- Domain rules that are pure functions live in their own modules so they can be unit tested without a DB:
  - `matches/lifecycle.py`: the state machine
  - `invitations/state_machine.py`
  - `settlements/calculator.py`: fee maths in paise
  - `discovery/ranking.py`: the ranking engine
  - `ratings/reliability.py`
  - `availability/overlap.py`
- Integrations are `Protocol`s with a real adapter and a dev adapter. Configuration chooses between them. In production the app refuses to start with dev adapters for OTP.

### Module dependency diagram

```
auth ──► users ◄── agreements
           ▲
players ───┤      captains ──► teams ──► team_members
           │                    ▲
availability ◄── discovery ─────┤
           ▲         │          │
           └── invitations ◄────┴── matches ──► squads (rosters)
                     │                │
                     ▼                ▼
               notifications ◄── settlements ──► payments
                     ▲                │
ratings ─────────────┤                ▼
reports ─────────────┘           audit (cross-cutting)
```
Lower modules never import higher ones. Cross-module calls go through service interfaces, never through another module's repository.

## 4. Key designs

### 4.1 Discovery (Find a Player)
1. Load the match, authorise the captain, and take the venue point as the origin.
2. `$geoNear` on `availability.location` (2dsphere), with `maxDistance = radius_m` and query `{status ∈ [available, tentative], visibility: discoverable, start_at < match.end, end_at > match.start}`.
3. Keep only slots where `distance ≤ slot.max_travel_km` and coverage ≥ the required ratio. Group by player.
4. `$lookup` player_profiles and users, and drop suspended, restricted, deleted, and self. Exclude players already invited or rostered for this match, and apply the role filter and minimum rating.
5. Python `RankingEngine` (weights from config) scores each candidate and returns a per-factor breakdown.
6. Pagination happens after ranking, with a candidate cap (`DISCOVERY_CANDIDATE_CAP`, default 500).
7. Distances are rounded to 0.5 km and returned as `approx_distance_km`. Coordinates are never projected into responses.

The `Ranker` protocol lets a learned model (for example learning-to-rank on invite-accept outcomes) replace `WeightedRanker` without changing the API.

### 4.2 Concurrency and overbooking
Confirming a player runs in a transaction:
1. A conditional `$inc` on `matches.confirmed_count`, guarded by `confirmed_count < squad_capacity`.
2. The invitation moves from `accepted` to `confirmed`, guarded by its current status.
3. The roster entry is inserted. A partial unique index on `(match_id, player_id, is_active)` prevents duplicates.

A failed guard aborts the whole transaction. Write conflicts are retried using the driver's `with_transaction` semantics.

Overlapping availability creation is serialised by touching a per-player lock field inside a transaction.

### 4.3 Settlements
`calculator.py` is pure integer maths on paise. Draft → Published is a single transaction that freezes the expense snapshot and per-player lines and creates `payment_records`. A revision creates settlement version n+1, marks version n as `superseded`, and carries forward amounts already paid as `credited_paise`.

### 4.4 Real-time
`/api/v1/ws?token=…` is a native FastAPI WebSocket. The `RealtimeHub` protocol has an in-process implementation now and can switch to Redis pub/sub when there is more than one instance. Events: `invitation.updated`, `roster.updated`, `payment.updated`, `team.membership.updated`, `notification.created`.

### 4.5 Background jobs
A lightweight asyncio scheduler runs in the lifespan and can be disabled with `SCHEDULER_ENABLED=false`. It expires pending invitations and sends match reminders 24 hours before a match. It can move to a worker or queue later.

## 5. Frontend architecture
Presentation (pages) → feature components → hooks (TanStack Query) → `services/api` (Axios with token refresh interceptor) → backend.
- `app/` holds the router (lazy, route-level code splitting), providers (Query, theme, toasts), and the auth store (Zustand, with tokens in memory and a refresh token in localStorage on web).
- `features/<feature>/` holds `api.ts` (query hooks), `components/`, and `pages/`.
- `components/ui` holds design-system primitives (Button, Input, Card, Badge, Sheet, Dialog, Tabs, EmptyState, ErrorState, Skeleton).
- Types come from `@cm/shared`, which is generated from FastAPI's OpenAPI (`npm run gen:api`) so the contracts cannot drift.

## 6. Mobile
Expo Router app consuming the same API through `@cm/shared`. Device features use these modules:
- `expo-secure-store` for tokens
- `expo-location` for location, with an explicit permission prompt
- `expo-notifications` for push, with the FCM token registered at `/users/me/devices`
- `expo-image-picker` for the camera and image upload
- the native `Share` API for sharing
- deep links through the `gofindr://` scheme

## 7. Technology decisions
| Area | Choice | Why |
|---|---|---|
| Mongo driver | PyMongo Async (`AsyncMongoClient`) | The spec requires it. Motor is being deprecated. |
| JWT | PyJWT | Actively maintained. python-jose is unmaintained. |
| Hashing | argon2-cffi | Used for passwords and OTP codes. |
| Logging | structlog (JSON) | Request-id binding and redaction processors. |
| Python tooling | uv, ruff, mypy, pytest | Fast, reproducible. |
| Web UI | Tailwind v4 + Radix primitives (shadcn-style components, vendored) | Accessible, with no runtime lock-in. |
| Maps | Leaflet + OSM (dev), Mapbox/Google via env | No key is needed to develop. |
