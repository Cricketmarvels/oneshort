#!/usr/bin/env bash
# Build the GoFindr Android beta APK on this Mac (free; no EAS cloud build).
# Uses exactly the env of the "android-beta" profile in mobile/eas.json, so local and EAS builds match.
#   ./scripts/android-build-local.sh            bump versionCode, build, copy to .data/android-builds/
#   ./scripts/android-build-local.sh --no-bump  rebuild with the current versionCode (emulator testing only)
#   ./scripts/android-build-local.sh --e2e      emulator-only test build: talks to the staging API on this Mac at
#                                               http://10.0.2.2:8001 (the emulator's address for the host). Cleartext
#                                               is allowed for that one address only. Never distributed: the release
#                                               script rejects it (no staging HTTPS address inside).
# Signing: release builds are signed with ANDROID_BETA_KEYSTORE when set (see docs/beta/ANDROID_BETA_FIREBASE.md);
# otherwise with this Mac's debug key, which is fine for the emulator but must not be distributed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; M="$ROOT/mobile"; OUT="$ROOT/.data/android-builds"; mkdir -p "$OUT"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"; export ANDROID_SDK_ROOT="$ANDROID_HOME"
[ -x "$JAVA_HOME/bin/java" ] || { echo "JDK 17 missing: brew install openjdk@17"; exit 1; }
[ -d "$ANDROID_HOME/platforms" ] || { echo "Android SDK missing: see docs/beta/ANDROID_BETA_FIREBASE.md"; exit 1; }

MODE="${1:-}"
# 1. the profile's public env (never secrets: EXPO_PUBLIC_* ends up inside the app)
eval "$(node -e '
const e=require(process.argv[1]).build["android-beta"].env;
for (const [k,v] of Object.entries(e)) { if(!k.startsWith("EXPO_PUBLIC_")) throw new Error("non-public env in profile: "+k); console.log(`export ${k}=${JSON.stringify(v)}`); }
' "$M/eas.json")"
if [ "$MODE" = "--e2e" ]; then export EXPO_PUBLIC_API_URL="http://10.0.2.2:8001/api/v1" EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=false; fi
[ "$MODE" = "--e2e" ] || case "$EXPO_PUBLIC_API_URL" in https://*) ;; *) echo "android-beta must use an HTTPS API, got $EXPO_PUBLIC_API_URL"; exit 1;; esac
[ "$MODE" = "--e2e" ] || case "$EXPO_PUBLIC_API_URL" in *localhost*|*127.0.0.1*|*api.gofindr.in*) echo "android-beta must point to staging, got $EXPO_PUBLIC_API_URL"; exit 1;; esac

# 2. versionCode: every distributed APK needs a higher one, or phones refuse the update
if [ -z "$MODE" ]; then
  node -e 'const f=process.argv[1],fs=require("fs"),j=JSON.parse(fs.readFileSync(f));j.expo.android.versionCode=(j.expo.android.versionCode||0)+1;fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n");console.log("versionCode",j.expo.android.versionCode)' "$M/app.json"
fi
VC=$(node -p 'require(process.argv[1]).expo.android.versionCode' "$M/app.json"); VN=$(node -p 'require(process.argv[1]).expo.version' "$M/app.json")

# 3. native project (generated, git-ignored) and release build
# prebuild rewrites the "android"/"ios" npm scripts in package.json; keep the committed file unchanged
cp "$M/package.json" "$OUT/.package.json.bak"
(cd "$M" && CI=1 npx expo prebuild --platform android --clean --no-install >/dev/null)
mv "$OUT/.package.json.bak" "$M/package.json"
if [ "$MODE" = "--e2e" ]; then
  mkdir -p "$M/android/app/src/main/res/xml"
  cat > "$M/android/app/src/main/res/xml/network_security_config.xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">10.0.2.2</domain></domain-config>
</network-security-config>
XML
  sed -i '' 's|<application |<application android:networkSecurityConfig="@xml/network_security_config" |' "$M/android/app/src/main/AndroidManifest.xml"
fi
if [ -n "${ANDROID_BETA_KEYSTORE:-}" ]; then
  : "${ANDROID_BETA_KEYSTORE_PASSWORD:?}" "${ANDROID_BETA_KEY_ALIAS:?}" "${ANDROID_BETA_KEY_PASSWORD:?}"
  SIGN=(-Pandroid.injected.signing.store.file="$ANDROID_BETA_KEYSTORE" -Pandroid.injected.signing.store.password="$ANDROID_BETA_KEYSTORE_PASSWORD"
        -Pandroid.injected.signing.key.alias="$ANDROID_BETA_KEY_ALIAS" -Pandroid.injected.signing.key.password="$ANDROID_BETA_KEY_PASSWORD")
else SIGN=(); echo "note: no ANDROID_BETA_KEYSTORE set; signing with the debug key (emulator/own phone only)"; fi
# Only the processors that matter: phones are ARM (64-bit, plus 32-bit for old devices); the Apple-silicon emulator
# is arm64. Skipping x86 halves the native compile, which otherwise dominates build time on this Mac.
ABIS="arm64-v8a,armeabi-v7a"; [ "$MODE" = "--e2e" ] && ABIS="arm64-v8a"
(cd "$M/android" && ./gradlew --no-daemon -q assembleRelease -PreactNativeArchitectures="$ABIS" ${SIGN[@]+"${SIGN[@]}"})
KIND=beta; [ "$MODE" = "--e2e" ] && KIND=e2e
APK="$OUT/gofindr-$KIND-$VN-$VC.apk"; cp "$M/android/app/build/outputs/apk/release/app-release.apk" "$APK"
printf '{"versionName":"%s","versionCode":%s,"api":"%s","commit":"%s","built_at":"%s","signed_with":"%s"}\n' \
  "$VN" "$VC" "$EXPO_PUBLIC_API_URL" "$(git -C "$ROOT" rev-parse --short HEAD)" "$(date -u +%FT%TZ)" "${ANDROID_BETA_KEYSTORE:+beta-keystore}${ANDROID_BETA_KEYSTORE:-debug}" > "$APK.json"
echo "APK: $APK"
