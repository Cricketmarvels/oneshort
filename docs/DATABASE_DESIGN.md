# Database Design (MongoDB 8)

All timestamps are UTC `datetime`, and each schedulable entity stores its own `timezone` (IANA, for example `Asia/Kolkata`).
Money is stored as `int` paise (`*_paise`) with `currency: "INR"`.
Locations are GeoJSON `{type: "Point", coordinates: [lng, lat]}`, longitude first.
Indexes are created idempotently at startup (`app/infrastructure/database/indexes.py`), and JSON-schema validators are applied to the critical collections.

## ERD (logical)

```
users 1─1 player_profiles          users 1─1 captain_profiles
users 1─* teams (captain_id)       teams 1─* team_members *─1 users
teams 1─* matches                  matches 1─* match_rosters *─1 users
users 1─* availability             matches 1─* invitations *─1 users
matches 1─* expenses               matches 1─* settlements (versioned)
settlements 1─* payment_records *─1 users
payment_records 1─* payment_discussions
matches 1─* ratings (reviewer → reviewee)
users 1─* reports (reporter / target)        users 1─* user_agreements *─1 agreements
users 1─* notifications · refresh_tokens · otp_codes · devices
audit_logs (actor, entity_type, entity_id), shared by all modules
venues (seeded cricket grounds, used for venue search)
```

## Collections

### users
`_id, full_name, mobile_number (E.164), email, email_verified, mobile_verified, password_hash?, profile_image, roles: ["player"|"captain"|"admin"], city, timezone, account_status: active|suspended|restricted|deleted, suspended_until?, notification_prefs {in_app, push, email, muted_types[]}, agreement_version_accepted?, created_at, updated_at, deleted_at?`

| Index | Query pattern |
|---|---|
| `mobile_number` unique, partial `{mobile_number: {$type: "string"}}` | OTP login lookup. The partial filter lets deleted accounts (with mobile nulled) coexist. |
| `email` unique, partial (string) | Email login and duplicate prevention. |
| `account_status` | Admin moderation lists. |

### player_profiles
`_id, user_id (unique), primary_role, secondary_roles[], batting_style, bowling_style, experience_years, preferred_formats[], preferred_days[], preferred_timing, cricheroes_url, previous_teams[], bio, home_location (GeoJSON, private), city, availability_visibility: discoverable|private, stats {matches_played, invitations_received, invitations_responded, no_shows, late_withdrawals, attended}, average_rating, rating_count, rating_breakdown {category: avg}, reliability_score (0–100), _lock (int; serialises availability writes), created_at, updated_at`

| Index | Query pattern |
|---|---|
| `user_id` unique | 1:1 lookup, `$lookup` in discovery. |
| `home_location` 2dsphere | Defaults for availability and future "players near me". |

### captain_profiles
`_id, user_id (unique), bio, average_rating, rating_count, rating_breakdown, matches_captained, created_at, updated_at`

### teams
`_id, team_name, slug, logo, description, captain_id, admin_ids[], location (GeoJSON), area, city, category: corporate|friendly|tournament|practice, member_count, team_status: active|archived, average_rating, created_at, updated_at`

| Index | Query pattern |
|---|---|
| `captain_id, team_status` | "My teams". |
| `location` 2dsphere | Team discovery fallback. |
| `{team_name: "text", area: "text"}` | Team search. |

`member_ids` from the spec is replaced by the `team_members` collection plus a denormalised `member_count`, because the member list is unbounded and changes often.

### team_members
`_id, team_id, user_id, member_role: captain|admin|member, status: active|left|removed, joined_at, updated_at`
Index `(team_id, user_id)` unique (one membership doc, reactivated on rejoin). `(user_id, status)` serves "teams I belong to".

### matches
`_id, match_code (unique, e.g. CM-7K3QX9), team_id, captain_id, title, description, venue {venue_id?, name, address, area, city}, location (GeoJSON), start_at, end_at, timezone, format: T10|T20|ODI|OTHER, category, squad_capacity, required_roles {batsman, bowler, wicketkeeper, all_rounder}, estimated_expenses_paise, per_head_fee_paise (derived), default_contribution_type: payee|non_payee, captain_plays, confirmed_count, match_status, status_history[{from,to,by,at,reason}], reschedule_history[], cancelled_reason?, reminder_sent_at?, completed_at?, created_at, updated_at`

| Index | Query pattern |
|---|---|
| `match_code` unique | Share links and lookups. |
| `(team_id, start_at)` | Team match history. |
| `(captain_id, match_status, start_at)` | Captain dashboard. |
| `location` 2dsphere + `match_status, start_at` | Find a Team `$geoNear` with status and date filters. |
| `(match_status, start_at)` | Reminder scheduler and lifecycle sweeps. |

### match_rosters
`_id, match_id, player_id, assigned_role, contribution_type: payee|non_payee, status: confirmed|withdrawn|removed|replaced, is_active (bool), is_captain, source: invitation|request|captain, invitation_id?, replaced_by?, attendance?: present|late|no_show, joined_at, updated_at`
- `(match_id, player_id)` unique, partial `{is_active: true}`, which allows only one active seat per player.
- `(player_id, status)` serves the player's match history.

### availability
`_id, player_id, start_at, end_at, timezone, status: available|unavailable|tentative, location (GeoJSON), location_label, max_travel_km, visibility (copied from profile at write time, updated on change), note, created_at, updated_at`
- `location` 2dsphere, compound with `(status, start_at, end_at)`, is the `$geoNear` index for Find a Player.
- `(player_id, start_at)` serves "my availability" and the overlap check.
- `(player_id, start_at, end_at)` unique gives idempotency against double submission.
- TTL: slots that ended more than 180 days ago are purged by the scheduler (the data is not needed for history).

### invitations
`_id, match_id, team_id, captain_id, player_id, direction: invite|request, invitation_status, is_active, contribution_type, proposed_role, message, is_substitute, replaces_player_id?, invited_by, invited_at, responded_at?, confirmed_at?, expires_at, status_history[], cancel_reason?`
- `(match_id, player_id)` unique partial `{is_active: true}` stops duplicate active invitations (active = pending, accepted, confirmed).
- `(player_id, invitation_status, invited_at)` serves the player's inbox.
- `(match_id, invitation_status)` serves the captain's view.
- `(invitation_status, expires_at)` serves the expiry sweep.

### expenses
`_id, match_id, label, category: ground|balls|umpire|refreshments|equipment|travel|other, amount_paise, notes, added_by, created_at, deleted_at?`. Index `(match_id)`.

### settlements
`_id, settlement_code, match_id, team_id, captain_id, version, revises_settlement_id?, settlement_status: draft|published|superseded, expenses_snapshot[], total_expenses_paise, eligible_players, individual_contribution_paise, rounding_mode, rounding_adjustment_paise, lines[{player_id, name, contribution_type, adjustment_paise, amount_paise, credited_paise}], payment_instructions, created_by, created_at, published_at?, superseded_at?`
- `(match_id, version)` unique.
- `(match_id, settlement_status)`: at most one `draft` and one `published` per match, enforced by partial unique indexes.

### payment_records
`_id, settlement_id, match_id, team_id, player_id, captain_id, amount_paise, credited_paise, currency, status: pending|paid|exempted|disputed, method?: cash|upi|phonepe|gpay|paytm|bank_transfer|other, verification: "manual_captain_confirmed", updated_by, updated_at, remarks, status_history[{from,to,by,at,reason}], dispute? {reason, raised_at, resolved_at, resolution}`
- `(settlement_id, player_id)` unique.
- `(player_id, status, updated_at)` serves the player payment dashboard.
- `(captain_id, status)` serves the captain's pending collections.

### payment_discussions
`_id, payment_record_id, settlement_id, author_id, message, created_at`. Index `(payment_record_id, created_at)`.

### ratings
`_id, match_id, reviewer_id, reviewed_user_id, rating_type: player|captain, scores {category: 1..5}, overall, comment, status: visible|hidden, moderation? {by, at, reason}, created_at`
- `(match_id, reviewer_id, reviewed_user_id)` unique prevents duplicate reviews.
- `(reviewed_user_id, rating_type, status)` serves reputation pages and aggregate recomputation.

### notifications
`_id, user_id, type, title, body, data {}, read_at?, created_at`. Index `(user_id, read_at, created_at)`, with a TTL of 180 days on `created_at`.

### reports
`_id, report_code, reporter_id, target_user_id, match_id?, category, description, evidence_urls[], status: open|investigating|resolved|dismissed, ai_triage? {severity, summary, suggested_action, model, created_at, advisory: true}, investigation_notes[{by, note, at}], actions[{action, by, at, until?, reason}], created_at, updated_at`. Indexes: `(status, created_at)` and `(target_user_id)`.

### agreements / user_agreements
`agreements: _id, version (unique), title, sections[{heading, body}], is_current, is_material, published_at`
`user_agreements: _id, user_id, agreement_version, accepted, accepted_at, ip, user_agent`, with index `(user_id, agreement_version)` unique. These records are never deleted; they are legal evidence.

### audit_logs
`_id, actor_id, action, entity_type, entity_id, previous_value, new_value, request_id, ip, timestamp`. Indexes: `(entity_type, entity_id, timestamp)` and `(actor_id, timestamp)`. The collection is append-only and the application performs no updates or deletes on it. Retention is 7 years for financial entries (configurable).

### Auth support collections
- `otp_codes`: `_id, mobile_number, purpose, code_hash, attempts, expires_at, created_at`. TTL on `expires_at`. Index `(mobile_number, purpose)`.
- `refresh_tokens`: `_id (jti), user_id, family_id, token_hash, revoked_at?, replaced_by?, expires_at, user_agent`. TTL on `expires_at`. Indexes `(family_id)` and `(user_id)`.
- `devices`: `_id, user_id, platform, push_token (unique), last_seen_at`.

### venues
Seeded cricket grounds: `_id, name, address, area, city, location`. Indexes: 2dsphere and text on `(name, area)`.

## Transactions
| Operation | Documents touched |
|---|---|
| Confirm invitation / accept join request | matches (count guard), invitations, match_rosters |
| Withdraw / remove / replace player | match_rosters, matches (count), invitations |
| Publish settlement | settlements (draft→published, prev→superseded), payment_records (bulk insert) |
| Mark paid / exempt / correct / dispute | payment_records, audit_logs |
| Create availability | player_profiles (`_lock` bump), availability |
| Submit rating | ratings, profile aggregates |
| Account deletion | users, player_profiles, availability, invitations, refresh_tokens |

## Data retention
| Data | Retention |
|---|---|
| OTP codes | 5 min (TTL) |
| Refresh tokens | Token lifetime (TTL) |
| Notifications | 180 days |
| Past availability | 180 days |
| Audit logs, payment records, agreements | Kept (legal/financial). PII is pseudonymised on account deletion. |

## cricheroes_teams
One document per team: `team_id` (unique), `link {external_team_id, slug, url, linked_at, linked_by}`, `snapshot {team_name, team_logo, players[], matches[], stats[], leaderboard{batting,bowling,fielding}, method, imported_at, imported_by}`, `updated_at`. Writes are restricted to team managers; see docs/INTEGRATIONS_CRICHEROES.md.
