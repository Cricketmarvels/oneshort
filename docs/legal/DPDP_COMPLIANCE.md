# GoFindr: DPDP Act 2023 compliance map

Last updated: 9 November 2026. This file maps each obligation to how GoFindr meets it. It is an engineering record, not legal advice; Indian counsel should review the Terms and Privacy Notice before launch.

**Status key**
- **Done**: built and covered by tests.
- **Set at launch**: needs configuration or a business decision before going live.
- **Process**: an operating procedure, not code.

## Laws and dates

| Instrument | What it covers | Applies from |
|---|---|---|
| Digital Personal Data Protection Act, 2023 | Notice, consent, rights, security, breaches, children | With the Rules below |
| DPDP Rules, 2025 (notified 13–14 Nov 2025) | Detailed duties | Board provisions: immediately. Consent managers: ~13 Nov 2026. Data Fiduciary duties: ~13 May 2027 |
| IT Act 2000 and IT (Intermediary Guidelines) Rules, 2021 | Grievance officer for user content (posts, chat, photos) | In force |

## Obligations

| # | Obligation | How GoFindr meets it | Where | Status |
|---|---|---|---|---|
| 1 | Itemised notice in clear language (s.5, Rule 3) | Privacy Notice v1 lists each data category with its purpose, sharing, storage location, retention, rights, how to complain, and the Board. Readable before sign-up. | `app/modules/agreements/legal.py`, `/legal/privacy` | Done |
| 2 | Notice available in English or any Eighth Schedule language (s.5(3)) | The notice explains how to ask for another language. A Hindi translation should be published for launch. | Privacy Notice §10 | Set at launch |
| 3 | Consent that is free, specific, informed and an affirmative action (s.6) | Three separate, unticked switches: Terms, Privacy Notice, 18+. The API rejects acceptance without them. | `agreement.tsx`, `AgreementService.accept` | Done |
| 4 | Proof of consent | Each acceptance records the version, a SHA-256 of the exact text shown, the age confirmation, time, IP and user agent. It is also written to the audit log. | `user_agreements` collection | Done |
| 5 | Re-consent when the notice changes | Publishing a higher material version blocks matchmaking until the user accepts it. Startup publishes the current version. | `seed_default`, `require_matchmaking` | Done |
| 6 | Withdrawing consent as easy as giving it (s.6(4)) | Optional features (WhatsApp) are switched off in settings. A "Withdraw consent" request is available, and account deletion withdraws everything. | `/privacy` | Done |
| 7 | Right to access (s.11) | "Download my data" gives an instant JSON export. An "access" request covers summaries and sharing details. | `/users/me/export`, `/privacy/requests` | Done |
| 8 | Right to correction and erasure (s.12) | Profile editing. Correction and erasure requests. Account deletion anonymises the account and erases posts, chat messages, notifications, availability, racket-sport profile and devices. Ratings and fee records stay, shown as "Deleted player". | `UserService.delete_account` | Done |
| 9 | Grievance redressal (s.13). Respond within 90 days (Rule 14). | Requests get a reference, a 30-day internal target and a 90-day legal deadline. An admin queue sorts by deadline and flags overdue requests. Every step is audited. | `app/modules/privacy/router.py` | Done |
| 10 | Right to nominate (s.14) | A "Nominate someone" request records the nominee's name and contact. | `/privacy` | Done |
| 11 | Contact for questions: Grievance Officer (Rule 9; IT Rules 3(2)) | Name, email and address come from settings. Production refuses to start without them. | `LEGAL_ENTITY_NAME`, `LEGAL_ENTITY_ADDRESS`, `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_EMAIL` | Set at launch |
| 12 | IT Rules: acknowledge content complaints in 24 h, resolve in 15 days | Stated in the Terms §13. In-app reports and moderation exist. Operations must meet the timeline. | Reports module, admin queue | Process |
| 13 | Children: verifiable parental consent; no tracking or targeted ads (s.9, Rule 10) | GoFindr is 18+ only. Users confirm their age, and accounts found to be under 18 are closed. No advertising or behavioural tracking exists. Supporting under-18 players later needs a parental-consent flow (Rule 10) first. | Terms §2, Notice §8 | Done (18+ policy) |
| 14 | Reasonable security safeguards (s.8(5), Rule 6) | TLS. Hashed passwords and OTPs. Role and ownership checks (IDOR tests). Rate limits and login lockout. Images re-encoded with EXIF/GPS stripped. Request size caps. Logs redacted. Sentry scrubbed. Security headers. | `SECURITY_DESIGN.md`, tests | Done |
| 15 | Keep personal data, traffic data and logs for at least one year (Rule 6/8) | Audit logs have no TTL. WhatsApp delivery logs are kept 400 days. Access logs must be kept 1 year in the log platform. Consent records are kept. | `indexes.py`, hosting config | Done (code) / Set at launch (log platform) |
| 16 | Erasure when the purpose ends; 48 h notice before inactivity erasure (Rule 8) | The deletion path exists. Inactivity erasure is not switched on. If enabled, it must send a 48-hour warning first (stated in Notice §6). | — | Process |
| 17 | Breach intimation: affected people promptly, Board within 72 h (s.8(6), Rule 7) | Runbook in `BREACH_RESPONSE.md`. Sentry alerts and audit logs support detection. | `docs/legal/BREACH_RESPONSE.md` | Process |
| 18 | Processors under contract (s.8(2)) | Hosting, SMS/WhatsApp provider and Sentry need Data Processing Agreements. Sentry gets only scrubbed data. | Notice §4 | Set at launch |
| 19 | Cross-border transfer (s.16) | Aim to host in India (e.g. Mumbai region). Processors only in non-restricted countries. | Notice §5 | Set at launch |
| 20 | Significant Data Fiduciary duties (DPO, DPIA, audit) | Only if notified as an SDF. Not expected at launch scale. | — | Not applicable now |

## Retention schedule

| Data | Kept for | Enforced by |
|---|---|---|
| Account, profile, sport data | While the account is open; erased or anonymised on deletion | `delete_account` |
| Posts and chat messages | While the account is open; erased on deletion | `delete_account` |
| Ratings, match results, fee records | Kept, pseudonymised ("Deleted player"), so other people's records stay correct | — |
| OTP codes | Minutes (TTL); send log 1 h | TTL indexes |
| Failed-login records | Up to 24 h | TTL index |
| Refresh tokens | Until expiry (30 days) | TTL index |
| Notifications | 180 days | TTL index |
| WhatsApp outbox (simulator only) | 24 h | TTL index |
| WhatsApp delivery events (processing logs) | 400 days (at least 1 year) | TTL index |
| Audit logs and consent records | At least 1 year; review yearly | Manual review |
| Application access logs | 1 year in the log platform | Hosting config |
| Database backups | 35 days point-in-time; monthly snapshots 12 months | See `DATABASE_RELIABILITY.md` |
| Privacy requests | 3 years after resolution (evidence of compliance) | Manual review |

## Before launch

1. Set the four legal settings (company name, address, Grievance Officer, privacy email).
2. Have counsel review the Terms v2 and Privacy Notice v1 wording, and publish a Hindi translation.
3. Sign DPAs with the hosting, SMS/WhatsApp and Sentry providers. Host in India.
4. Configure 1-year log retention in the log platform.
5. Name the people who handle the privacy queue and breach response, and run one breach drill.
