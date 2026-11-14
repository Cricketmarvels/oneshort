# Google Sign-In: what the app does and what has to be configured

Date: 2026-11-14. Status: **code complete, not yet configured**. The Google button stays hidden until the steps below
are done, and every other way to sign in (mobile OTP, email + password) works without them.

## How it works

1. The app shows "Continue with Google" only when `GET /auth/options` says `google: true` AND the native Google
   module is in the build (`src/lib/google.ts`). Expo Go and the web build never show it.
2. The native SDK returns a Google **ID token**. The app sends it to `POST /auth/google` over HTTPS and nothing else
   about the Google account.
3. The API verifies the token with Google's published keys: signature, issuer (`accounts.google.com`), audience
   (one of `GOOGLE_CLIENT_IDS`), expiry; then uses the stable `sub` as the identity
   (`app/infrastructure/integrations/google.py`, `app/modules/auth/accounts.py`).
4. Known `sub` → sign in. Unknown `sub`:
   - email matches an account whose email **we** verified and Google also says verified → linked, sign in;
   - email matches an account whose email is unverified → `409 ACCOUNT_EXISTS_UNLINKED`, no merge. The owner logs
     in the usual way and links Google from Settings (`POST /auth/google/link`);
   - no match → new account, `password_hash = null`, `auth_providers = ["google"]`, name/email prefilled, then the
     app asks only for date of birth and playing roles (complete profile). Google users are never asked for a password.
5. Tokens are the existing ones: 15-minute JWT access token, rotating refresh token family in SecureStore.

## Configuration (owner's Google Cloud console; free)

1. Google Cloud project → APIs & Services → OAuth consent screen (External, app name OneShort, support email,
   privacy policy URL `https://oneshort.co/legal/privacy`, scopes: email, profile, openid).
2. Credentials → three OAuth client IDs:
   - **Web application** → its client id is `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` (the SDK needs it to mint ID tokens).
   - **iOS** → bundle id `in.gofindr.app` (or the new one if you rename). Gives `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`
     and the reversed client id used as `GOOGLE_IOS_URL_SCHEME` (`com.googleusercontent.apps.<id>`).
   - **Android** → package `in.gofindr.app` plus the SHA-1 of the EAS build keystore (`eas credentials`), and the
     debug keystore SHA-1 for local builds.
3. Server: `GOOGLE_CLIENT_IDS=<web>,<ios>,<android>` in `backend/.env` (and the staging/production environment).
4. App build: set `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` and `GOOGLE_IOS_URL_SCHEME`
   as EAS secrets / env, then make a **development build** (`eas build --profile development`): the native module
   is not in Expo Go. `app.config.js` adds the config plugin only when `GOOGLE_IOS_URL_SCHEME` is set.
5. Test on a real iOS and Android device: fresh Google account → complete profile → Home; existing phone account
   with the same (unverified) email → refused, then linked from Settings → Google sign-in opens it.

## Not done / before production

- No real-device Google test yet (needs the client ids above and a development build).
- Email + password accounts start with an unverified email; "Verify my email" (Settings) needs the email provider
  switched on (`EMAIL_OTP_ENABLED`, see PLAYR_WHATSAPP_SETUP / email setup). Unverified emails never reset passwords.
- Google profile pictures are not imported (image fields may only point at files OneShort stored).
- Password minimum is 12 characters for the new email sign-up; the older phone-OTP paths still accept 8.
