# PlayR redesign: implementation report

Scope: cricket-only MVP. The FastAPI + MongoDB backend is extended rather than rewritten; every pre-existing endpoint still works and passes its tests. The Expo mobile app is fully redesigned. The React web app compiles against the new API but keeps its previous design.

## Screens (mobile, `mobile/src/app`)
| Screen | What it does |
|---|---|
| Login | PlayR identity and tagline; email/password or OTP |
| **Home** | Greeting and locality; rating card (rating, ±RD, provisional/verified badge, rank in city and within 10 km); quick actions (Challenge a Team, Find Players, Matches, Teams, Leaderboard, Create a Community); Needs your attention (results to verify, challenges awaiting you); Player of the Week (biggest verified 7-day gain within 50 km, omitted when nobody qualifies); upcoming fixtures; top players nearby; active challenges; teams looking for a game; community activity |
| **Leaderboard** | Players/Teams; location selector (device or manual area); 5/10/20/50 km, city, state, national; 7 categories; format filter sheet; top-3 podium; "your position" card; rank movement, confidence bar, sparkline; actions: View, Compare, Invite; demo-data banner; integrity footer |
| Player profile | Rating ring filled by confidence; batting/bowling/fielding/impact bars with RD and match counts; all-round and consistency; "why your rating moved"; rating trend chart; recent-form bars; per-format ratings; verified career stats; teams; match history with per-match deltas and reasons |
| Compare | Radar chart plus side-by-side bars (ratings, form, consistency, experience, runs, wickets) |
| **Team dashboard** | Header: rating, city rank, win %, record, streak, form. Overview: needs action, join requests, active challenges, fixtures, rating history, CricHeroes. Roster: ratings, 7-day availability dot, captain/vice-captain, invite by mobile, make/remove vice-captain, remove. Performance: record, player contributions table, rivalries (head-to-head), recent results |
| **Challenge a team** | Pick opponent (distance, rating band, format, name), then propose date, time, venue, format/overs and conditions; send or save as draft |
| Challenge detail | Status timeline; current proposal; actions that depend on who must act (accept / counter / decline / confirm / cancel); proposal history |
| Match centre | Teams, scores, summary, verified/awaiting/disputed state, verify (with confirmation), dispute (with reason), full scorecards |
| Submit result | Result type, winner, batting order, innings totals, per-player batting/bowling/fielding entry for both teams |
| My Games | Upcoming (awaiting result + scheduled), Results, Challenges (incoming/sent/closed), Pickup games |
| Discover | Matches (open pickup games), Players, Teams (with challenge buttons), Groups |
| **Community** | Mine plus nearby. Detail: join with guidelines and disclaimer; Feed (post/match; announcements, polls and tournaments for staff); voting; report/remove/block; Members (approve requests, roles, remove, ban); Teams (add your team, approve); Rankings |
| Profile (avatar) | My teams, availability, contributions, notifications, home area, notification preferences per category, log out, delete account |
| Notifications | Typed icons, unread markers, deep links to the match, challenge, community or team |
| How ratings work | Plain-language methodology |

Design system: `theme.ts` (tokens #171A1B / #C8FA52 / #FFFFFF / #F5F5F0 / #232728 / #777777; Manrope headings, Inter body) and `components/ui.tsx` (Button/PrimaryButton, IconButton, Field, SearchBar, Card, Chip/ChipRow, Segmented, Badge, Avatar, EmptyState, Skeleton/LoadingSkeleton, Stat, Section). Data visualisations are in `viz.tsx` (Sparkline, RatingRing, ConfidenceBar, Movement, FormPills, PlayerPerformanceChart, FormBars, RadarChart, CompareBar) and cricket components in `cricket.tsx` (SkillBadge, RatingConfidenceBadge, ChallengeStatusBadge, DemoBanner, LocationSelector, Podium, PlayerLeaderboardCard, TeamLeaderboardCard, PlayerRatingCard, TeamChallengeCard, MatchCard, HeadToHeadCard, CommunityCard, CommunityFeedItem, NotificationItem). `sheet.tsx` has FilterBottomSheet (@gorhom/bottom-sheet), ConfirmationModal and PromptModal; `proposal.tsx` has the proposal form.

## Database changes
New collections (indexes in `infrastructure/database/indexes.py`):
- `team_challenges`: unique partial `slot_key`, so there is one active challenge per team pair per IST day, even under concurrent requests.
- `fixtures`: result and scorecard embedded, so verification is atomic; `result_history` keeps superseded submissions.
- `player_ratings` and `player_rating_history`.
- `team_ratings` and `team_rating_history`.
- `communities` (2dsphere), `community_members`, `community_teams`, `community_posts`, `community_poll_votes`, `community_post_reports`, `user_blocks`.

Changes to existing collections:
- `teams`: added `looking_for_opponents` and `preferred_formats`.
- `team_members`: new status `requested`, for join requests.
- `player_profiles`: added `locality`, which is shown publicly.

All writes are audited: challenge transitions, result submit/verify/dispute/resolve, rating application, community moderation and role changes.

## API (all under `/api/v1`)
- Leaderboards: `GET /players/leaderboard`, `/players/compare`, `/teams/leaderboard`, `/teams/compare`, `/teams/discover`.
- Teams: `/teams/{id}/dashboard`, `/teams/{id}/head-to-head/{other}`, `POST /teams/{id}/join-requests` (+ `/{player}/approve|decline`).
- Ratings: `/ratings/players/{id}`, `/ratings/players/{id}/history`.
- Challenges: `POST/GET /challenges`, `GET /challenges/{id}`, `POST /challenges/{id}/send|accept|counter-propose|reject|confirm|cancel`.
- Fixtures: `GET /fixtures`, `GET /fixtures/{id}`, `POST /fixtures/{id}/result|verify|dispute|cancel`.
- Admin: `GET /admin/fixtures/disputed`, `POST /admin/fixtures/{id}/resolve`.
- Communities: `POST /communities`, `GET /communities/discover`, `GET/PUT /communities/{id}`, `join`, `leave`, `members` (+ approve/decline/role/remove/ban), `teams` (+ approve), `feed`, `posts` (+ vote/report/delete), `leaderboard`.
- Blocking: `POST/DELETE /users/{id}/block`.
- Home: `GET /home`.

Existing auth, rate limiting, pagination and validation apply. Coordinates are never returned; distances are rounded to 0.5 km. "Match" in the directive maps to `fixtures` (team vs team). The existing `matches` module stays as pickup games.

## Test results
- **Backend:** 156 passed; ruff and mypy (strict) clean.
  - Rating engine: 12 unit tests (see RATING_METHODOLOGY.md).
  - Challenge workflow: permissions; duplicate prevention in both directions (`DUPLICATE_CHALLENGE`); counter → accept → confirm by the proposer; fixture appears for both teams' members; schedule clash within 4 h (`SCHEDULE_CONFLICT`); drafts hidden from the opponent; decline; cancelling a confirmed challenge cancels its fixture.
  - Result verification: no result before the start time; scorecard validation (winner runs, non-members); only managers submit; the submitter can't verify; a dispute holds the result with ratings untouched; a corrected resubmission then verification applies ratings; double verification is rejected; admin void recomputes ratings; admin confirm of a disputed result is audited.
  - Leaderboards: 5 km vs 10 km radius, city, format eligibility, no coordinates in the payload, `LOCATION_REQUIRED`, team ranks and form, compare, head-to-head, dashboard join-request permissions, home.
  - Community permissions: private feed/members hidden from outsiders; guidelines must be accepted; pending → approve by staff only; members can't post announcements; only the owner/admin promotes; one vote per user; author/moderator removal; report once; moderators see report counts; blocking hides posts; role hierarchy for remove/ban; banned users can't rejoin; the owner can't leave; public instant join; distance-rounded discovery; empty leaderboard when there's no data.
- **Mobile:** `tsc --noEmit` clean, jest 2/2, `expo-doctor` 20/20. iOS and Android release bundles export successfully. All 22 screens render with no page or console errors in WebKit at iPhone 17 size (402×874 @3x) against the seeded API.
- **Web:** `tsc` clean, Vitest passing.

## Screenshots
`docs/screenshots/playr/` (WebKit, iPhone 17 viewport, rendered from the React Native code via react-native-web).

## Not done / outstanding
- Not tested on a physical iPhone or Android device, or in simulators. Xcode and the Android SDK aren't installed on this Mac. The public Expo Go link is ready for a device test.
- The directive's gluestack UI v5 and NativeWind v5 were not adopted. I kept a token-based StyleSheet design system to avoid a styling-framework migration on RN 0.88 / Expo SDK 58; every token lives in `theme.ts`, so a later migration is mechanical. React Hook Form and Zod were not added (forms are small); Zustand is used for location state.
- The app icon and splash are still the default Expo assets; final PlayR artwork is needed.
- The web app keeps the earlier design; only the mobile app is redesigned.
- Payment tracking is the existing per-match offline contribution tracker (pickup games). It isn't yet attached to team fixtures.
- Tournaments (P2) are only posts in communities; there is no bracket management.
- The rating weights and pars are initial values; calibrate them once real verified data exists. Phase 2 ML stays off until then.
- The State scope relies on a city→state lookup (`common/regions.py`); unknown cities appear only in City and National scopes.
- Team rank movement and player movement compare each entry's score before its last match, an approximation of "since last week".
- Demo data: 30 fixtures and the live challenges in the dev seed are generated and flagged `is_demo`, and the app labels them. They must never be seeded in production; the seed refuses to run there.
- The legal wording of the community and platform disclaimers needs review by a lawyer.
