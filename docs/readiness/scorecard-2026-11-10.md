# OneShort launch readiness — 2026-11-10 (develop, after 94a1d94)

Scored with the `playr-launch-readiness` skill: fresh evidence from `collect_evidence.sh` (full run, both test suites executed) against its fixed rubric. Previous reference: the table from 2026-11-09 pasted by the owner.

| Area | Score | Change | Why (evidence) |
|---|---|---|---|
| Features | 8 | = | All cricket journeys plus onboarding, CricHeroes, privacy pass end to end (10/10 Playwright). Badminton/pickleball still 2 screens deep. Push journey not device-verified |
| Quality and testing | 7.5 | = | 224 backend tests pass, ruff + mypy clean, 10 e2e journeys pass, mobile typecheck clean. CI has never run on GitHub (17 commits unpushed); mobile has 2 unit tests |
| Security and privacy | 8.5 | +1 | **Updated same day:** phone-number enumeration (H2) fixed — every sign-in/sign-up reply is identical for registered and unknown numbers (226 backend tests, 11/11 e2e). No open Critical/High. Residual Medium: invite-link sign-up reveals existence (needs a valid link, rate-limited). Pasted GitHub tokens not yet confirmed rotated |
| Data and performance | 8 | +1 | Query-plan audit (no hot-path scans), caps, failover drill with 0 lost writes, backup + restore verified. Backups not scheduled (0 jobs); no load test |
| Production setup | 2.5 | = | Still a Mac behind a temporary tunnel (it went down overnight and was restarted with new links). Console OTP, WhatsApp simulator, push off, local media, no Sentry DSN, no fixed domain |
| App store distribution | 3 | +1 | Bundle ids, EAS profiles, splash, production API URL, push code client + server in place. No EAS project id, no google-services.json, no builds, no store assets |
| Legal | 8 | +4.5 | OneShort Terms v2 and DPDP Privacy Notice live, 3-switch consent with fingerprints, privacy requests with 90-day deadlines, retention schedule, breach runbook, production refuses to start without legal identity. Company details unset; no counsel review or Hindi version |

## What changed since 2026-11-09
- **Legal 3.5 → 8:** final Terms (no "Draft", no "OneShort"), DPDP Privacy Notice, consent records, privacy-request system, erasing account deletion, compliance docs.
- **Data and performance 7 → 8:** failover-safe Mongo client proven by a crash drill; backup + restore-verify scripts proven (48 collections restored in 5 s).
- **App store distribution 2 → 3:** splash and per-profile API config, Expo push pipeline (tickets + receipts), deep links, device-sessions screen.
- **Security and privacy stays 7.5, for a different reason:** much stronger now (two critical takeovers fixed, sessions, budgets), but the rubric doesn't allow 8+ with a High finding open — H2 enumeration. Fixing it lifts this to 8.5.

## Out of date in the previous table
- "202 backend tests, 8 end-to-end tests" — now 224 and 10.
- "No backups" — backups and restore checks exist and are verified; they just aren't scheduled yet.
- "Needs a shared rate limiter" — built (`RATE_LIMITER_BACKEND=mongo`); not yet switched on in a deployment.
- "Agreement marked Draft and says OneShort; no DPDP privacy policy" — both resolved.
- "No push notifications" — the code is complete; delivery waits on EAS/Firebase/APNs credentials and device builds.

## Found and fixed during this audit
- The seed script broke after tester sign-ups were enabled (seeded accounts use the same fictional range). Seeding now ignores tester mode; the e2e environment turns it off.
- An empty `TESTER_SIGNUP_PREFIX=` would have treated every number as a tester number. Blank now means off; test added.

## To raise each score (next band)
| Area | Next band needs | Who |
|---|---|---|
| Features → 9 | Push invitation journey verified on a real iPhone and Android | Owner: EAS + Firebase + Apple accounts, then Claude runs the A–E device plan |
| Quality → 8.5 | Commits pushed and CI green on GitHub | Owner: new GitHub token |
| Security → 9 | Rotate the pasted GitHub tokens, switch on the shared rate limiter in a deployment, move web sessions to an httpOnly cookie | Owner rotates tokens; Claude does the rest |
| Data → 8.5 | Backups running on a schedule with an off-machine copy | Owner runs `scripts/db/schedule.sh install` and sets `BACKUP_RCLONE_REMOTE` |
| Production → 3.5 | Fixed domain via named tunnel (or scheduled backups) | Owner: domain on Cloudflare + `cloudflared tunnel login` |
| App store → 5 | EAS project id and development builds on devices | Owner: `npx eas-cli init`, then build |
| Legal → 9 | Company name, address, Grievance Officer, privacy email set | Owner provides the details |

## Blocked on the owner
- **GitHub token** with repo write access → push 17 commits; CI starts running.
- **Rotate the GitHub tokens pasted into chat earlier** (Settings → Developer settings → Personal access tokens → delete).
- **`scripts/db/schedule.sh install`** on this Mac (hourly backups, daily restore check).
- **Cloudflare:** a domain on your account + `cloudflared tunnel login`, then `scripts/cloudflare-setup.sh yourdomain.com`.
- **Expo/Firebase/Apple accounts** for push and builds (steps in `docs/design/PUSH_NOTIFICATIONS.md`).
- **Legal details** for the Terms and Privacy Notice.
- **Paid hosting approval** (Atlas + API host) for production setup above 3.5.
