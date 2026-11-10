# API Specification (v1)

> **Generated** from the running FastAPI application by `backend/scripts/gen_api_doc.py`. Do not edit by hand.
> Interactive docs: `GET /docs` (Swagger UI) · `GET /redoc` · machine-readable: `GET /api/v1/openapi.json`
> (also committed as `shared/openapi.json`, from which `shared/src/api-types.ts` is generated).

## Conventions
- Base URL `/api/v1`, JSON, `snake_case`. Datetimes are ISO-8601 with an offset (stored in UTC). Money is integer **paise**.
- Success: `{"data": …}`; paginated: `{"data": […], "meta": {page, page_size, total, has_next}}` (`?page=&page_size=`, max 100).
- Error: `{"error": {"code", "message", "details": [{field, message, type}]}, "request_id"}`, with HTTP 400/401/403/404/409/422/429.
- Auth: `Authorization: Bearer <access JWT>` (15 min). Rotate with `POST /auth/refresh`.
- **Auth** column: `public` | `user` (any authenticated, non-suspended user) | `matchmaker` (user + accepted current
  agreement + not restricted) | `admin`. **Resource rules** lists the extra checks the service layer enforces.
- Request bodies reject unknown fields and any key starting with `$` or containing `.`.

## Common error codes
| Code | When |
|---|---|
| `VALIDATION_ERROR` | Body or query failed validation (see `details`) |
| `TOKEN_EXPIRED` / `TOKEN_INVALID` | Refresh the access token / log in again |
| `AGREEMENT_REQUIRED` | Accept the current Platform User Agreement |
| `ACCOUNT_SUSPENDED` / `MATCHMAKING_RESTRICTED` | Moderation state |
| `NOT_TEAM_MANAGER` / `NOT_MATCH_MANAGER` | Resource-level authorization failed |
| `SQUAD_FULL` | Capacity guard (also under concurrency) |
| `DUPLICATE_INVITATION` / `ALREADY_IN_SQUAD` / `PLAYER_DOUBLE_BOOKED` | Invitation integrity |
| `PLAYER_UNAVAILABLE` | Invitee is unavailable or has no availability for the match window |
| `INVALID_MATCH_TRANSITION` / `INVALID_INVITATION_TRANSITION` / `INVALID_PAYMENT_TRANSITION` | State machine violation |
| `AVAILABILITY_CONFLICT` | Overlapping availability slot (`details[0].conflicting_slot_id`) |
| `SETTLEMENT_IMMUTABLE` / `SETTLEMENT_NOT_CURRENT` | Published settlements are read-only, revise instead |
| `DUPLICATE_RATING` / `NOT_VERIFIED_PARTICIPANT` / `RATING_WINDOW_CLOSED` | Reputation rules |
| `OTP_INVALID` / `OTP_EXPIRED` / `OTP_LOCKED` / `OTP_RATE_LIMITED` / `OTP_COOLDOWN` | OTP flow |
| `RATE_LIMITED` | Too many requests (`Retry-After`) |


## Authentication

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/auth/register` | Register with mobile number; sends an OTP to verify it | public |  | `RegisterIn` | `Envelope_RegisterOut_` | — |
| `POST` | `/auth/send-otp` | Send an OTP | public |  | `SendOtpIn` | `Envelope_OtpSentOut_` | — |
| `POST` | `/auth/verify-otp` | Verify OTP (completes registration or logs in) and issue tokens | public |  | `VerifyOtpIn` | `Envelope_TokenOut_` | — |
| `POST` | `/auth/login` | Email + password login | public |  | `PasswordLoginIn` | `Envelope_TokenOut_` | — |
| `POST` | `/auth/refresh` | Rotate refresh token | public |  | `RefreshIn` | `Envelope_TokenOut_` | — |
| `POST` | `/auth/logout` | Revoke the refresh token family | public |  | `RefreshIn` | 204 No Content | — |
| `POST` | `/auth/reset-password` | Reset password using an OTP | public |  | `ResetPasswordIn` | 204 No Content | — |

## Users

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/users/me` | Current user | user |  | — | `Envelope_UserOut_` | — |
| `PUT` | `/users/me` | Update current user | user |  | `UpdateMeIn` | `Envelope_UserOut_` | — |
| `POST` | `/users/me/devices` | Register a push notification device token | user |  | `DeviceIn` | 204 No Content | — |
| `GET` | `/users/me/export` | Export my data (privacy) | user |  | — | `Envelope_dict_str__Any__` | — |
| `DELETE` | `/users/me` | Delete my account (anonymises personal data) | user |  | `DeleteAccountIn` | 204 No Content | — |

## Agreements

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/agreements/current` | Current Platform User Agreement | public |  | — | `Envelope_AgreementOut_` | — |
| `POST` | `/agreements/acceptance` | Accept the agreement | user |  | `AcceptIn` | `Envelope_MyAgreementsOut_` | — |
| `GET` | `/agreements/me` | My agreement acceptances | user |  | — | `Envelope_MyAgreementsOut_` | — |

## Smart search

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/search/smart` | Natural-language search: 'I want to play on Saturday morning' | user |  | `SearchIn` | `Envelope_SearchOut_` | — |

## Leaderboards

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/players/leaderboard` | Location-based player rankings | user |  | — | `PlayerLeaderboardOut` | `scope`, `category`, `format`, `lat`, `lng`, `city`, `state`, `page`, `page_size` |
| `GET` | `/players/compare` | Compare two players | user |  | — | `Envelope_CompareOut_` | `a`, `b` |
| `GET` | `/teams/leaderboard` | Team rankings | user |  | — | `TeamLeaderboardOut` | `scope`, `lat`, `lng`, `city`, `state`, `page`, `page_size` |
| `GET` | `/teams/compare` | Compare two teams | user |  | — | `Envelope_TeamCompareOut_` | `a`, `b` |

## Ratings

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/ratings/players/{player_id}` | Player skill rating, confidence, trend and explanation | user |  | — | `Envelope_PlayerRatingOut_` | — |
| `GET` | `/ratings/players/{player_id}/history` | Per-match rating changes with reasons | user |  | — | `PagedEnvelope_RatingHistoryOut_` | `page`, `page_size` |

## Challenges

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/teams/discover` | Find teams to challenge, by distance, rating and format | user |  | — | `Envelope_list_TeamDiscoverEntry__` | `lat`, `lng`, `radius_km`, `from_team_id`, `min_rating`, `max_rating`, `format`, `q`, `purpose`, `recruiting` |
| `POST` | `/challenges` | Challenge a team | matchmaker |  | `ChallengeIn` | `Envelope_ChallengeOut_` | — |
| `GET` | `/challenges` | My teams' challenges | user |  | — | `Envelope_list_ChallengeOut__` | `box`, `status`, `team_id` |
| `GET` | `/challenges/{challenge_id}` | Challenge details | user |  | — | `Envelope_ChallengeOut_` | — |
| `POST` | `/challenges/{challenge_id}/send` | Send a draft | matchmaker |  | — | `Envelope_ChallengeOut_` | — |
| `POST` | `/challenges/{challenge_id}/accept` | Accept the proposal | matchmaker |  | — | `Envelope_ChallengeOut_` | — |
| `POST` | `/challenges/{challenge_id}/counter-propose` | Propose different date, venue, format or conditions | matchmaker |  | `CounterProposalIn` | `Envelope_ChallengeOut_` | — |
| `POST` | `/challenges/{challenge_id}/reject` | Decline | matchmaker |  | — | `Envelope_ChallengeOut_` | — |
| `POST` | `/challenges/{challenge_id}/confirm` | Confirm the accepted schedule (creates the match) | matchmaker |  | — | `Envelope_ChallengeOut_` | — |
| `POST` | `/challenges/{challenge_id}/cancel` | Cancel | matchmaker |  | — | `Envelope_ChallengeOut_` | — |

## Discovery

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/players/nearby` | Find a Player: discoverable players near you (rated or not) | user |  | — | `Envelope_list_NearbyPlayerOut__` | `lat`, `lng`, `radius_km`, `role`, `min_rating`, `available`, `q`, `sort` |
| `POST` | `/discovery/players` | Find a Player: available players within the radius of the match venue, ranked | matchmaker | match manager when match_id given | `PlayerSearchIn` | `PlayerSearchOut` | — |
| `POST` | `/discovery/teams` | Find a Team: open matches with vacancies near you | matchmaker |  | `TeamSearchIn` | `TeamSearchOut` | — |

## Teams

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/teams/{team_id}/dashboard` | Team leadership dashboard | user |  | — | `Envelope_TeamDashboardOut_` | — |
| `GET` | `/teams/{team_id}/head-to-head/{other_id}` | Head-to-head record | user |  | — | `Envelope_HeadToHeadOut_` | — |
| `POST` | `/teams` | Create a team (you become its captain) | matchmaker |  | `TeamIn` | `Envelope_TeamOut_` | — |
| `GET` | `/teams` | List teams | user |  | — | `PagedEnvelope_TeamOut_` | `scope`, `q`, `page`, `page_size` |
| `GET` | `/teams/invitations` | Teams that invited me | user |  | — | `Envelope_list_TeamOut__` | — |
| `GET` | `/teams/{team_id}` | Team profile | user |  | — | `Envelope_TeamOut_` | — |
| `PUT` | `/teams/{team_id}` | Update team (captain/admin) | matchmaker | team captain/admin | `TeamUpdateIn` | `Envelope_TeamOut_` | — |
| `GET` | `/teams/{team_id}/members` | Team members | user |  | — | `Envelope_list_TeamMemberOut__` | `q`, `role` |
| `POST` | `/teams/{team_id}/members` | Invite a player to the team | matchmaker | team captain/admin (admin role: captain only) | `AddMemberIn` | 204 No Content | — |
| `POST` | `/teams/{team_id}/membership/accept` | Accept a team invitation | matchmaker |  | — | 204 No Content | — |
| `POST` | `/teams/{team_id}/membership/decline` | Decline a team invitation | user |  | — | 204 No Content | — |
| `PUT` | `/teams/{team_id}/members/{player_id}` | Change member role (captain) | matchmaker | team captain | `UpdateMemberIn` | 204 No Content | — |
| `DELETE` | `/teams/{team_id}/members/{player_id}` | Remove a member (captain/admin) or leave the team (self) | user | self (leave) or team captain/admin | — | 204 No Content | — |
| `POST` | `/teams/{team_id}/join-requests` | Ask to join a team | matchmaker |  | — | 204 No Content | — |
| `POST` | `/teams/{team_id}/join-requests/{player_id}/approve` | Approve a join request (captain/vice-captain) | matchmaker |  | — | 204 No Content | — |
| `POST` | `/teams/{team_id}/join-requests/{player_id}/decline` | Decline a join request (captain/vice-captain) | matchmaker |  | — | 204 No Content | — |

## Fixtures

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/fixtures` | My teams' fixtures | user |  | — | `Envelope_list_FixtureOut__` | `when` |
| `GET` | `/fixtures/{fixture_id}` | Match centre | user |  | — | `Envelope_FixtureOut_` | — |
| `POST` | `/fixtures/{fixture_id}/result` | Submit the result and scorecard (captain/vice-captain of either team) | matchmaker |  | `ResultIn` | `Envelope_FixtureOut_` | — |
| `POST` | `/fixtures/{fixture_id}/verify` | Confirm the other team's result (makes it official and updates ratings) | matchmaker |  | — | `Envelope_FixtureOut_` | — |
| `POST` | `/fixtures/{fixture_id}/dispute` | Dispute the other team's result (held; ratings unchanged) | matchmaker |  | `app__modules__competition__schemas__DisputeIn` | `Envelope_FixtureOut_` | — |
| `POST` | `/fixtures/{fixture_id}/cancel` | Cancel a match | matchmaker |  | — | `Envelope_FixtureOut_` | — |

## Admin

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/admin/fixtures/disputed` | Disputed results | admin |  | — | `Envelope_list_FixtureOut__` | — |
| `POST` | `/admin/fixtures/{fixture_id}/resolve` | Resolve a disputed result (confirm, or void and recompute ratings) | admin |  | `ResolveIn` | `Envelope_FixtureOut_` | — |

## Home

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/home` | GoFindr home: rating, rank, fixtures, challenges | user |  | — | `Envelope_HomeOut_` | `lat`, `lng` |

## Communities

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/communities` | Create a community (you become its owner) | matchmaker |  | `CommunityIn` | `Envelope_CommunityOut_` | — |
| `GET` | `/communities/discover` | Find communities near you | user |  | — | `Envelope_list_CommunityOut__` | `lat`, `lng`, `radius_km`, `city`, `kind`, `q`, `mine` |
| `GET` | `/communities/{community_id}` | Community profile | user |  | — | `Envelope_CommunityOut_` | — |
| `PUT` | `/communities/{community_id}` | Update community (admins) | matchmaker |  | `CommunityUpdateIn` | `Envelope_CommunityOut_` | — |
| `POST` | `/communities/{community_id}/join` | Join (public) or request to join (private) | matchmaker |  | `JoinIn` | `Envelope_CommunityOut_` | — |
| `POST` | `/communities/{community_id}/leave` | Leave the community | user |  | — | 204 No Content | — |
| `GET` | `/communities/{community_id}/members` | Member directory | user |  | — | `Envelope_list_CommunityMemberOut__` | `status` |
| `POST` | `/communities/{community_id}/members/{user_id}/approve` | Approve a join request (moderators) | matchmaker |  | — | 204 No Content | — |
| `POST` | `/communities/{community_id}/members/{user_id}/decline` | Decline a join request (moderators) | matchmaker |  | — | 204 No Content | — |
| `DELETE` | `/communities/{community_id}/members/{user_id}` | Remove (moderators) or ban (admins) a member | matchmaker |  | — | 204 No Content | `ban` |
| `PUT` | `/communities/{community_id}/members/{user_id}/role` | Change a member's role (admins) | matchmaker |  | `MemberRoleIn` | 204 No Content | — |
| `GET` | `/communities/{community_id}/teams` | Teams in the community | user |  | — | `Envelope_list_CommunityTeamOut__` | — |
| `POST` | `/communities/{community_id}/teams` | Add your team | matchmaker |  | `TeamLinkIn` | `Envelope_CommunityTeamOut_` | — |
| `POST` | `/communities/{community_id}/teams/{team_id}/approve` | Approve a team (moderators) | matchmaker |  | — | 204 No Content | — |
| `GET` | `/communities/{community_id}/feed` | Community feed | user |  | — | `FeedOut` | `before` |
| `POST` | `/communities/{community_id}/posts` | Post to the community | matchmaker |  | `PostIn` | `Envelope_PostOut_` | — |
| `POST` | `/communities/{community_id}/posts/{post_id}/vote` | Vote in a poll | matchmaker |  | `VoteIn` | `Envelope_PostOut_` | — |
| `DELETE` | `/communities/{community_id}/posts/{post_id}` | Remove a post (author or moderators) | user |  | — | 204 No Content | — |
| `POST` | `/communities/{community_id}/posts/{post_id}/report` | Report a post | user |  | `ReportPostIn` | 204 No Content | — |
| `GET` | `/communities/{community_id}/leaderboard` | Community rankings | user |  | — | `Envelope_CommunityLeaderboardOut_` | — |

## Safety

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/users/{user_id}/block` | Block a user (hides their posts from you) | user |  | — | 204 No Content | — |
| `DELETE` | `/users/{user_id}/block` | Unblock a user | user |  | — | 204 No Content | — |

## Players

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/players/me` | My player profile | user |  | — | `Envelope_PlayerSelfOut_` | — |
| `PUT` | `/players/me` | Create or update my player profile | user |  | `PlayerProfileIn` | `Envelope_PlayerSelfOut_` | — |
| `GET` | `/players/{player_id}` | Public player profile (no location or contact details) | user | public profile, no location/contact | — | `Envelope_PlayerPublicOut_` | — |

## Captains

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/captains/me` | My captain profile | user |  | — | `Envelope_CaptainOut_` | — |
| `PUT` | `/captains/me` | Create or update my captain profile | user |  | `CaptainProfileIn` | `Envelope_CaptainOut_` | — |
| `GET` | `/captains/{captain_id}` | Public captain profile | user |  | — | `Envelope_CaptainOut_` | — |

## CricHeroes

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/teams/{team_id}/cricheroes` | Team's linked CricHeroes profile and data | user |  | — | `Envelope_CricHeroesProfileOut_` | — |
| `PUT` | `/teams/{team_id}/cricheroes/link` | Link the team to its CricHeroes team page (captain/admin) | matchmaker |  | `CricHeroesLinkIn` | `Envelope_CricHeroesProfileOut_` | — |
| `POST` | `/teams/{team_id}/cricheroes/import` | Import CricHeroes team data from a file or manual entry (captain/admin) | matchmaker |  | `CricHeroesImportIn` | `Envelope_CricHeroesProfileOut_` | — |
| `POST` | `/teams/{team_id}/cricheroes/sync` | Fetch the latest data from CricHeroes automatically (captain/admin) | matchmaker |  | — | `Envelope_CricHeroesProfileOut_` | — |
| `DELETE` | `/teams/{team_id}/cricheroes` | Remove the CricHeroes link and data (captain/admin) | matchmaker |  | — | 204 No Content | — |

## Availability

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/availability` | Declare availability (optionally repeating weekly) | matchmaker |  | `AvailabilityIn` | `Envelope_list_AvailabilityOut__` | — |
| `GET` | `/availability/me` | My availability slots | user |  | — | `Envelope_list_AvailabilityOut__` | `start`, `end`, `include_past` |
| `PUT` | `/availability/{availability_id}` | Update a slot | matchmaker | owner | `AvailabilityUpdateIn` | `Envelope_AvailabilityOut_` | — |
| `DELETE` | `/availability/{availability_id}` | Delete a slot | user | owner | — | 204 No Content | — |

## Matches

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/matches` | Create a match (Build a Team) | matchmaker | team captain/admin | `MatchIn` | `Envelope_MatchOut_` | — |
| `GET` | `/matches` | My matches (as captain and/or player) | user |  | — | `PagedEnvelope_MatchOut_` | `role`, `when`, `team_id`, `status`, `page`, `page_size` |
| `GET` | `/matches/{match_id}` | Match details | user | venue address/coords only for manager/invitee/squad | — | `Envelope_MatchOut_` | — |
| `PUT` | `/matches/{match_id}` | Update or reschedule a match | matchmaker | match manager; editable states only; reschedule notifies squad | `MatchUpdateIn` | `Envelope_MatchOut_` | — |
| `POST` | `/matches/{match_id}/transition` | Advance the match lifecycle | matchmaker | match manager; lifecycle state machine | `TransitionIn` | `Envelope_MatchOut_` | — |
| `POST` | `/matches/{match_id}/cancel` | Cancel a match | user | match manager | `CancelIn` | `Envelope_MatchOut_` | — |
| `POST` | `/matches/{match_id}/complete` | Complete a match and record attendance | user | match manager; attendance updates reliability | `CompleteIn` | `Envelope_MatchOut_` | — |
| `POST` | `/matches/{match_id}/invitations` | Invite one or more players (per-player result) | matchmaker | match manager; availability + duplicate checks per invitee | `CreateInvitationsIn` | `Envelope_list_InvitationResultItem__` | — |
| `GET` | `/matches/{match_id}/invitations` | Invitations and join requests for a match (managers) | user | match manager | — | `Envelope_list_InvitationOut__` | `status` |
| `POST` | `/matches/{match_id}/join-requests` | Request to join a match (Find a Team) | matchmaker | not a manager; vacancies > 0; not unavailable/double-booked | `JoinRequestIn` | `Envelope_InvitationOut_` | — |
| `GET` | `/matches/{match_id}/roster` | Squad and composition | user | match manager or squad member | — | `Envelope_RosterOut_` | — |
| `POST` | `/matches/{match_id}/roster` | Confirm an accepted invitation / approve a join request into the squad | matchmaker | match manager; transactional capacity guard | `ConfirmIn` | `Envelope_RosterOut_` | — |
| `PUT` | `/matches/{match_id}/roster/{player_id}` | Update a squad entry (role, payee status) or remove the player | matchmaker | match manager | `RosterUpdateIn` | `Envelope_RosterOut_` | — |
| `POST` | `/matches/{match_id}/roster/{player_id}/replace` | Replace a squad player and send a substitute invitation | matchmaker | match manager | `ReplaceIn` | `Envelope_list_InvitationResultItem__` | — |
| `POST` | `/matches/{match_id}/withdraw` | Withdraw myself from the squad | user | squad member (not captain) | `WithdrawIn` | 204 No Content | — |
| `GET` | `/matches/{match_id}/suggestions/members` | Build a Team, method A: team members with availability | user |  | — | `Envelope_list_SuggestionOut__` | `role`, `q` |
| `GET` | `/matches/{match_id}/suggestions/previous` | Build a Team, method C: previous participants who are available | user |  | — | `Envelope_list_SuggestionOut__` | `role`, `q` |

## Invitations

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/invitations/me` | My invitations (received) and join requests (sent) | user |  | — | `PagedEnvelope_InvitationOut_` | `box`, `status`, `page`, `page_size` |
| `GET` | `/invitations/managed` | Invitations and join requests across matches I manage | user |  | — | `PagedEnvelope_InvitationOut_` | `direction`, `status`, `page`, `page_size` |
| `POST` | `/invitations/{invitation_id}/accept` | Accept an invitation | matchmaker | invitee only (direction=invite) | — | `Envelope_InvitationOut_` | — |
| `POST` | `/invitations/{invitation_id}/reject` | Reject an invitation (player) or a join request (captain) | user | invitee (invite) or match manager (join request) | `RespondIn` | `Envelope_InvitationOut_` | — |
| `POST` | `/invitations/{invitation_id}/cancel` | Cancel an invitation | user | match manager, or requester of a join request | `RespondIn` | `Envelope_InvitationOut_` | — |
| `POST` | `/invitations/{invitation_id}/confirm` | Confirm an accepted invitation or approve a join request (captain) | matchmaker | match manager; capacity guard; double-booking check | — | `Envelope_InvitationOut_` | — |

## Split a Fee

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/matches/{match_id}/expenses` | Add a match expense | matchmaker | match manager | `ExpenseIn` | `Envelope_ExpenseOut_` | — |
| `GET` | `/matches/{match_id}/expenses` | Match expenses | user | match manager or participant | — | `Envelope_list_ExpenseOut__` | — |
| `DELETE` | `/matches/{match_id}/expenses/{expense_id}` | Remove an expense | matchmaker | match manager | — | 204 No Content | — |
| `POST` | `/matches/{match_id}/settlements` | Create or refresh the draft settlement (captain reviews before publishing) | matchmaker | match manager; draft only | `SettlementDraftIn` | `Envelope_SettlementOut_` | — |
| `GET` | `/matches/{match_id}/settlements` | Settlement versions for a match | user | manager (incl. drafts) or participant (published) | — | `Envelope_list_SettlementOut__` | — |
| `POST` | `/settlements/{settlement_id}/publish` | Publish a draft (immutable afterwards; revisions create a new version) | matchmaker | match manager; draft → published (transaction) | — | `Envelope_SettlementOut_` | — |
| `GET` | `/settlements/me` | Player payment dashboard across all teams | user |  | — | `Envelope_PlayerDashboardOut_` | `status` |
| `GET` | `/settlements/{settlement_id}/payments` | Captain payment dashboard (participants see the same transparency view) | user | match manager or settlement participant | — | `Envelope_CaptainDashboardOut_` | — |
| `POST` | `/settlements/{settlement_id}/payments/{player_id}/mark-paid` | Mark a player's contribution as paid (manually confirmed by captain) | matchmaker | match manager only; audited; notifies player | `MarkPaidIn` | `Envelope_PaymentRecordOut_` | — |
| `POST` | `/settlements/{settlement_id}/payments/{player_id}/mark-exempted` | Exempt a player from paying | matchmaker | match manager only; audited | `RemarksIn` | `Envelope_PaymentRecordOut_` | — |
| `POST` | `/settlements/{settlement_id}/payments/{player_id}/correct` | Correct an incorrectly recorded status (reason required, audited) | matchmaker | match manager; reason required; audited | `CorrectIn` | `Envelope_PaymentRecordOut_` | — |
| `POST` | `/settlements/{settlement_id}/payments/{player_id}/dispute` | Raise a payment dispute (player, own record) | user | the player themselves only | `app__modules__settlements__schemas__DisputeIn` | `Envelope_PaymentRecordOut_` | — |
| `POST` | `/settlements/{settlement_id}/payments/{player_id}/remind` | Send an in-app reminder and get a WhatsApp reminder link | matchmaker | match manager | — | `Envelope_ShareOut_` | — |
| `GET` | `/settlements/{settlement_id}/share` | Settlement summary text + WhatsApp share link | user |  | — | `Envelope_ShareOut_` | — |
| `GET` | `/payments/{record_id}/discussion` | Fee discussion thread | user | record's player or match manager | — | `Envelope_list_DiscussionOut__` | — |
| `POST` | `/payments/{record_id}/discussion` | Post to the fee discussion thread | user | record's player or match manager | `DiscussionIn` | `Envelope_DiscussionOut_` | — |
| `POST` | `/fixtures/{fixture_id}/fees/{team_id}` | Open your team's match-fee ledger for a team-vs-team match (creates it for captains) | user |  | — | `Envelope_FeeSideOut_` | — |
| `PUT` | `/fees/{ledger_id}/squad` | Choose who shares the fee (captain/vice-captain) | matchmaker |  | `SquadIn` | `Envelope_FeeSideOut_` | — |
| `GET` | `/fees/{ledger_id}` | A team-vs-team fee ledger | user |  | — | `Envelope_FeeSideOut_` | — |

## Ratings & Reputation

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/matches/{match_id}/ratings` | Rate a verified participant of a completed match | matchmaker | verified participants of a completed match, within window, once | `RatingIn` | `Envelope_RatingOut_` | — |
| `GET` | `/matches/{match_id}/ratings/pending` | Participants I can rate for this match | user | verified participant | — | `Envelope_list_RateableOut__` | — |
| `GET` | `/users/{user_id}/ratings` | Reputation (player or captain) | user |  | — | `Envelope_ReputationOut_` | `type` |

## Notifications

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/notifications` | My notifications | user |  | — | `NotificationList` | `unread_only`, `page`, `page_size` |
| `POST` | `/notifications/{notification_id}/read` | Mark a notification read | user |  | — | 204 No Content | — |
| `POST` | `/notifications/read-all` | Mark all notifications read | user |  | — | 204 No Content | — |

## Reports

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/reports` | Report misconduct | user | not self; no duplicate open report | `ReportIn` | `Envelope_ReportOut_` | — |
| `GET` | `/reports/me` | Reports I have filed | user |  | — | `Envelope_list_ReportOut__` | — |

## Admin moderation

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/admin/stats` | Moderation overview | admin |  | — | `Envelope_AdminStats_` | — |
| `GET` | `/admin/reports` | Misconduct reports | admin |  | — | `PagedEnvelope_AdminReportOut_` | `status`, `page`, `page_size` |
| `PUT` | `/admin/reports/{report_id}` | Investigate: add notes, change status, take moderation action | admin |  | `ReportUpdateIn` | `Envelope_AdminReportOut_` | — |
| `PUT` | `/admin/ratings/{rating_id}` | Hide or restore a rating | admin |  | `ModerateRatingIn` | `Envelope_RatingOut_` | — |
| `GET` | `/admin/audit/{entity_type}/{entity_id}` | Audit trail for an entity | admin |  | — | `Envelope_list_dict_str__Any___` | — |

## Uploads

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `POST` | `/uploads/images` | Upload an image (JPEG/PNG/WebP, max 5 MB) | user |  | `multipart/form-data` | `Envelope_UploadOut_` | — |

## Venues

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/venues` | Search cricket grounds | user |  | — | `Envelope_list_VenueSearchOut__` | `q`, `lat`, `lng` |

## Dashboard

| Method | Path | Purpose | Auth | Resource rules | Request | Response | Query |
|---|---|---|---|---|---|---|---|
| `GET` | `/dashboard` | Home dashboard | user |  | — | `Envelope_DashboardOut_` | — |

## WebSocket
`GET /api/v1/ws?token=<access JWT>`: server → client JSON frames `{event, payload}`. Events: `notification.created`, `invitation.updated`, `roster.updated`, `match.updated`, `payment.updated`, `team.membership.updated`. Close code 4401 means an invalid token. Clients should refetch over REST on each event.


## Health
`GET /health/live` (process up) · `GET /health/ready` (MongoDB reachable, otherwise 503).


## Schemas
All request/response schemas (fields, types, constraints, enums) are in `shared/openapi.json` and browsable at `/docs`. TypeScript types: `shared/src/api-types.ts`.
