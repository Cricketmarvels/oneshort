# OneShort Android beta: Firebase App Distribution, local builds and Maestro tests

Goal: test OneShort on real Android phones, repeatedly, without a Google Play Console account. Firebase is used
**only** to hand APKs to testers. No Firebase SDK is added to the app, and no Firebase Authentication,
Firestore, Analytics, Functions or Storage is enabled. Sign-in stays OneShort's own SMS-code system
(`docs/AUTHENTICATION.md`) and data stays in MongoDB.

## Pipeline

```
code → static checks → backend tests → mobile checks → e2e APK → Maestro on emulator
     → beta APK → release script dry run → (owner approves) → Firebase App Distribution → testers
```

Automated verification never distributes. Distribution is a separate command that needs `--confirm`.

| Step | Command (from the repo root) |
|---|---|
| Backend tests | `cd backend && uv run ruff check app tests && uv run mypy app && uv run pytest -q` |
| Mobile checks | `cd mobile && npx tsc --noEmit && npx jest` |
| Start staging | `./scripts/staging.sh start` (once: `./scripts/staging.sh seed`) |
| Emulator test build | `./scripts/android-build-local.sh --e2e` |
| Android E2E | `./scripts/android-e2e.sh` (one area: `./scripts/android-e2e.sh --include-tags auth`) |
| Test reports | `.data/e2e-reports/` (JUnit XML plus screenshots of failures) |
| Beta APK, local | `ANDROID_BETA_KEYSTORE=… ./scripts/android-build-local.sh` |
| Beta APK, EAS | `cd mobile && npx eas-cli build -p android --profile android-beta` (uses the free build quota) |
| Check a release | `./scripts/android-beta-release.sh` (dry run) |
| Distribute | `./scripts/android-beta-release.sh --confirm` (only after approval) |

GitHub Actions (`.github/workflows/ci.yml`) already runs the backend, web and mobile checks on push. Emulator
tests stay local: they need an Android emulator, and hosted macOS or emulator runners use paid minutes on
private repositories.

## 1. Firebase MCP for Claude Code

Installed as the official plugin:

```
claude plugin marketplace add firebase/firebase-tools
claude plugin install firebase@firebase
```

It runs `npx firebase-tools@latest mcp`. Don't also add `claude mcp add firebase …`, which would create a
duplicate. Sign in once, interactively, in your own terminal:

```
npx firebase-tools@latest login
npx firebase-tools@latest projects:list
```

The MCP tools cover project and app inspection and creation (`firebase_list_projects`, `firebase_list_apps`,
`firebase_create_app` and others). App Distribution uploads and testers use the Firebase CLI, as below.

## 2. Firebase project and Android app (one time, after approval)

1. Create a project, for example "OneShort Android Beta", on the free Spark plan. Don't add billing, and don't
   enable Google Analytics. Use the project ID Firebase assigns. The display name may already be taken.
2. Register an Android app with package name **`in.gofindr.app`**, from `mobile/app.json`. Don't change it:
   phones treat a different package as a different app.
3. Note the **Firebase App ID** (`1:<number>:android:<hex>`). It isn't the package name. You don't need to add
   `google-services.json` to the app, because App Distribution doesn't need the SDK.
4. In the console, open App Distribution and click Get started.
5. Save the IDs locally. The file is git-ignored:
   ```
   cat > .data/firebase-android.env <<'X'
   FIREBASE_PROJECT_ID=<project-id>
   FIREBASE_ANDROID_APP_ID=1:…:android:…
   X
   ```
6. Create the tester group and add testers. Use only addresses you have chosen:
   ```
   npx firebase-tools@latest appdistribution:groups:create "OneShort QA" oneshort-qa --project <project-id>
   npx firebase-tools@latest appdistribution:testers:add person@example.com --group-alias oneshort-qa --project <project-id>
   npx firebase-tools@latest appdistribution:testers:remove person@example.com --project <project-id>
   ```

## 3. Building APKs

**Profile.** `android-beta` in `mobile/eas.json` builds an installable APK pointed at the HTTPS staging API
`https://api-staging.gofindr.in/api/v1`. Testers can switch servers in the app with the "Change server" link,
which accepts HTTPS `/api/v1` addresses only. Only `EXPO_PUBLIC_*` values go into the app, and they are public
by definition. The local build script refuses anything else, plus localhost and the production API.

**Versions.** Each distributed APK needs a higher `versionCode`, or phones refuse the update. The local script
and the EAS profile both raise it in `mobile/app.json`. Commit that change with the release.

**Signing.** All APKs given to testers must be signed with the same key. A phone won't update an app signed
with a different key. Choose one and keep it:

- **EAS-managed key (recommended):** EAS creates and stores it on the first `android-beta` cloud build.
  Builds then work from any machine. This uses the free EAS build quota, and later local builds can download
  the same key with `eas credentials`.
- **Local key:** create it once with `keytool -genkeypair -v -keystore ~/.oneshort/android-beta.jks -alias
  oneshort-beta -keyalg RSA -keysize 4096 -validity 10000`. Back it up, keep it out of git, and set
  `ANDROID_BETA_KEYSTORE`, `ANDROID_BETA_KEYSTORE_PASSWORD`, `ANDROID_BETA_KEY_ALIAS` and
  `ANDROID_BETA_KEY_PASSWORD` when building.

Without a key, the local script signs with this Mac's debug key. That's fine for the emulator, and the release
script refuses to distribute it.

**Local versus EAS.** A local build is free and unlimited but needs this Mac's toolchain: JDK 17 and the
Android SDK, installed with Homebrew under `/opt/homebrew/share/android-commandlinetools`, plus about 6 GB of
caches. EAS cloud builds are reproducible and keep the signing key safe, but the free plan has a monthly
build limit; check expo.dev/pricing. Use EAS for builds you distribute and local `--e2e` builds for testing.

## 4. Releasing to testers

```
./scripts/android-beta-release.sh                 # dry run: every check, no upload
./scripts/android-beta-release.sh --confirm --notes "What to test this round"
```

The script checks that:
- the package is `in.gofindr.app` and the `versionCode` is above the last release;
- the bundle contains the staging address, and no production or local address;
- the bundle contains no secret-looking strings;
- the APK isn't debug-signed;
- the App ID belongs to the project and to this package.

It then uploads with `firebase appdistribution:distribute`, notifies the `oneshort-qa` group, and appends the
release to `docs/beta/ANDROID_RELEASES.md`.

**Testers** get an email invitation:
1. Accept it on the Android phone. It installs the Firebase App Tester app or opens the web flow.
2. Tap Download.
3. When Android asks, allow "Install unknown apps" for the browser or App Tester. That's under Settings,
   Apps, Special app access.
4. Open OneShort.

New releases arrive the same way. Feedback goes through App Tester or email, with screenshots.

## 5. Staging server

`./scripts/staging.sh` runs a separate API on `127.0.0.1:8001`:
- **Isolated.** It has its own database (`oneshort_staging`), its own uploads folder and its own JWT secret,
  generated into `.data/staging.env`, which git ignores. It runs from its own folder, so the demo's
  `backend/.env` is never read.
- **Startup guard.** With `APP_ENV=staging`, startup refuses a weak secret or debug mode. Tokens carry
  `aud=oneshort:staging`, so they never work against production.
- **Codes.** Codes are never returned to the app. The exception is brand-new numbers in the fictional
  `+44 7700 900xxx` range, which show their code on screen for high-volume testing. Real numbers need a real
  SMS provider: set `OTP_PROVIDER`, its keys and a low `OTP_DAILY_BUDGET` in `.data/staging.env`. That's paid,
  so it needs approval.
- **Test data.** `./scripts/staging.sh seed` wipes and reseeds only the staging database with synthetic
  players, captains, teams, grounds, invitations, matches and fees. The seeder refuses beta and production,
  and refuses a staging reset unless the database name contains "staging".
- **HTTPS for real phones.** Phones need an HTTPS address for this server. Either put it behind the
  Cloudflare named tunnel as `api-staging.gofindr.in` once the domain is active, or open a temporary tunnel
  yourself: `cloudflared tunnel --url http://127.0.0.1:8001`. Testers then use Change server.

## 6. Automated Android tests (Maestro)

The flows are in `mobile/.maestro/` and use the stable `testID`s on the onboarding screens (`welcome-start`,
`sport-cricket`, `login-mobile`, `login-send-code`, `otp-code`, `consent-*`, `reg-*` and others).
`./scripts/android-e2e.sh`:
1. creates the `oneshort_e2e` emulator (Pixel 7, Android 15, arm64) and boots it;
2. installs the newest APK;
3. refuses to run unless the target server reports test mode;
4. runs every flow and writes a JUnit report.

The `--e2e` APK reaches staging through `10.0.2.2`, the emulator's address for this Mac, with cleartext allowed
for that address only. To run the same flows on a beta APK or a USB-connected phone, set
`STAGING_API_URL=https://…/api/v1`.

| Flow | Covers |
|---|---|
| 01 sign up as player | sport → mobile only → SMS code → terms → details → Player → profile → Home |
| 02 sign up as captain | the same, ending on Teams |
| 03 invalid number, wrong code | number validation, resend countdown, "Incorrect OTP", stays on code screen |
| 04 session restore and logout | restart without re-entering a code, then Log out |
| 05 sign out everywhere | Settings → Signed-in devices → Sign out everywhere |
| 06 player navigation | Home, Discover, Community, Profile open |

Code expiry, rate limits, budgets, simultaneous submissions, duplicate accounts, invitation expiry and
takeover attempts are tested on the server (`backend/tests/api/test_auth_hardening.py` and the rest of the
suite), where time and concurrency can be controlled.

## 7. Costs

| Item | Cost |
|---|---|
| Firebase App Distribution, Spark plan | free; no billing account needed |
| Firebase MCP and CLI | free |
| Local emulator, Maestro CLI, local builds | free (disk space and time) |
| Staging test numbers (console SMS) | free |
| EAS builds | free plan has a monthly limit; paid beyond it |
| Real SMS for delivery tests | paid per message; capped by `OTP_DAILY_BUDGET`; needs approval and a DLT template |
| Maestro Cloud, Firebase Test Lab beyond the free quota | paid; not used |
| Google Play Console | one-time registration fee; only when moving to Play internal testing |

## 8. Troubleshooting

- **Local build takes hours, or the emulator shows "System UI isn't responding":** this Mac is out of memory
  or disk. A local build needs about 10 GB free disk and the emulator closed. The first build took about
  15 minutes. A build that ran alongside the emulator and other apps took over 2 hours, swapping heavily.
  Test builds now compile only arm64 and beta builds only the two ARM types. Run the build, close it, then
  start the emulator. Otherwise use an EAS cloud build.

- **"App not installed":** a different signing key or a lower `versionCode` than the installed app.
  Uninstall it, or build with the release key and a higher code.
- **Can't reach the server on the emulator:** `./scripts/staging.sh status`. An e2e build needs the API on
  port 8001.
- **"Failed to authenticate" from Firebase:** run `npx firebase-tools@latest login` again.
- **Codes don't show on the phone:** use a new `+44 7700 900xxx` number. Existing numbers never show codes.
- **Build fails with Java or SDK errors:** check that `JAVA_HOME=/opt/homebrew/opt/openjdk@17` and
  `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools` are set.

## 9. Moving to Google Play internal testing later

1. Register a Play Console account.
2. Create the app with the same package `in.gofindr.app`.
3. Use the `production` profile (an app bundle) with the same signing key, or enrol in Play App Signing with
   that key as the upload key.
4. Upload to the Internal testing track.

Keep `versionCode` increasing across both channels. Testers who sideloaded an APK may need to uninstall it once
if the signing key changes.
