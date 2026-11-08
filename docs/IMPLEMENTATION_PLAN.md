# Implementation Plan & Traceability

## Phase status

| Phase | Scope | Status |
|---|---|---|
| 0 Architecture | FRD, TRD, architecture, DB design, API spec, security, testing, deployment docs | ✅ Done (`docs/`) |
| 1 Foundation | FastAPI app, config, logging, errors, middleware, Mongo RS and indexes, OTP auth, refresh rotation, users, player and captain profiles, agreement gate | ✅ Done and tested |
| 2 Discovery | Availability (overlap and conflict safe), 2dsphere `$geoNear`, Find a Player, Find a Team, ranking engine, invitations, join requests, pagination | ✅ Done and tested |
| 3 Team & match | Teams and membership with delegated admins, match lifecycle, squad and composition, replacement, withdrawal, reschedule, history, attendance | ✅ Done and tested |
| 4 Financial | Expenses, calculator (paise), exemptions, adjustments, rounding, draft → publish, immutable revisions with credit carry-over, manual payment status, captain and player dashboards, disputes, fee discussions, WhatsApp share and reminders | ✅ Done and tested. No payment gateway (by design). |
| 5 Reputation & notifications | Verified two-way ratings, reliability score, reports, admin moderation, in-app notifications and preferences, WebSocket events, reminders, FCM adapter | ✅ Done and tested. FCM delivery is **unconfigured**. |
| 6 Mobile | Expo app: OTP auth, agreement, home, Find a Team, Find a Player, matches, availability, payments, notifications, profile; secure storage, location, push registration, camera and library upload, native share, deep-link scheme | ✅ Typecheck, jest and Android bundle verified. **Not yet run on a device or simulator.** |
| 7 Production readiness | Dockerfiles, compose, CI, security pass, generated API docs, deployment guide | ✅ Written. Docker images **not built locally** (Docker is not installed on the dev machine). CI has not run yet. |

### Verified results (last run, 2026-11-04)
- Backend: **119 pytest tests passed** against a real MongoDB 8.2 replica set. ruff and mypy (strict) are clean.
- Web: `tsc --noEmit` (strict) is clean, **8 Vitest tests passed**, the production build succeeds, and **4 Playwright journeys passed** on mobile and desktop viewports against the live API and seeded DB.
- Mobile: `tsc --noEmit` is clean, **2 jest-expo tests passed**, `expo-doctor` reports 20/20, and `expo export --platform android` bundles successfully.

## Traceability matrix

Test paths: `B:` = `backend/tests/`, `W:` = `frontend/src/test/`, `E:` = `frontend/e2e/journeys.spec.ts`, `M:` = `mobile/src/__tests__/`.

| FRD requirement | Backend API | Frontend screen | Test case | Status |
|---|---|---|---|---|
| FR-ROLE-1 one account, both roles | `PUT /captains/me`, `POST /teams` (grants captain) | Profile, Create team | B: `test_profiles::test_captain_profile`, `test_teams::test_team_creation_membership_and_admin_delegation` | ✅ |
| FR-ROLE-2/3 resource-level auth, delegated admins | `teams/policy.py` used by all services | Team detail (make admin) | B: `test_teams::…admin_delegation`, `test_invitations::test_reject_cancel_and_authorization`, `test_settlements::test_player_cannot_mark_paid` | ✅ |
| FR-ROLE-4 platform admin | `/admin/*` | Admin moderation | B: `test_ratings_reports_privacy::test_misbehaviour_reporting_and_moderation` | ✅ |
| FR-REG-1 mobile + OTP | `/auth/register`, `/auth/verify-otp`, `/auth/send-otp` | Register, Verify OTP, Login | B: `test_auth::test_register_and_verify_otp`, `test_wrong_otp_and_attempt_lockout`, `test_otp_is_single_use`; E: new-player journey | ✅ (SMS provider unconfigured) |
| FR-REG-2/4 email login, password reset | `/auth/login`, `/auth/reset-password` | Login (email tab), Forgot password | B: `test_auth::test_password_login_and_reset` | ✅ |
| FR-REG-3 tokens, rotation, logout | `/auth/refresh`, `/auth/logout` | Axios single-flight refresh; mobile client | B: `test_refresh_rotation_and_reuse_detection`, `test_logout_revokes`; M: `api.test.ts` | ✅ |
| FR-PLY-1/2/3 player profile, roles | `PUT/GET /players/me`, `GET /players/{id}` | Player onboarding (4 steps), Edit profile, Player profile | B: `test_profiles::test_player_profile_*` | ✅ |
| FR-CAP-1 captain profile and teams | `/captains/me`, `/teams` | Create team, Teams, Team detail | B: `test_teams::*` | ✅ |
| FR-AGR-1/2/3 agreement gate, audit, re-acceptance | `/agreements/*`, `require_matchmaking` | Agreement screen, route guard | B: `test_profiles::test_agreement_flow`, `test_teams::test_team_requires_agreement`, `test_availability::test_requires_profile_and_agreement`; E: new-player journey | ✅ (legal review pending) |
| FR-HOME-1/2/3 dashboard and navigation | `GET /dashboard` | Home (4 actions and all sections), AppShell nav | B: `test_dashboard_and_upload`; E: new-player journey (4 actions visible) | ✅ |
| FR-FP-1/2 filters, radius hard limit, venue origin | `POST /discovery/players` | Find a Player | B: `test_discovery::test_radius_is_hard_constraint`, `test_players_within_radius_ranked`; E: captain journey | ✅ |
| FR-FP-3 real time overlap | `$geoNear` query + `merged_coverage` | — | B: `test_overlap::*`, `test_discovery::test_radius_is_hard_constraint` (morning-only and partial players excluded) | ✅ |
| FR-FP-4 configurable ranking | `discovery/ranking.py` (`RANK_W_*`) | "Why this player?" breakdown | B: `test_ranking_and_reliability::*`, `test_discovery::test_role_filter` | ✅ |
| FR-FP-5 never expose coordinates | Public DTOs, `approx_km` | Results show "~2.5 km" | B: `test_discovery::test_no_coordinates_leak`, `test_profiles::…hides_location`; E: captain journey | ✅ |
| FR-FP-6 payee / non-payee before acceptance | `contribution_type` on invitations | Invitation card, selection chips | B: `test_invitations::test_invitation_lifecycle_and_payee_visible`; W: `InvitationCard` tests | ✅ |
| FR-AV-1/2 slots, conflicts, UTC/timezone | `/availability` | Availability week calendar | B: `test_availability::*` (incl. concurrent duplicate submit) | ✅ |
| FR-AV-3 visibility control | `availability_visibility` | Edit profile toggle | Implemented; private slots excluded by the discovery query (`visibility: discoverable`) | ✅ manual |
| FR-FT-1/2/3 Find a Team, join request flow | `POST /discovery/teams`, `/matches/{id}/join-requests`, `/invitations/{id}/confirm` | Find a Team, Join sheet, Invitations (join requests) | B: `test_discovery::test_find_team` | ✅ |
| FR-BT-1 create match, unique ID | `POST /matches` (`match_code`) | Create match | B: `test_matches::test_create_validation_and_unique_code` | ✅ |
| FR-BT-2/3/4 selection methods A/B/C | `/matches/{id}/suggestions/members\|previous`, discovery | Build a Team tabs | Implemented; method C data paths covered in `test_ratings_reports_privacy` setup | ⚠️ manual verification (no dedicated test for suggestions) |
| FR-BT-5 visual composition, capacity | `CompositionOut`, capacity guard | SquadComposition | B: `test_matches::test_full_lifecycle…`; W: `SquadComposition` test | ✅ |
| FR-INV-1 state machine | `invitations/state_machine.py` | Invitation actions | B: `test_state_machines::*`, `test_invitations::*` | ✅ |
| FR-INV-2 no duplicates, no unavailable, no overbooking | partial unique index, availability check, transactional guard | — | B: `test_duplicate_active_invitation`, `test_cannot_invite_unavailable_or_self`, `test_concurrent_confirm_never_overbooks`, `test_double_booking_prevented` | ✅ |
| FR-INV-3 substitute, replace, withdraw, cancel | `/roster/{pid}/replace`, `/withdraw`, `/invitations/{id}/cancel` | Squad page (seat sheet), Match detail | B: `test_matches::test_full_lifecycle_with_replacement_and_withdrawal` | ✅ |
| FR-FEE-1/2/3 expenses, formula, exemptions, adjustments, rounding | `/matches/{id}/expenses`, `settlements/calculator.py` | Split a Fee | B: `test_fee_calculator::*` (incl. invariant over 36 combos), `test_settlements::test_fee_split_with_non_payee_and_exemption` | ✅ |
| FR-FEE-4 review → publish, immutable, revisions | `/settlements/{id}/publish` | Split a Fee draft review, history | B: `test_published_settlement_is_immutable_and_revision_carries_credit` | ✅ |
| FR-PAY-1 captain dashboard | `GET /settlements/{id}/payments` | Payment dashboard | B: `test_mark_paid_audited_and_notified` | ✅ |
| FR-PAY-2 only managers mark paid; audit and notify | `mark-paid`, `mark-exempted` | Paid / Exempt actions | B: `test_mark_paid_audited_and_notified`, `test_player_cannot_mark_paid` | ✅ |
| FR-PAY-3 correction with audit | `/correct` (reason required) | Correct sheet | B: `test_mark_paid_audited_and_notified` | ✅ |
| FR-PAY-4/5 player dashboard, disputes, discussions | `GET /settlements/me`, `/dispute`, `/payments/{id}/discussion` | My payments, Discussion sheet | B: `test_dispute_and_discussion`; E: player journey | ✅ |
| FR-PAY-6 WhatsApp sharing | `/share`, `/remind` (wa.me links) | Share and remind buttons; native Share on mobile | B: `test_mark_paid_audited_and_notified` (share text and link) | ✅ (delivery not tracked, by design) |
| FR-PAY-7 never "verified" | `verification: manual_captain_confirmed` (DB validator) | "Marked paid by captain" wording | B: `test_mark_paid_audited_and_notified` | ✅ |
| FR-MAT-1/3 lifecycle and authorisation | `/transition`, `/cancel`, `/complete` | Match detail (stepper, captain actions) | B: `test_state_machines::*`, `test_matches::test_full_lifecycle…` | ✅ |
| FR-MAT-2 reschedule, history, participation | `PUT /matches/{id}`, `GET /matches?when=past` | Reschedule sheet, Matches → History | B: `test_matches::test_full_lifecycle…`, `test_match_history_lists` | ✅ |
| FR-REP-1/2/3 two-way verified ratings | `POST /matches/{id}/ratings`, `GET /users/{id}/ratings` | Rate match, Reputation | B: `test_verified_match_ratings` | ✅ |
| FR-REP-4 reliability | `players/reliability.py` | Reliability meter | B: `test_reliability_prior_and_bounds`, `test_verified_match_ratings` (no-show scores lower) | ✅ |
| FR-REP-5 rating moderation | `PUT /admin/ratings/{id}` | (API only) | Implemented; aggregates recompute from visible ratings | ⚠️ no dedicated test; no UI yet |
| FR-SAF-1/2 reports and moderation actions | `/reports`, `/admin/reports/*` | Report misconduct, Admin moderation | B: `test_misbehaviour_reporting_and_moderation` | ✅ |
| FR-SAF-3 disclaimer | Agreement content (seeded v1) | Agreement screen | B: `test_agreement_flow` | ✅ (legal review pending) |
| FR-NOT-1 in-app notifications for all events | `NotificationService.notify` | Notifications, bell badge | B: asserted in invitation, settlement, dispute, report, reschedule and reminder tests | ✅ |
| FR-NOT-2 push and real-time | FCM adapter, `/users/me/devices`, `/ws` | Realtime query invalidation; mobile push registration | B: `test_websocket_rejects_invalid_token` | ⚠️ FCM **unconfigured**; WS happy path verified manually |
| FR-NOT-3 preferences | `notification_prefs.muted_types` | Settings | B: `test_muted_notification_types_are_respected` | ✅ |
| FR-PRV-1 location privacy and log redaction | DTO separation, `redact_processor` | Explicit permission prompts | B: `test_logging_redaction`, `test_no_coordinates_leak` | ✅ |
| FR-PRV-2 venue disclosure rules | `MatchAccess.to_out` | Match detail ("shared once you're in the squad") | B: `test_venue_hidden_from_public`, `test_invitation_lifecycle_and_payee_visible` | ✅ |
| FR-PRV-3 deletion and export | `DELETE /users/me`, `GET /users/me/export` | Settings | B: `test_account_deletion_anonymises` | ✅ |
| Scheduler: expiry and reminders | `matches/scheduler.py` | — | B: `test_invitations_expire_and_reminders_sent` | ✅ |

## Remaining work / known gaps
1. **Integrations needing credentials:** MSG91 or Twilio SMS, FCM HTTP v1 (needs `google-auth` and a service account), Cloudinary uploads, and Mapbox/Google geocoding. Each has an interface, a dev adapter and env config, and none is claimed to be operational.
2. **Mobile:** run on iOS and Android simulators and devices (`npx expo run:ios|android`). Add screens to create matches and teams and to publish settlements (currently web-only). Add map-based venue picking.
3. **Rating moderation UI** in the admin dashboard (the API exists), plus a test.
4. A dedicated test for **Build a Team suggestions** (methods A and C).
5. **Legal review** of the agreement text before public launch.
6. **Scale-out:** Redis-backed rate limiter and realtime hub when running more than one API instance. Move scheduler jobs to a single worker.
7. **Web refresh token** is stored in `localStorage`. Consider a `Secure; HttpOnly; SameSite=Strict` refresh cookie before launch (see SECURITY_DESIGN, residual risks).
8. **Advanced AI matchmaking:** the `Ranker` protocol is ready. Collect invite→accept→attend outcomes and train a learning-to-rank model when there is enough data.

## Change set 2026-11-04: CricHeroes, Noida, native mobile
| Item | Implementation | Verified by |
|---|---|---|
| CricHeroes team link and data import, stored per team | `modules/cricheroes`, web `CricHeroesSection`, mobile `components/CricHeroes.tsx` | `tests/api/test_cricheroes.py` (3), `tests/unit/test_cricheroes.py` (13), Playwright captain journey |
| Automatic CricHeroes fetch | **Not enabled.** No public API exists, the site's ToS prohibits scraping, and the PyPI package is broken. A pluggable `CricHeroesSource` is in place. | Sync returns 503 (tested); a fake source path is tested |
| Default location Noida | `DEFAULT_CITY` / `DEFAULT_LOCATION` in `@cm/shared`. Dev flags `VITE_USE_DEFAULT_LOCATION` and `EXPO_PUBLIC_USE_DEFAULT_LOCATION` make "use my location" return Noida. Seed data moved to Noida sectors. | Seed run, Playwright, screenshots |
| iOS and Android app | `eas.json` profiles (simulator, preview, production), bundle id `com.cricketmarvels.play`, build numbers. Mobile team detail and create-team screens added. | `expo export` for both iOS and Android, expo-doctor 20/20, tsc, jest |
