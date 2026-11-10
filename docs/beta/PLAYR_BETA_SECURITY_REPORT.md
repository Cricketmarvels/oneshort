# GoFindr beta — security and privacy release gate

Date: 2026-11-10. Scope: API and app code on `develop`. Method: regression suites executed in this workspace, config inspection, live-demo probes. **No Critical or High findings open at the API level.** Items that need the real beta environment are marked NOT VERIFIED.

| Gate item | Result | Evidence |
|---|---|---|
| No hardcoded API secrets | PASS | `.env` git-ignored; mobile bundle uses only `EXPO_PUBLIC_API_URL`; CI dependency scan; repo grep for tokens clean (earlier audit) |
| No insecure authentication bypasses | PASS | alg=none / expired / wrong-issuer / garbage tokens rejected; `TOKEN_REVOKED` after sign-out-everywhere; password login requires verified mobile or invite account; takeover fixes C1/C2 with regressions |
| No OTP exposure in logs | PASS | Redaction keys cover `otp`, `code`, `password`, tokens, phone, email; exception text scrubbed; 4k-line demo log audited; dev code shown only when `is_dev_like` and never in `beta`/`production` (validator) |
| No unauthorized player/team modification | PASS | 17 IDOR probes + team/match policy tests; media ownership tests; device token owner-only |
| No insecure direct object references | PASS | same suite; fee page refuses non-participants (e2e 8) |
| No unrestricted location exposure | PASS | API returns rounded distances only; `home_location` never serialised; blocked users hidden; results capped |
| No unrestricted profile-image access | PASS (local) / NOT VERIFIED (bucket) | Uploads re-encoded, metadata stripped, own-URL-only fields; images are public-by-URL by design (random 32-hex names) — same model as the planned bucket |
| No open notification endpoints | PASS | Pushes only as side effects of authorized actions; `/whatsapp/webhook` rejects unsigned posts; no "send notification" API |
| No insecure deep links | PASS | Payloads carry opaque ids; screens refetch; invite links are random codes with use limits and expiry; URL-only CricHeroes links validated |
| No unnecessary background location | PASS | When-In-Use only; no background modes |
| No accidental exposure of dev endpoints | PASS | WhatsApp simulator routes 404 unless `WHATSAPP_PROVIDER=simulator` (refused in beta/production); tester sign-up refused in beta/production |
| No unrestricted WhatsApp messaging | PASS | Opt-in required; approved templates only; OTP budgets (+91 allowlist, per-number/day, per-IP/hour, global daily) |
| No sensitive tokens in client logs | PASS | No console logging of tokens; refresh token in Keychain, access token in memory |
| No beta-to-production DB mix-up | NOT VERIFIED (no beta yet) | Runbook: separate Atlas DB user per environment, startup prints `app_env` + DB name |
| Privacy/consent disclosures present | PASS code / **BLOCKED content** | Terms v2 + DPDP notice + consent; `LEGAL_ENTITY_*` placeholders must be filled (startup refuses in beta otherwise) |
| Phone-number enumeration (H2) | PASS (fixed 2026-11-10) | identical replies; `test_auth.py`, e2e 11. Residual Medium: `/auth/invite-register` reveals existence behind a valid invite code |
| Previously implemented fixes preserved | PASS | 233 backend tests incl. all earlier security suites |
| Refresh-token reuse detection | PASS, with a deliberate 10 s grace | A token replayed within 10 s of its own rotation, while its successor is still unused, gets a fresh pair (page reloads and killed apps race themselves); any other replay revokes the family. Tested both ways in `test_auth.py` |

## Residual findings

| Sev | Finding | Plan |
|---|---|---|
| Medium | Invite-link sign-up reveals that a number has an account (needs a valid, active invite code; rate-limited) | Move invite sign-up to the OTP flow (auth plan phase 1b) |
| Medium | Web client keeps the refresh token in `sessionStorage` | httpOnly cookie for the web build (not part of the iOS beta) |
| Medium | HS256 shared JWT secret; rotation signs everyone out | EdDSA + JWKS (auth plan phase 2) |
| Low | GitHub tokens pasted into chat earlier not confirmed rotated | Owner action |
| Low | Rate limiter in-memory until `RATE_LIMITER_BACKEND=mongo` is set in beta | Set in the beta env |

## Regression results (this run)

- Backend: see `PLAYR_RELEASE_READINESS_REPORT.md` for the exact count (all security suites included: `test_security_idor.py`, `test_security_auth.py`, `test_security_takeover.py`, `test_sessions.py`, `test_push_and_abuse.py`, `test_request_limits.py`, `test_media.py`, `test_tester_signup.py`, `test_beta_sport_flag.py`, `test_devices.py`).
- Playwright: 11/11 with `GOFINDR_BETA_SPORT=cricket`.
- Dependency audit: pip-audit clean (last run); npm production audit clean at high.
