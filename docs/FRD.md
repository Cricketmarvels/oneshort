# Functional Requirements Document (FRD)

**Product:** CricketMarvels Play: Hyperlocal Cricket Matchmaking & Team Management Platform
**Version:** 1.0 (MVP) · **Market:** India first · **Platforms:** Web, iOS, Android

This document is the condensed, numbered version of the master specification, which remains authoritative.
Every requirement has an ID that is used in the traceability matrix in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#traceability-matrix).

## 1. Roles

| ID | Requirement |
|---|---|
| FR-ROLE-1 | One account per person. The account can act as a Player, a Captain, or both. There are no separate role accounts. |
| FR-ROLE-2 | Permissions come from the relationship to the resource (team captain, team admin, match captain, roster member), not only from global roles. |
| FR-ROLE-3 | A team captain can delegate admin functions to team admins: roster, fees, and payment marking. |
| FR-ROLE-4 | A platform `admin` role handles moderation. |

## 2. Registration & onboarding

| ID | Requirement |
|---|---|
| FR-REG-1 | Register with a mobile number and verify it by OTP. |
| FR-REG-2 | Email is required on the profile. Email + password login is supported as an alternative. |
| FR-REG-3 | Secure login and logout, short-lived access tokens, and refresh token rotation. |
| FR-REG-4 | Password recovery (by OTP to the registered mobile) for accounts that set a password. |
| FR-PLY-1 | Mandatory player profile fields: full name, mobile, email, profile picture, city, primary role, location (with permission). |
| FR-PLY-2 | Optional fields: batting style, bowling style, years of experience, formats, days, timing, CricHeroes URL, previous teams, bio. |
| FR-PLY-3 | Roles: Batsman, Bowler, Wicketkeeper, All-rounder. One primary role and any number of secondary skills. |
| FR-CAP-1 | Captain profile with one or more teams: name, logo, description, location, category, members. |
| FR-AGR-1 | The Platform User Agreement must be accepted before any matchmaking feature can be used. |
| FR-AGR-2 | Record the user ID, agreement version, acceptance timestamp, IP, and user agent. |
| FR-AGR-3 | A material update to the agreement requires the user to accept it again. Agreement content is configurable (stored in the DB and seeded). |

## 3. Home & navigation

| ID | Requirement |
|---|---|
| FR-HOME-1 | Four primary actions: Find a Player, Find a Team, Split a Fee, Build a Team. |
| FR-HOME-2 | Sections: Upcoming Matches, My Teams, My Availability, Pending Invitations, Pending Join Requests, Pending Payments, Recent Activity, Notifications. |
| FR-HOME-3 | Primary navigation: Home, Discover, Matches, Teams, Profile. |

## 4. Find a Player

| ID | Requirement |
|---|---|
| FR-FP-1 | Filters: match (date, start, end, venue), radius 5/10/15/20 km, roles, number required, format, fee, minimum rating, availability. |
| FR-FP-2 | The search origin is the match venue. Distance is a **hard** constraint: no result lies outside the radius. |
| FR-FP-3 | Availability means real time overlap with the match window. A matching date alone is not enough. |
| FR-FP-4 | Results are ranked by a configurable engine: distance, overlap, role fit, rating, reliability, participation, response rate. |
| FR-FP-5 | Exact player coordinates are never exposed. Only an approximate distance is shown. |
| FR-FP-6 | The captain sets each invitee as Payee or Non-Payee, and the player sees this before accepting. |
| FR-AV-1 | A player can have multiple availability slots: date, start, end, preferred location, max travel distance, status (Available / Unavailable / Tentative). |
| FR-AV-2 | Overlapping or duplicate slots are rejected. Times are stored in UTC and displayed in the user's timezone. |
| FR-AV-3 | Users control the visibility of their availability (discoverable or private). |

## 5. Find a Team

| ID | Requirement |
|---|---|
| FR-FT-1 | Filters: date, time window, location, radius, role, format, max fee, category (Corporate/Friendly/Tournament/Practice). |
| FR-FT-2 | Results are open match opportunities with vacancies, plus team info (name, logo, captain, area, category, timing, required roles, vacancies, format, fee, rating). |
| FR-FT-3 | A player requests to join, the captain is notified and accepts or rejects, and the player is notified. |

## 6. Build a Team

| ID | Requirement |
|---|---|
| FR-BT-1 | Create a match: team, date, start/end, venue, format, players required, estimated expenses, description. Each match gets a unique human-readable ID. |
| FR-BT-2 | Selection method A: existing team members (search, role filter, availability check, multi-select). |
| FR-BT-3 | Method B: the Find a Player engine, reused. |
| FR-BT-4 | Method C: previous match participants who are currently available. |
| FR-BT-5 | Visual squad composition (e.g. 4 BAT / 3 BOWL / 1 WK / 3 AR), configurable, and capacity cannot be exceeded. |
| FR-INV-1 | Invitation states: Pending, Accepted, Rejected, Expired, Cancelled, Confirmed. Only valid transitions are allowed. |
| FR-INV-2 | No duplicate active invitations. No invitations to players marked unavailable. No overbooking, even under concurrency. |
| FR-INV-3 | Substitute invitations, player replacement, withdrawal, and invitation cancellation. |

## 7. Split a Fee (manual tracking only, with no payment gateway)

| ID | Requirement |
|---|---|
| FR-FEE-1 | Expenses with an itemised breakdown. Additional expenses can be added. |
| FR-FEE-2 | Contribution = eligible total / eligible players. Integer paise. Rounding adjustments are explicit. |
| FR-FEE-3 | Exemptions (non-payee) and manual per-player adjustments. |
| FR-FEE-4 | The captain reviews a draft and then publishes it. A published settlement is immutable, and changes create a revised settlement. |
| FR-PAY-1 | Captain dashboard: expenses, total, eligible players, per-head amount, collected, outstanding, per-player status. |
| FR-PAY-2 | Only the captain or a delegated team admin can mark Paid or Exempted. Every change records who made it and when, writes an audit entry, notifies the player, and updates the dashboard. |
| FR-PAY-3 | A wrongly recorded status can be corrected, with a mandatory reason and an audit trail. |
| FR-PAY-4 | Player dashboard: outstanding, history, and exemptions across all teams. |
| FR-PAY-5 | Players can raise fee discussions and disputes. Statuses: Pending, Paid, Exempted, Disputed. |
| FR-PAY-6 | WhatsApp sharing: settlement summary, individual reminders, payment instructions (deep link or native share). Delivery is never claimed. |
| FR-PAY-7 | Manual payments are never shown as gateway-verified. No bank credentials or UPI PINs are stored. |

## 8. Match management

| ID | Requirement |
|---|---|
| FR-MAT-1 | Lifecycle: Draft → Published → Player Recruitment → Squad Confirmed → Scheduled → In Progress → Completed, with Cancelled possible from any non-terminal state. |
| FR-MAT-2 | Rescheduling, replacement, captain cancellation, player withdrawal, history, participation records. |
| FR-MAT-3 | Only authorised users can change a match's status. |

## 9. Reputation

| ID | Requirement |
|---|---|
| FR-REP-1 | Player ratings: punctuality, behaviour, sportsmanship, participation, overall. |
| FR-REP-2 | Captain ratings: behaviour, fair opportunities, team management, communication, punctuality, overall. |
| FR-REP-3 | Only verified participants of a completed match can rate. One review per reviewer, reviewee, and match. |
| FR-REP-4 | Reliability score from attendance, punctuality, participation, sportsmanship, and cancellation history. |
| FR-REP-5 | Ratings can be moderated (hidden or restored), and aggregates are recomputed. |

## 10. Safety & moderation

| ID | Requirement |
|---|---|
| FR-SAF-1 | Report categories: abusive language, physical misconduct, harassment, threats, unsportsmanlike behaviour, financial misconduct, repeated no-shows. |
| FR-SAF-2 | Admin: view and investigate reports, keep notes, warn, suspend temporarily or permanently, restrict matchmaking. |
| FR-SAF-3 | The facilitator disclaimer (no guarantee of matches or of conduct) is shown in the agreement, worded "to the extent permitted by applicable law". |

## 11. Notifications

| ID | Requirement |
|---|---|
| FR-NOT-1 | In-app notifications for: invitation, join request, acceptance, rejection, confirmation, reminder, cancellation, replacement, settlement created, marked paid, payment reminder, dispute, rating received, report update. |
| FR-NOT-2 | Push through an FCM adapter. Real-time updates over WebSocket for invitations, roster, fees, and membership. |
| FR-NOT-3 | Per-user notification preferences. |

## 12. Privacy

| ID | Requirement |
|---|---|
| FR-PRV-1 | Location is used only with permission, never exposed, and never logged. |
| FR-PRV-2 | The full venue address is visible only to the captain, invitees, and roster members. Everyone else sees the area and city. |
| FR-PRV-3 | Account deletion (PII is anonymised and financial and audit records are kept in pseudonymised form) and data export. |

## Assumptions (documented decisions)

1. **No FRD file was provided separately.** The master specification is the FRD. The earlier Node/Express prompt was superseded by the Python/FastAPI prompt, and online payments are out of scope.
2. **Project location.** `~/cricketmarvels` holds an unrelated marketplace prototype, so this platform lives in `cricketmarvels/platform/` and does not touch it.
3. **Join requests** are invitations with `direction = "request"`. When a captain accepts a request, it is confirmed directly, subject to capacity. A captain-sent invitation goes Pending → Accepted (by the player) → Confirmed (by the captain).
4. **Invitations and availability.** Inviting a player who has an overlapping *Unavailable* slot is always rejected. Discovered (non-member) players must have an Available or Tentative slot that covers the match. Existing team members with no slot at all can be invited and are shown as "availability unknown".
5. **Availability coverage.** By default a slot must cover the full match window. The captain can enable `allow_partial` to accept at least 50% overlap, which is ranked lower.
6. **Captain in the squad.** `captain_plays` defaults to true. The captain then takes one squad slot and is a payee by default.
7. **Ratings** are stored as one document per review, with a `scores` map per category, rather than one document per category. This makes duplicate prevention atomic.
8. **AI usage.** Ranking is deterministic and explainable, as the specification requires. An optional AI assistant (Claude, behind a provider interface and disabled unless `ANTHROPIC_API_KEY` is set) gives admins advisory triage for misconduct reports. It never takes moderation actions on its own.
9. **Maps.** The dev build uses Leaflet + OpenStreetMap tiles (no key needed). Mapbox or Google tiles and geocoding sit behind configuration and provider interfaces. Venue search uses seeded grounds plus picking a point on the map.
10. **Legal text.** The seeded agreement is a draft and must be reviewed by legal counsel before public launch.
