# GoFindr — first TestFlight build (internal testing)

Date: 2026-11-10. Scope: one iOS build on the `beta` EAS profile, uploaded to App Store Connect and installed on the owner's iPhone through an internal TestFlight group. External testers come later (`PLAYR_APPLE_REVIEW_CHECKLIST.md`).

## Identity (unchanged, reuse only)
| Item | Value |
|---|---|
| Display name | GoFindr |
| Expo project | `@playrrs-team/playr`, id `e8df9e32-92c4-4c6b-9234-f594c0389eb8` (slug `playr` kept: renaming would create a second project) |
| iOS bundle id | `in.gofindr.app` |
| Version / build | `1.0.0` / build number auto-increments on the `beta` profile (`appVersionSource: local`) |
| Scheme | `gofindr://` |

## Build profile: `beta`
Store distribution, `environment: preview`, `autoIncrement`, no development client. Build-time env:

| Variable | Value | Why |
|---|---|---|
| `EXPO_PUBLIC_API_URL` | `https://gofindr.in/api/v1` | The named Cloudflare tunnel already routes `gofindr.in` → web host, which proxies `/api` to the API. Live as soon as the .in registry publishes the nameservers (NIXI ticket 202611103200918). |
| `EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE` | `true` | Shows **Beta · server …** under the welcome screen's Log in link. Until the domain resolves, enter the current temporary tunnel address there (`https://<name>.trycloudflare.com/api/v1`), tap *Test connection*, *Save*. Only `https://host/api/v1` addresses are accepted; the value lives in the keychain; the `production` profile does not set the flag, so release builds ignore it. |

## Backend reality for this build
The API still runs on the owner's Mac behind Cloudflare (`public-demo.sh`). The app works only while that Mac is awake and the tunnel is up. Hosting the API properly is a separate, approved step (`PLAYR_BETA_DEPLOYMENT_RUNBOOK.md`, no AWS).

Sign-in on the beta: `OTP_PROVIDER=console` with `DEV_OTP_IN_RESPONSE=false` means SMS codes are never delivered. Use **WhatsApp** as the channel: the app offers *Open WhatsApp simulator (test mode)*, which shows the code. Email + password also works for seeded demo accounts (`.data/demo-logins.txt`). Push notifications are off on the server (`PUSH_PROVIDER=none`) and need the APNs key from `eas credentials` plus the FCM/Expo push config before they can be tested.

## Commands
```bash
cd platform/mobile
npx eas-cli@latest whoami                      # expects playrr (owner of playrrs-team)
npx eas-cli@latest credentials -p ios          # one time, interactive: Apple login + let EAS create cert, profile, APNs key
npx eas-cli@latest build -p ios --profile beta # ~15–25 min on m-medium
npx eas-cli@latest submit -p ios --latest --profile beta
```
Then App Store Connect → GoFindr → TestFlight → Internal Testing → group **GoFindr Internal Beta** → add yourself → enable the build. Install the TestFlight app on the iPhone and accept the invitation e-mail.

## Checks run before the build (2026-11-10)
`npx expo-doctor` 20/20 · `tsc --noEmit` clean · `jest` 2/2 · `expo export --platform ios` bundles (14 MB Hermes) · icon 1024×1024 RGB, no alpha · no `console.log`, no secrets in the app, refresh token in the keychain, no plain-http hosts in release profiles. ESLint (eslint-config-expo 58) reports 68 errors, 41 of them unescaped apostrophes in JSX text and the rest new React Compiler rules; none affect the build and they were left for a later cleanup.
