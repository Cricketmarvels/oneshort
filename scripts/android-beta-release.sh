#!/usr/bin/env bash
# Upload a OneShort Android beta APK to Firebase App Distribution, after checking it is the right app, a newer
# version, pointed at staging and not debug-signed. Dry run by default: nothing is uploaded without --confirm.
#   ./scripts/android-beta-release.sh [path/to.apk] [--notes "text"] [--group oneshort-qa] [--confirm]
# Needs .data/firebase-android.env (git-ignored) with FIREBASE_PROJECT_ID and FIREBASE_ANDROID_APP_ID, taken from
# the Firebase console or `firebase apps:list ANDROID --project <id>`, and a signed-in Firebase CLI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; CFG="$ROOT/.data/firebase-android.env"; LOG="$ROOT/docs/beta/ANDROID_RELEASES.md"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"
BT="$(ls -d "$ANDROID_HOME"/build-tools/* 2>/dev/null | sort -V | tail -1)"
APK=""; NOTES=""; GROUP="oneshort-qa"; CONFIRM=0; ALLOW_DEBUG=0
while [ $# -gt 0 ]; do case "$1" in
  --notes) NOTES="$2"; shift 2;; --group) GROUP="$2"; shift 2;; --confirm) CONFIRM=1; shift;;
  --allow-debug-signing) ALLOW_DEBUG=1; shift;; *) APK="$1"; shift;; esac; done
[ -n "$APK" ] || APK="$(ls -t "$ROOT"/.data/android-builds/*.apk 2>/dev/null | head -1)"
fail() { echo "✗ $*"; exit 1; }
[ -f "$APK" ] || fail "no APK found (build one with scripts/android-build-local.sh or EAS)"
[ -x "$BT/aapt2" ] || fail "Android build-tools missing (aapt2)"
echo "APK: $APK"

# 1. right app, version
BADGE="$("$BT/aapt2" dump badging "$APK" 2>/dev/null || true)"; BADGE="${BADGE%%$'\n'*}"  # first line (no pipe: pipefail)
PKG=$(sed -E "s/^package: name='([^']+)'.*/\1/" <<<"$BADGE"); VC=$(sed -E "s/.* versionCode='([0-9]+)'.*/\1/" <<<"$BADGE"); VN=$(sed -E "s/.* versionName='([^']+)'.*/\1/" <<<"$BADGE")
EXPECT=$(node -p 'require(process.argv[1]).expo.android.package' "$ROOT/mobile/app.json")
[ "$PKG" = "$EXPECT" ] || fail "package is $PKG, expected $EXPECT"
echo "✓ package $PKG, version $VN ($VC)"
LAST=$(grep -oE '^\| [0-9]+ ' "$LOG" 2>/dev/null | tr -dc '0-9\n' | sort -n | tail -1 || true)
[ -z "$LAST" ] || [ "$VC" -gt "$LAST" ] || fail "versionCode $VC is not above the last distributed $LAST; phones would refuse the update"
echo "✓ versionCode above last release (${LAST:-none})"

# 2. staging, no production or local endpoints, no obvious secrets in the bundle
BUNDLE="$(unzip -p "$APK" assets/index.android.bundle | strings)"
grep -q "api-staging.gofindr.in\|trycloudflare.com" <<<"$BUNDLE" || fail "bundle has no staging API address"
! grep -q "https://api.gofindr.in" <<<"$BUNDLE" || fail "bundle mentions the production API"
! grep -qE "localhost:8000|127\.0\.0\.1:8000|10\.0\.2\.2:8001" <<<"$BUNDLE" || fail "bundle points at this Mac (an emulator-only e2e build?)"
! grep -qE "JWT_SECRET|MSG91_AUTH_KEY|TWILIO_AUTH_TOKEN|BEGIN (RSA |EC )?PRIVATE KEY|sk-ant-" <<<"$BUNDLE" || fail "bundle contains something that looks like a secret"
echo "✓ staging API, no production/localhost address, no secrets found"

# 3. signing
CERT="$("$BT/apksigner" verify --print-certs "$APK" 2>&1)" || fail "signature does not verify"
if grep -q "CN=Android Debug" <<<"$CERT"; then
  [ "$ALLOW_DEBUG" = 1 ] || fail "signed with a debug key: fine for the emulator, not for testers (see docs). Override: --allow-debug-signing"
  echo "! debug-signed (allowed by flag)"
else echo "✓ release-signed: $(grep -m1 'certificate SHA-256' <<<"$CERT" | sed 's/.*: //' | cut -c1-23)…"; fi

# 4. release notes
[ -n "$NOTES" ] || NOTES="OneShort Android beta $VN ($VC), $(git -C "$ROOT" rev-parse --short HEAD). Changes: $(git -C "$ROOT" log -5 --pretty='%s' | paste -sd ';' - | cut -c1-400)"
echo "notes: $NOTES"

[ -f "$CFG" ] || fail "missing $CFG (FIREBASE_PROJECT_ID, FIREBASE_ANDROID_APP_ID)"; . "$CFG"
: "${FIREBASE_PROJECT_ID:?}" "${FIREBASE_ANDROID_APP_ID:?}"
[[ "$FIREBASE_ANDROID_APP_ID" =~ ^1:[0-9]+:android:[0-9a-f]+$ ]] || fail "FIREBASE_ANDROID_APP_ID doesn't look like a Firebase Android App ID (1:123:android:abc)"
FB=(npx -y firebase-tools@latest --project "$FIREBASE_PROJECT_ID" --non-interactive)
"${FB[@]}" apps:list ANDROID 2>/dev/null | grep -q "$FIREBASE_ANDROID_APP_ID" || fail "App ID not found in project $FIREBASE_PROJECT_ID (signed in?)"
"${FB[@]}" apps:sdkconfig ANDROID "$FIREBASE_ANDROID_APP_ID" 2>/dev/null | grep -q "\"package_name\": *\"$PKG\"" \
  || fail "Firebase app $FIREBASE_ANDROID_APP_ID is not registered for $PKG"
echo "✓ Firebase project $FIREBASE_PROJECT_ID, app $FIREBASE_ANDROID_APP_ID ($PKG)"

if [ "$CONFIRM" != 1 ]; then echo "Dry run passed. Nothing uploaded. Re-run with --confirm to distribute to group '$GROUP'."; exit 0; fi
OUT="$("${FB[@]}" appdistribution:distribute "$APK" --app "$FIREBASE_ANDROID_APP_ID" --groups "$GROUP" --release-notes "$NOTES" 2>&1)" || { echo "$OUT"; fail "upload failed"; }
echo "$OUT" | grep -iE "uploaded|distributed|https://" || echo "$OUT"
LINK=$(grep -oE 'https://appdistribution\.firebase[^ ]+' <<<"$OUT" | head -1 || true)
[ -f "$LOG" ] || printf '# Android beta releases\n\nAppended by scripts/android-beta-release.sh.\n\n| versionCode | version | date (UTC) | commit | group | tester link |\n|---|---|---|---|---|---|\n' > "$LOG"
printf '| %s | %s | %s | %s | %s | %s |\n' "$VC" "$VN" "$(date -u +%F)" "$(git -C "$ROOT" rev-parse --short HEAD)" "$GROUP" "${LINK:-see console}" >> "$LOG"
echo "✓ distributed to $GROUP; recorded in docs/beta/ANDROID_RELEASES.md"
