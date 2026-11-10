# PlayR Cricket Beta — release readiness report

Date: 2026-11-10 · Branch `develop`. Every status below is backed by something executed in this workspace or explicitly marked BLOCKED / NOT VERIFIED. **TestFlight submission status: not submitted — no build exists yet (accounts pending).**

## Acceptance criteria

| Criterion | Status | Evidence |
|---|---|---|
| A real iPhone user can install the TestFlight build | **BLOCKED** | No Apple Developer / EAS account; `eas.json` beta profile ready |
| A real user can authenticate through an approved, live OTP channel | **BLOCKED** | Meta WhatsApp sender, templates and billing not set up; OTP flow itself PASS at API/web level (identical replies, lockout, cooldown, budgets) |
| Player profiles and teams persist in the beta database | PASS (dev DB) / **BLOCKED** (beta DB) | e2e journeys 4, 7, 10; Atlas not provisioned (paid approval) |
| Nearby discovery works with real device GPS | PASS (API, list) / NOT VERIFIED (device) | `$geoNear` 5/10/20 km, approximate distances, blocked-user exclusion; no device run |
| Captains can invite players to matches | PASS (API/web) | invitation state machine, concurrency test, e2e |
| Native iOS push reaches real devices | **BLOCKED** | Expo push pipeline with tickets/receipts, deep links, logout cleanup all tested with mocks; needs EAS + APNs + iPhones |
| Opted-in users receive approved WhatsApp match notifications | **BLOCKED** | Template send path tested with a fake provider; needs approved templates |
| Players can accept or reject invitations | PASS (API) | invitation tests |
| Security and privacy checks pass | PASS (API level) | `PLAYR_BETA_SECURITY_REPORT.md`: no Critical/High open; legal identity values still to be filled |
| Stable across restarts and network interruptions | NOT VERIFIED (device) | session persistence and refresh retry tested at API level |
| No Critical/High security issues remain | PASS | C1/C2 takeovers fixed, H2 enumeration fixed, all regression suites green |
| External beta review requirements satisfied | PARTIAL | Checklist prepared; reviewer account, privacy label and legal values pending |

## Implemented in this release pass (tested)

1. **Cricket-only beta flag** `PLAYR_BETA_SPORT=cricket` — server-driven: one sport offered before login, "Change sport" hidden, racket (badminton/pickleball) APIs answer 404 (no hidden-sport data can be created), profiles read as cricket while stored values stay intact. Clearing the flag restores every sport without an app update. Live on the demo.
2. **`APP_ENV=beta`** with production guards (no console OTP, no on-screen codes, no tester mode, legal identity required).
3. **Nearby discovery excludes blocked users** in both directions.
4. **Profile photo**: take with camera, remove (plus existing add/change).
5. **Push token forgotten on logout** (owner-only `DELETE /users/me/devices/{token}`).
6. **EAS** `beta` (store, channel beta, auto-increment) and `development` profiles; `submit.beta`.

## Verified working (executed)

- Backend: **232 tests passed**, ruff + mypy clean.
- Playwright (web build, with the cricket flag on): **11/11 journeys** — OTP login, match creation + WhatsApp invite link + rich preview, invite-link sign-up to squad, fee split and dues, team join request + approval, authorization refusal, legal pages + privacy request, CricHeroes at sign-up, unknown-number login → onboarding.
- Mobile: TypeScript clean, jest passing. Classic web: TypeScript clean, 10 tests.
- Live demo: `/auth/options` → `beta_sport: "cricket"`; sport screen shows a single option; `/racket/*` → 404.

## Missing / failed

- Failed tests: none.
- Missing for beta: object-storage adapter for profile images (~60 lines once a bucket exists); device crash reporting; real map tiles (deferred by decision).

## Blocked integrations and required approvals (owner)

| Need | Why | Where |
|---|---|---|
| Apple Developer Program (US$99/yr) + Expo account | TestFlight build, APNs key, device builds | `PLAYR_IOS_PUSH_SETUP.md`, `PLAYR_APPLE_REVIEW_CHECKLIST.md` |
| Meta Business verification, WhatsApp sender, template approval, billing | Real OTP and match messages | `PLAYR_WHATSAPP_SETUP.md` |
| MSG91 + DLT registration (recommended fallback) | Players without WhatsApp | same |
| Paid hosting: Atlas M10 Mumbai, API host, object storage, domain | Beta environment off this Mac | `PLAYR_BETA_DEPLOYMENT_RUNBOOK.md` |
| Legal values: company name, address, Grievance Officer, privacy email | App refuses to start in beta without them | `.env` on the beta host |
| GitHub token | Push 20 commits; CI starts | — |
| Two iPhones + a tester | Device matrix | `PLAYR_REAL_DEVICE_TEST_MATRIX.md` |

## Environment readiness

| Environment | State |
|---|---|
| Development (this Mac) | Running; cricket-only flag on; public quick-tunnel demo |
| Beta | Not provisioned; runbook ready; config validated by `test_beta_sport_flag.py::test_beta_environment_has_production_guards` |
| Production | Not started |

## Build status

No iOS build has been produced. Next commands (owner, in order):

```bash
cd mobile && npx eas-cli@latest login && npx eas-cli init          # project id → app.json
npx eas-cli credentials                                             # APNs key + distribution signing
npx eas-cli build --profile development --platform ios             # device testing
# after beta hosting + WhatsApp are live and the device matrix passes:
npx eas-cli build --profile beta --platform ios
# only with explicit authorization:
npx eas-cli submit --profile beta --platform ios
```
