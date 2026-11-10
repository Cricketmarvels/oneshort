# PlayR Cricket Beta — TestFlight release plan

Target: invite-only external TestFlight, 30–50 cricket players and captains in Noida/NCR, real phone numbers, real notifications. Date: 2026-11-10.

## Phase status

| Phase | Scope | Status | Blocker / next step |
|---|---|---|---|
| 1 Audit | `PLAYR_EXISTING_ARCHITECTURE_AUDIT.md` | ✅ done | — |
| 2 Cricket-only flag | `PLAYR_BETA_SPORT=cricket`: single sport offered, racket APIs 404, profiles read as cricket, nothing deleted | ✅ done, tested (5 tests, 11/11 e2e with the flag on, live on the demo) | — |
| 3 WhatsApp OTP | Meta Cloud API adapter, templates script, budgets, generic replies | ⚠ code ready; **BLOCKED** on Meta business verification, sender number, template approval, billing | `PLAYR_WHATSAPP_SETUP.md` |
| 4 Player registration & profiles | OTP sign-up → onboarding (role, days/times, bio, CricHeroes) → profile (photo add/change/take/remove, batting/bowling style, area, availability) | ✅ done; photo removal and camera added 2026-11-10 | — |
| 5 GPS discovery | 5/10/20 km `$geoNear`, approximate distances, filters, blocked-user exclusion (new), list + approximate map | ✅ list-first done; real map tiles deferred | `PLAYR_GPS_DISCOVERY_TEST_PLAN.md` |
| 6 Teams | Create, logo/cover, roster, join requests, invites, vice-captain, CricHeroes team link, RBAC + races tested | ✅ done | — |
| 7 Match invitations + WhatsApp | Invite → push + in-app (+ WhatsApp template when opted in) → accept/reject → captain confirm (atomic seat) | ✅ in-app/push code done; WhatsApp **BLOCKED** (phase 3) | — |
| 8 iOS push | Expo Push Service, tickets + receipts, deep links, logout token cleanup (new) | ✅ code; **BLOCKED** on EAS project + APNs key + iPhones | `PLAYR_IOS_PUSH_SETUP.md` |
| 9 Background location | Evaluated: **not needed**; only When-In-Use requested | ✅ decision recorded | — |
| 10 Beta backend | `APP_ENV=beta` with production guards (new); Atlas/hosting design ready | **BLOCKED** on paid hosting approval | `PLAYR_BETA_DEPLOYMENT_RUNBOOK.md` |
| 11 TestFlight config | `eas.json` `beta` profile (store distribution, channel beta, auto-increment), splash, icons, permission strings | ✅ config; **BLOCKED** on Apple Developer + EAS accounts | `PLAYR_APPLE_REVIEW_CHECKLIST.md` |
| 12 Device testing | 25-case matrix | **BLOCKED** on devices + builds; web/API-level evidence recorded | `PLAYR_REAL_DEVICE_TEST_MATRIX.md` |
| 13 Security gate | Regression suites, no Critical/High open | ✅ passed at API level | `PLAYR_BETA_SECURITY_REPORT.md` |

## Critical path (what unblocks the most)

1. **Accounts (owner, ~1 hour):** Apple Developer Program → Expo account + `npx eas-cli init` → `npx eas-cli credentials` (APNs). Meta Business verification started in parallel (days).
2. **Development builds on 2 iPhones** → run the push plan A–E and the GPS plan G-1…G-9 → fill the matrix.
3. **Beta hosting approved** → provision per runbook (Atlas Mumbai, API host, R2 media, domain) → `APP_ENV=beta`, `PLAYR_BETA_SPORT=cricket`, `PUSH_PROVIDER=expo`, `WHATSAPP_PROVIDER=meta`, legal identity set.
4. **Templates approved** → real-number OTP verification (TC-02/03/12).
5. `eas build --platform ios --profile beta` → smoke test the store build on the two phones → **ask for authorization** → `eas submit --platform ios --profile beta` → Beta App Review → "PlayR Cricket Beta" group → invite 30–50 testers.

## Beta data policy

Beta uses its own database (`cricket_beta`) and media bucket. Before public launch the owner decides: keep (testers become launch users; data already complies with the Privacy Notice) or wipe (`mongorestore` nothing; drop the database and bucket prefix; audit log of the decision). Testers are told in the invite which it will be.

## Exact commands for the next steps

```bash
# owner, once
cd mobile && npx eas-cli@latest login && npx eas-cli init
npx eas-cli credentials                       # iOS: APNs key, dist cert, profile
# device test builds
npx eas-cli build --profile development --platform ios
# store build for TestFlight (after hosting + beta env are live)
npx eas-cli build --profile beta --platform ios
# only with explicit authorization
npx eas-cli submit --profile beta --platform ios
```
