# CricketMarvels Play

**Hyperlocal cricket matchmaking & team management.** Find nearby players, find a team, build a squad, and split match fees.

| Part | Stack | Path |
|---|---|---|
| API | Python 3.13 · FastAPI · Pydantic v2 · PyMongo Async · MongoDB 8 (replica set) | [`backend/`](backend/) |
| Web | React 19 · TypeScript · Vite · Tailwind v4 · TanStack Query · Zustand · RHF + Zod · Leaflet | [`frontend/`](frontend/) |
| Mobile | Expo SDK 58 · Expo Router · SecureStore · Location · Notifications · ImagePicker | [`mobile/`](mobile/) |
| Contracts | OpenAPI → generated TypeScript types + shared helpers | [`shared/`](shared/) |
| Docs | FRD, TRD, architecture, DB design, API spec, security, testing, deployment, plan and traceability | [`docs/`](docs/) |

## Quick start
```bash
./dev.sh                                              # Mongo RS :27018 + API :8000 + web :5173
(cd backend && uv run python -m scripts.seed_data --reset)
```
Open http://localhost:5173 and log in with **+447700900001** (captain) or **+447700900002** (player); seeded numbers are fictional, so type the full number with +44. In development the OTP is shown on screen. API docs are at http://localhost:8000/docs.

## Tests
```bash
cd backend  && uv run pytest              # 119 tests, real MongoDB replica set
cd frontend && npm test && npm run test:e2e
cd mobile   && npx jest
```

## Key design choices
- **Distance is a hard filter.** MongoDB `$geoNear` from the match venue, then a real time-overlap check, then a deterministic, explainable ranking engine with configurable weights (`RANK_W_*`). The `Ranker` protocol allows a learned model later.
- **No overbooking.** Squad confirmation is a transactional, guarded increment, tested with concurrent requests.
- **Money in integer paise.** Settlements are immutable once published, and revisions carry forward what was already paid.
- **Manual payment tracking only** (no gateway in the MVP). Records are always labelled "marked paid by captain".
- **Privacy.** Exact coordinates never leave the server (distances are rounded to 0.5 km). Venue addresses are visible only to the squad. Logs are redacted.
- **Optional AI.** Claude (`claude-opus-5-5`) gives admins advisory triage of misconduct reports. It is off unless `ANTHROPIC_API_KEY` is set and never takes actions itself.

See [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) for status, the FRD traceability matrix and known gaps.
