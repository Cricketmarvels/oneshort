# GoFindr authentication and onboarding

Status: current as of 2026-11-10 (audit and hardening release). This replaces the proposal in
`docs/design/AUTH_ARCHITECTURE_REVIEW.md`, which is kept as history.

## 1. Architecture in one paragraph

The verified mobile number is the account identity. A 6-digit SMS code proves it, for sign-up and for
log-in on a new device. After that the device keeps a backend-managed session: a 15-minute JWT access
token and an opaque, rotating refresh token. Email is collected during registration but is not verified
in this release. Password log-in still works for accounts that already set a password. New accounts do
not need one. No managed auth provider (Firebase, Clerk, Supabase, WorkOS) is used. The code lives in
`backend/app/modules/auth/`, `backend/app/modules/users/registration.py` and, on the phone, in
`mobile/src/app/(auth)/`, `mobile/src/app/register.tsx` and the routing gate in `mobile/src/app/_layout.tsx`.

## 2. Registration flow

| # | Screen | What happens |
|---|---|---|
| 1 | Welcome | Get Started, or "Already have an account? Log in". |
| 2 | Sport | Cricket, Badminton or Pickleball, stored on the device. During the beta only cricket is offered. |
| 3 | Mobile number | +91 default. Nothing else is asked before the number is proven. One Continue button. |
| 4 | SMS code | 6 digits, iOS/Android autofill (`oneTimeCode` / `sms-otp`), paste, auto-verify, 60 s resend countdown, Change number. |
| 5 | Terms and Privacy | Three required ticks (terms, privacy consent, 18+). Stored: terms version, privacy version, time, account, IP, device. |
| 6 | Your details | Full name and email. Email is format-checked and saved with `email_verified = false`. |
| 7 | Player or Captain | Saved on the server. |
| 8 | Profile | Optional photo. Players pick a main role (cricket). Captains are told they create their team next. |
| 9 | Dashboard | Player → Home. Captain → Teams. |

Terms come before details because the routing gate (section 4) checks the agreement first. Both orders
satisfy the rule that nothing reaches the dashboard before both are done.

The account is created when the code is verified, never before. Unverified challenges live in
`otp_codes` with a TTL index (codes 5 minutes, send logs 24 hours), so abandoned sign-ups leave no account.
If the number already has an account, the code opens it as it is: no name, email, password, role or team
is changed by the sign-up. `users.mobile_number` has a unique index, and a lost insert race opens the
winning account.

Registration finishes with `POST /users/me/registration`, which sets `registration_completed_at`. It is
refused twice (`REGISTRATION_COMPLETE`), refuses an email used by another account (`EMAIL_IN_USE`) and keeps
an already verified email verified. The device keeps a draft of the steps, so a closed app resumes on the
same step. Existing members were back-filled at startup, so nobody is asked to register again.

## 3. Account lifecycle and fields

| Field | Meaning |
|---|---|
| `mobile_verified` (API: `phone_verified`), `phone_verified_at` | Set by the SMS code. |
| `email`, `email_verified`, `email_verified_at` | Email from registration, unverified. Never used for recovery. |
| `registration_completed_at` | Set by the Player/Captain step. |
| `agreement_version_accepted`, `privacy_version_accepted` | Plus a row per acceptance in `user_agreements`. |
| `verified_via` | `captain_invite` or `email` for the two legacy self-typed-number sign-ups. Such numbers get no WhatsApp until an SMS code proves them. |
| `sessions_valid_after` | Access tokens issued before this time are refused (sign out everywhere, password reset, takeover cleanup). |

Captain-created player records have an unverified number and no `verified_via`. When the number's owner
proves it by SMS, they take over that record with its team history. Any password or email attached
before the number was proven is removed and its sessions end.

## 4. Routing on every launch

Checked in order. The first match wins.

1. Startup can't reach the server → "Can't reach GoFindr / Try again". The saved session is kept.
2. No session and no sport → Welcome. An invited newcomer skips this and goes to sign-up.
3. No session → Log in.
4. Current terms not accepted → Agreement. A material terms change re-prompts.
5. Number verified, registration incomplete → Registration, on the saved step.
6. Pending invite code → the invite screen. It can't bypass 4 or 5, and the join API checks the
   agreement, link status, expiry, capacity and roster again.
7. Otherwise → the dashboard.

The sport stored on the device is a preference, never proof of anything.

## 5. Code rules

| Rule | Value | Where |
|---|---|---|
| Generation | `secrets.choice`, 6 digits | `core/security.py` |
| Storage | Argon2id hash only, never logged | `auth/service.py`, logging redaction tests |
| Expiry | 5 minutes | `OTP_TTL_SECONDS` |
| Wrong tries | 5, then the code is deleted | `OTP_MAX_ATTEMPTS` |
| Single use | The verifying request must delete the code. A concurrent second submission fails. | `_consume_otp` |
| Resend | 60 s, enforced by one atomic send slot per number | `_claim_send_slot` |
| Resend cancels old code | yes | `_issue_otp` |
| Per number | 5 / hour, 10 / day | `OTP_MAX_SENDS_PER_HOUR/DAY` |
| Per IP | 20 / hour | `OTP_IP_MAX_SENDS_PER_HOUR` |
| Global | `OTP_DAILY_BUDGET` (1,000), warning log at 80 %, refusal at 100 % | `auth/abuse.py` |
| Region | +91 only | `OTP_ALLOWED_PREFIXES` |
| Enumeration | Same reply for known and unknown numbers on send, sign-up and reset | tests in `test_auth.py` |

The daily, per-IP, region and budget limits apply only to sends that cost money. The free development
adapter and the WhatsApp simulator skip them.

## 6. Sessions

- Access token: 15 minutes, HS256, `iss=gofindr`, `aud=gofindr:<APP_ENV>`. A token minted for another
  environment is refused even if secrets were shared. Tokens from before the audience claim are accepted
  for their remaining life, so the release signed nobody out.
- Refresh token: opaque, SHA-256 stored, rotated on every use, 30 days from last use, 90 days absolute.
- Reuse of a rotated token revokes the whole device session. A 10-second grace covers the app racing itself.
- Sign out one device (`DELETE /auth/sessions/{id}`) or log out: the device's access token is refused at
  once via `revoked_sessions` (TTL = token lifetime).
- Sign out everywhere and password reset: every access token is refused at once via `sessions_valid_after`.
- Mobile stores tokens in the device keychain (SecureStore). A 5xx or offline refresh never discards them.
  Only a 401 or 403 does. Requests time out after 20 s (uploads 60 s) with a clear message.
- The app does not ask for a code on every launch. The session is restored silently.

## 7. Passwords

Kept for accounts that already have one: Argon2id, 8 failed tries pause password log-in for 15 minutes
per account, plus the per-IP limit. Reset goes only through an SMS code to the verified number and ends
every session. New sign-ups don't set a password. The one exception is demo test numbers, which can't
receive SMS and need a password to log back in. Removing password log-in for existing users would need
a migration plan: tell users, require a verified number on each account, then switch it off.

## 8. Environments

| | Development | Staging (TestFlight) | Beta / Production |
|---|---|---|---|
| `APP_ENV` | development / test | staging | beta / production |
| SMS | console adapter, no charge | real provider for chosen tests, low `OTP_DAILY_BUDGET` | real provider only |
| Codes on screen | `DEV_OTP_IN_RESPONSE=true` (turn off on public tunnels) | never, except `TESTER_SIGNUP_PREFIX` fictional numbers for brand-new accounts | never |
| Test numbers | allowed | allowed: explicit prefix allowlist | refused at startup |
| Database and secrets | local | own MongoDB database and own `JWT_SECRET` | own cluster and secrets |
| Startup guard | none | refuses weak `JWT_SECRET` or `DEBUG=true` | refuses console SMS, WhatsApp simulator, test prefix, weak secret, debug, missing legal details |

Automated tests use the console adapter, simulate provider timeouts, expired codes, budget exhaustion
and concurrent requests, and run against a separate `cricket_test` database.

## 9. Production SMS and cost control

1. Choose MSG91 or Twilio (both adapters exist). Register the sender ID and OTP template on the DLT portal,
   which Indian telecom rules require.
2. Set `OTP_PROVIDER`, the provider keys and `OTP_DAILY_BUDGET` sized for expected sign-ups. Each code
   is one billed SMS, so the budget is the daily cost ceiling.
3. Watch for the `otp.budget_nearly_exhausted` and `otp.budget_exhausted` log events. Route them to an alert.
4. Verify on a real handset in staging before production.

## 10. Recovery

- Forgot password: SMS code to the verified number only. An unverified email never resets anything.
- Lost phone, same number: get a new SIM for the number, then log in with a code.
- Lost number: there is no self-service number change yet. Support handles it:
  1. The user writes to the grievance email from the address on the account.
  2. Support checks identity offline: the name and email on the account, the team and matches they
     belong to, and confirmation from their captain. Support never confirms whether an account exists
     before identity is checked.
  3. An admin moves the account to the new number marked unverified. The user must then prove it with an
     SMS code, which also ends every old session. Each step is written to the audit log.
  4. At most one recovery request per account per week.
  The admin tool for step 3 isn't built yet. Until it is, recovery needs a developer and the audit entry is
  made by hand.
- Future self-service number change: re-authenticate with the current session and, where set, the
  password. Send a code to the new number and require it. Notify the old number. Keep a 7-day undo
  window, then end every other session.

## 11. Deferred features

- **Email verification**: built, off (`EMAIL_OTP_ENABLED=false`). When on, sign-up can use an email code
  and a verified email can reset a password. Turning it on needs an SMTP provider.
- **Legacy invite-link sign-up** (`INVITE_REGISTER_ENABLED=false`): created an account on any typed number
  without a code. Off because anyone with a shared link could use someone else's number. Invited players
  now sign up with an SMS code and the invite opens afterwards. Existing invite accounts keep working.
- **Google and Apple Sign-In**: add as extra log-in methods linked to an account that already has a
  verified number. They must not replace the number as identity. If Google Sign-In is offered on iOS, Apple's
  App Review guideline 4.8 also requires an equivalent privacy-focused option, such as Sign in with Apple.

## 12. Security checklist (release gate)

- [x] Account created only after the SMS code. No orphan accounts.
- [x] Codes hashed, single use under concurrency, 5 tries, 5 minutes, atomic resend cooldown.
- [x] Per-number, per-IP, region and global budgets on paid sends.
- [x] Same replies for known and unknown numbers.
- [x] Existing accounts never changed by a sign-up form.
- [x] Placeholder profiles claimed only with an SMS-proven number. Earlier credentials are removed.
- [x] No account takeover via unverified email or invite-link sign-up.
- [x] Signed-out devices, password resets and sign-out-everywhere stop access tokens at once.
- [x] Tokens bound to their environment.
- [x] Production and beta refuse test-only auth settings at startup.
- [ ] Real SMS provider and DLT template (needs owner approval: paid).
- [ ] Alert routing for the SMS budget log events.
- [ ] Admin tool for support-assisted number recovery.
