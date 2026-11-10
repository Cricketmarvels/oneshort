# GoFindr beta — iOS push notifications: setup and verification

Status: **code complete; BLOCKED on an EAS project, an Apple Developer account (APNs key) and physical iPhones.** Architecture detail: `docs/design/PUSH_NOTIFICATIONS.md`. Date: 2026-11-10.

## Architecture in one paragraph

The app registers an **Expo push token** (needs an EAS project id; Expo Go has no remote push). The backend sends through the Expo Push Service (`PUSH_PROVIDER=expo`), which hands off to APNs using the key stored in the EAS project — no Apple secrets touch our servers. Tickets and receipts are both checked; `DeviceNotRegistered` deletes the token; pushes exist only as side effects of authorized actions; payloads hold display text and opaque ids; taps route through the same deep-link map as the in-app inbox, including cold start and signed-out taps (parked until sign-in).

## Notifications covered by the existing event model

| Event | NotificationType | Push | WhatsApp (opt-in) |
|---|---|---|---|
| Match invitation received | `player_invitation` | ✅ | ✅ |
| Team invitation / join request | `team_invitation`, `join_request` | ✅ | — |
| Invitation accepted / rejected / cancelled | `invitation_accepted`, `invitation_rejected`, `invitation_cancelled` | ✅ | — |
| Player joined a team | team membership events | ✅ | — |
| Match reminder (day before) | `match_reminder` (scheduler) | ✅ | ✅ |
| Match cancelled / updated | match lifecycle notifications | ✅ | ✅ |

Lock-screen content: title + one short line, never phone numbers or exact locations. Preferences: `notification_prefs.push` and per-type `muted_types`. Tokens are removed on account deletion and on `DeviceNotRegistered`; **logout does not yet delete the device token** (see gaps).

## Setup (owner)

1. `cd mobile && npx eas-cli@latest init` → writes `extra.eas.projectId` to `app.json`. Commit.
2. Apple Developer Program membership (US$99/yr). `npx eas-cli credentials` → iOS → bundle `in.gofindr.app` → let EAS create the **APNs key** and the distribution certificate / provisioning profile. The `aps-environment` entitlement is added by the `expo-notifications` plugin automatically.
3. Development build for device testing: `npx eas-cli build --profile development --platform ios` → install via the EAS link on each test iPhone.
4. Backend: `PUSH_PROVIDER=expo` (+ `EXPO_PUSH_ACCESS_TOKEN` only if push security is enabled on the Expo account).

## Verification on real iPhones

Follow the A–E plan in `docs/design/PUSH_NOTIFICATIONS.md`. Evidence per run: screen recording + API log lines `push.expo.*` (no tokens or PII are logged).

## Known gaps before beta

| Gap | Fix | Size |
|---|---|---|
| Device token kept after logout | On logout, `DELETE /users/me/devices/{token}` from the app (`signOut`) and server-side cleanup for the session family | small |
| No duplicate-suppression across two devices of the same user | By design each device gets the notification; acceptable |
| Android (FCM) | Same pipeline; needs `google-services.json` + FCM v1 key in EAS. Not part of the iOS beta |
