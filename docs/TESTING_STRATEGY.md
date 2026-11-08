# Testing Strategy

## Layers
| Layer | Tooling | Scope |
|---|---|---|
| Domain unit | pytest | Pure functions: fee calculator, ranking engine, overlap, lifecycle and invitation state machines, reliability formula |
| Service and API integration | pytest + HTTPX `ASGITransport` + real MongoDB replica set (`cricket_test` DB, dropped per session) | Full HTTP → service → Mongo, including transactions and indexes |
| Concurrency | `asyncio.gather` of parallel HTTP requests | Overbooking, duplicate invites, double availability submits |
| Frontend unit/component | Vitest + React Testing Library | Forms, validation, status rendering, money formatting |
| E2E web | Playwright | Registration → agreement → onboarding → create match → discover → invite → accept → confirm → settle → mark paid |
| Mobile | jest-expo + RN Testing Library | Auth flow and secure storage wrapper |

Tests run against a real MongoDB because the behaviour under test (2dsphere `$geoNear`, partial unique indexes, transactions) cannot be faithfully mocked.

## Running
```
# backend (requires the Mongo replica set on 27018, see DEPLOYMENT_GUIDE)
cd backend && uv run pytest -q
# web
cd frontend && npm test && npm run test:e2e
```

## Business-critical scenarios → test locations
| # | Scenario | Test |
|---|---|---|
| 1 | User registration | `tests/api/test_auth.py::test_register_and_verify_otp` |
| 2 | OTP verification (wrong code, attempt cap, expiry) | `tests/api/test_auth.py` |
| 3 | Agreement acceptance gate | `tests/api/test_agreements.py` |
| 4 | Player profile creation | `tests/api/test_profiles.py` |
| 5 | Captain profile and team creation | `tests/api/test_teams.py` |
| 6 | Geospatial discovery | `tests/api/test_discovery.py::test_players_within_radius_ranked` |
| 7 | Radius filtering (hard constraint) | `tests/api/test_discovery.py::test_radius_is_hard_constraint` |
| 8 | Availability overlap | `tests/unit/test_overlap.py`, `tests/api/test_availability.py` |
| 9 | Role compatibility | `tests/api/test_discovery.py::test_role_filter` |
| 10 | Team discovery | `tests/api/test_discovery.py::test_find_team` |
| 11 | Duplicate invitation prevention | `tests/api/test_invitations.py::test_duplicate_active_invitation` |
| 12 | Invitation state transitions | `tests/unit/test_state_machines.py`, `tests/api/test_invitations.py` |
| 13 | Concurrent squad confirmation | `tests/api/test_invitations.py::test_concurrent_confirm_never_overbooks` |
| 14 | Match lifecycle | `tests/unit/test_state_machines.py`, `tests/api/test_matches.py` |
| 15 | Fee calculation | `tests/unit/test_fee_calculator.py` |
| 16 | Non-payee exemption | `tests/unit/test_fee_calculator.py`, `tests/api/test_settlements.py` |
| 17 | Manual payment confirmation | `tests/api/test_settlements.py::test_mark_paid_audited_and_notified` |
| 18 | Unauthorised payment updates | `tests/api/test_settlements.py::test_player_cannot_mark_paid` |
| 19 | Payment dispute | `tests/api/test_settlements.py::test_dispute` |
| 20 | Verified ratings only | `tests/api/test_ratings.py` |
| 21 | Misbehaviour reporting and moderation | `tests/api/test_reports.py` |
| 22 | Account deletion | `tests/api/test_users.py::test_account_deletion_anonymises` |
| 23 | Location privacy | `tests/api/test_discovery.py::test_no_coordinates_leak`, `tests/unit/test_logging_redaction.py` |

The authoritative list of what passes is the CI output (`.github/workflows/ci.yml`). The traceability matrix records the last verified run.
