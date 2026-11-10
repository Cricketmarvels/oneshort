# PlayR — existing architecture audit for the cricket iOS beta

Date: 2026-11-10 · Branch `develop`. Evidence: 232 backend tests, 11 Playwright journeys (run with `PLAYR_BETA_SPORT=cricket`), live-demo checks, config inspection. Statuses: **READY / PARTIALLY IMPLEMENTED / MISSING / BLOCKED BY EXTERNAL DEPENDENCY**. Nothing is READY because code exists; only because it was executed.

## 1. Stack as found

| Layer | Found | Notes |
|---|---|---|
| Mobile | Expo SDK 58, React Native 0.88, TypeScript strict, expo-router (typed routes), TanStack Query, zustand, expo-image, expo-location, expo-notifications, expo-secure-store, expo-speech-recognition; custom token-based design system (`theme.ts`, `#F5F6F0` canvas, `#008C86` teal) | No Gluestack/NativeWind/RHF — not needed |
| EAS | `eas.json`: development (dev client), simulator, preview, **beta** (store, channel `beta`, auto-increment, m-medium), production; per-profile `EXPO_PUBLIC_API_URL` | No EAS project id yet |
| iOS identity | bundle `app.playr.cricket`, name PlayR, `ITSAppUsesNonExemptEncryption=false`, When-In-Use location, camera, photos, microphone strings; splash configured | No associated domains (no owned domain yet) |
| Backend | FastAPI, Pydantic strict models, PyMongo async, 32 modules, structured JSON logs with redaction, Sentry wired (off until DSN) | `APP_ENV=beta` added with production guards |
| Database | MongoDB 8 replica set; 122 index definitions incl. 2dsphere, TTLs, partial uniques; majority writes, retryable ops, 15 s selection timeout; failover drill: 0 lost writes | Managed Atlas not provisioned |
| CI | GitHub Actions: backend lint/types/tests, OpenAPI contract, frontend, mobile typecheck/jest, dependency scanning | Never executed: 19 commits unpushed (token) |

## 2. Capability classification

| # | Capability | Status | Severity if gap | Blocks TestFlight? | Fix / dependency |
|---|---|---|---|---|---|
| 1 | Cricket-only beta flag | **READY** (new today) | — | — | `PLAYR_BETA_SPORT=cricket`: single sport offered, racket APIs 404, profiles read as cricket; verified on the live demo |
| 2 | Phone-OTP auth, sessions, refresh rotation, device sessions, sign-out-everywhere, lockout, no enumeration, takeover fixes | **READY** | — | — | 40+ auth/security tests |
| 3 | OTP delivery to real Indian numbers (WhatsApp/SMS) | **BLOCKED BY EXTERNAL DEPENDENCY** | Critical for beta | **Yes** | Meta WhatsApp Business sender + approved templates + billing; MSG91 + DLT for SMS fallback (`PLAYR_WHATSAPP_SETUP.md`) |
| 4 | WhatsApp match-invitation messages (opt-in) | BLOCKED BY EXTERNAL DEPENDENCY | Medium (push + in-app cover it) | No | Same credentials; code tested with a fake provider |
| 5 | Player registration & profile (role, styles, area, availability, bio, CricHeroes, photo add/change/take/remove) | **READY** | — | — | e2e journeys 4, 10, 11; photo removal added today |
| 6 | Profile-picture pipeline (magic bytes, Pillow re-encode, EXIF/GPS strip, size caps, own-URL-only fields, ownership checks) | **READY** (local disk) / PARTIALLY for beta | Medium | No for device testing; **yes** for a multi-tester beta | Object-storage adapter (S3/R2) behind the existing `StorageProvider` — ~60 lines, needs a bucket |
| 7 | Nearby discovery 5/10/20 km, approximate distances, filters, blocked-user exclusion | **READY** (list) | — | — | `$geoNear`, explain-plan clean; blocked exclusion added today |
| 8 | Map view with markers | PARTIALLY IMPLEMENTED (approximate SVG preview) | Low | No (list-first decision) | `react-native-maps` after device testing |
| 9 | Teams: create, logo/cover, roster, requests, invites, RBAC, races | **READY** | — | — | e2e journey 7, concurrency tests |
| 10 | Matches: wizard, squads, atomic seat claims, invitations state machine, accept/reject/confirm | **READY** | — | — | e2e 2–6, `test_invitation_concurrency.py` |
| 11 | In-app notifications + preferences | **READY** | — | — | module tests |
| 12 | iOS push delivery | BLOCKED BY EXTERNAL DEPENDENCY (code READY: Expo provider, tickets/receipts, deep links, logout token cleanup added today) | High | **Yes** for TC-13/16/17 | EAS project + APNs key + 2 iPhones (`PLAYR_IOS_PUSH_SETUP.md`) |
| 13 | Fee split / manual payment tracking | **READY** | — | — | e2e 5–6 |
| 14 | Legal: Terms v2, DPDP Privacy Notice, 3-switch consent, privacy requests, export, erasing deletion | **READY** code / PARTIALLY content | High | **Yes** | `LEGAL_ENTITY_*` values (app refuses to start in beta without them); counsel review |
| 15 | Security hardening: IDOR suite, rate limits (memory; Mongo-shared available), body caps, redaction, Sentry scrubbing, webhook signing, OTP budgets | **READY** | — | — | `PLAYR_BETA_SECURITY_REPORT.md` |
| 16 | Beta hosting (HTTPS domain, Atlas, object storage, logs, alerts) | **MISSING** (designed) | Critical | **Yes** | Paid approval; runbook ready |
| 17 | Backups | PARTIALLY (scripts verified; not scheduled; Atlas PITR in design) | High | Yes with real users | `schedule.sh install` now; Atlas PITR at hosting |
| 18 | Crash reporting on device | **MISSING** | Medium | No, but strongly recommended before 50 testers | `sentry-expo` in the dev build (needs a DSN); backend Sentry ready |
| 19 | Background location | Not required — decision recorded | — | No | Only When-In-Use requested |
| 20 | Voice search | PARTIALLY (implemented, never device-tested) | Low | No | Dev build |
| 21 | CI running | MISSING (config READY) | Medium | No | GitHub token |
| 22 | Real-device test evidence | MISSING | — | **Yes** (acceptance) | Builds + devices |

## 3. Changes made during this audit (all tested)

- `PLAYR_BETA_SPORT` flag (backend setting, public via `/auth/options`, racket router guard, preferred-sport coercion/validation; mobile sport screen, login, root gate).
- `APP_ENV=beta` with production-grade guards.
- Nearby discovery excludes blocked users both ways.
- Profile photo: take with camera, remove.
- Push token forgotten on logout (`DELETE /users/me/devices/{token}`, owner-only).
- `eas.json` `beta` + `development` profiles, `submit.beta`.
