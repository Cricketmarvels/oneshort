# PlayR beta — real-device test matrix

Date: 2026-11-10. **No physical-device run has happened yet** (no EAS project, APNs key, WhatsApp sender or dev builds). Statuses reflect what was actually executed: web build + API, or BLOCKED. A row becomes PASS only with device evidence (recording + log excerpt) attached here.

| ID | Feature | Expected | Status | Evidence so far |
|---|---|---|---|---|
| TC-01 | Install via TestFlight | Installs and launches | BLOCKED | No build (Apple/EAS accounts) |
| TC-02 | WhatsApp OTP | Real OTP arrives | BLOCKED | Simulator end-to-end only |
| TC-03 | OTP verification | Authenticates | PASS (API+web) / device NOT VERIFIED | e2e 1, 11; `test_auth.py` |
| TC-04 | Player registration | Profile persists | PASS (web) | e2e 4, 10 |
| TC-05 | Profile picture | Secure upload | PASS (web, local storage) | `test_media.py`; bucket NOT VERIFIED |
| TC-06 | Nearby 5 km | Correct players | PASS (API) / device NOT VERIFIED | `test_find.py`, GPS plan G-1 |
| TC-07 | Nearby 10 km | Radius expands | PASS (API) | `test_find.py` |
| TC-08 | Nearby 20 km | Radius expands | PASS (API) | `test_find.py` |
| TC-09 | Nearby map | Approximate markers | PARTIAL | SVG preview, no tiles (list-first decision) |
| TC-10 | Create team | Persists | PASS (web) | e2e 7 |
| TC-11 | Invite player | Invitation created | PASS (API) | `test_matches.py`, concurrency test |
| TC-12 | WhatsApp match invitation | Approved message delivered | BLOCKED | Fake provider only |
| TC-13 | Push invitation | iPhone notification | BLOCKED | Provider unit tests only |
| TC-14 | Accept invitation | Captain sees status | PASS (API) | invitation tests |
| TC-15 | Reject invitation | Status updates | PASS (API) | invitation tests |
| TC-16 | Background notification | Arrives | BLOCKED | — |
| TC-17 | Notification deep link | Correct screen | BLOCKED (device) / code PASS | shared deep-link map; parked-tap store |
| TC-18 | Deny GPS | Graceful fallback | NOT VERIFIED (device) | manual-area fallback exists |
| TC-19 | Logout | Session ends | PASS (API) | `test_auth.py`; push token now forgotten (`test_devices.py`) |
| TC-20 | Revoke device session | Access invalidated | PASS (API) | `test_sessions.py` (immediate `TOKEN_REVOKED`) |
| TC-21 | Background location | Only if enabled | N/A | Not enabled by decision |
| TC-22 | Cricket-only flag | Other sports hidden | PASS (web + API) / device NOT VERIFIED | live demo: 1 sport option, racket API 404; `test_beta_sport_flag.py` |
| TC-23 | Account deletion | Personal data erased | PASS (API) | `test_legal_privacy.py` |
| TC-24 | Network failure | Recoverable error | NOT VERIFIED (device) | API wrapper surfaces errors; refresh retries transient failures |
| TC-25 | App restart | Session persists | NOT VERIFIED (device) | Keychain refresh token + rotation tested at API level |

## How to run the device pass

1. Two iPhones with the development build signed in as two different real numbers (after WhatsApp OTP is live) or tester accounts created on the beta API by the admin.
2. Follow `docs/design/PUSH_NOTIFICATIONS.md` §4 (A–E) and `PLAYR_GPS_DISCOVERY_TEST_PLAN.md` (G-1…G-9).
3. For each row: record screen, copy the matching API log lines (already free of secrets), update Status and Evidence, commit.
