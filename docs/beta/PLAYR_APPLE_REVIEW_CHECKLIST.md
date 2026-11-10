# GoFindr beta — Apple TestFlight / App Review checklist

External TestFlight builds go through a light Apple review before testers can install. Date: 2026-11-10.

| # | Item | State | Notes |
|---|---|---|---|
| 1 | Apple Developer Program membership | ☐ owner | US$99/yr, needed for TestFlight at all |
| 2 | App record in App Store Connect, bundle `in.gofindr.app`, name "GoFindr" | ☐ owner | Created by `eas submit` or manually |
| 3 | Signing: distribution cert + provisioning profile | ☐ via `eas credentials` | EAS manages |
| 4 | Push entitlement + APNs key | ☐ via `eas credentials` | `expo-notifications` plugin adds `aps-environment` |
| 5 | App icon 1024×1024 without alpha | ⚠ verify | `mobile/assets/icon.png` present; confirm no transparency |
| 6 | Splash screen | ✅ | `expo-splash-screen` configured, `#F5F6F0` |
| 7 | Permission strings | ✅ | Location (When In Use), camera, photos, microphone (voice search), notifications — all written in plain language |
| 8 | Privacy manifest (`PrivacyInfo.xcprivacy`) | ✅ auto | Expo SDK 58 generates it from the installed libraries' declared reasons |
| 9 | App privacy "nutrition label" | ☐ owner, text ready | Collected: name, phone, email, approximate location (user-chosen area), photos, user content, device token. Not used for tracking. No third-party ads |
| 10 | Account deletion in app | ✅ | Profile → Privacy & data → Delete my account (Apple requirement 5.1.1(v)) |
| 11 | Sign-in options | ✅ | Phone OTP (+ optional email/password). Apple sign-in not required because no third-party social login is offered |
| 12 | Terms + Privacy Notice reachable before login | ✅ | `/legal/terms`, `/legal/privacy` + links on the login screen |
| 13 | User-generated content: report, block, moderation | ✅ | Report/hide/block in communities; admin moderation queue; EULA covers objectionable content |
| 14 | Demo account for reviewers | ☐ create on beta | Provide a reviewer login (email + password) and a note that OTP goes to WhatsApp; tester mode is off in beta so give credentials |
| 15 | Beta App Review info | ☐ owner | Contact name, email, phone; description: "Cricket matchmaking for Noida/NCR players; invite-only beta" |
| 16 | Export compliance | ✅ | `ITSAppUsesNonExemptEncryption: false` (HTTPS only) |
| 17 | No placeholder text / dead links | ⚠ | Legal pages show "[to be added before launch]" until `LEGAL_ENTITY_*` are set — **must be set before submission** |
| 18 | Background modes | ✅ none | No background location; keeps review simple |
| 19 | Minimum iOS version | ✅ | Expo SDK 58 default (iOS 15.1+) |
| 20 | Build/version | ☐ | `version` 1.0.0, `buildNumber` auto-increments on the `beta` profile |

Tester group: **"GoFindr Cricket Beta"** (external, up to 10,000; we start with 30–50). Steps: App Store Connect → TestFlight → External Testing → New group → add emails or enable the public link → attach the build → submit for Beta App Review (usually < 24 h first time).
