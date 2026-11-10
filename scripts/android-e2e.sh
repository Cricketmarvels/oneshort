#!/usr/bin/env bash
# Run the Maestro suite (mobile/.maestro) on the local Android emulator against the STAGING backend. Free.
#   ./scripts/android-e2e.sh [path/to.apk] [maestro args…]   e.g. --include-tags auth
# Needs: ./scripts/staging.sh start (and, for a beta APK, an HTTPS staging address in STAGING_API_URL).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; D="$ROOT/.data"
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-/opt/homebrew/share/android-commandlinetools}"; export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"
AVD=gofindr_e2e; IMG="system-images;android-35;google_apis;arm64-v8a"
APK="${1:-}"; [ -f "$APK" ] && shift || APK="$(ls -t "$D"/android-builds/*.apk 2>/dev/null | head -1)"
[ -f "$APK" ] || { echo "no APK: run ./scripts/android-build-local.sh --e2e"; exit 1; }
# Default: an e2e build (./scripts/android-build-local.sh --e2e) reaching the staging API on this Mac via 10.0.2.2.
# A beta build needs an HTTPS staging address instead: pass it as STAGING_API_URL and the flows set it in-app.
APK_KIND=$(basename "$APK" | cut -d- -f2)
if [ "$APK_KIND" = e2e ]; then CHECK="http://127.0.0.1:8001/api/v1"; SET_SERVER=false; API_URL="http://10.0.2.2:8001/api/v1"
else : "${STAGING_API_URL:?set STAGING_API_URL=https://…/api/v1 for a beta APK}"; CHECK="$STAGING_API_URL"; API_URL="$STAGING_API_URL"; SET_SERVER=true; fi
OPTS="$(curl -sf "$CHECK/auth/options" || true)"
grep -q '"tester_signup_prefix":"+447700900"' <<<"$OPTS" || { echo "staging API not reachable at $CHECK (./scripts/staging.sh start)"; exit 1; }
# Never against production: the suite signs up fake accounts.
grep -q '"whatsapp_simulator":true' <<<"$OPTS" || { echo "refusing: $CHECK is not a test server"; exit 1; }

if ! emulator -list-avds | grep -qx "$AVD"; then
  echo no | avdmanager create avd -n "$AVD" -k "$IMG" -d pixel_7 >/dev/null
  printf 'disk.dataPartition.size=2G\nhw.keyboard=yes\n' >> "$HOME/.android/avd/$AVD.avd/config.ini"  # small disk footprint
fi
if ! adb devices | grep -q "emulator-"; then
  nohup emulator -avd "$AVD" -no-snapshot-save -no-boot-anim -netdelay none -netspeed full -gpu swiftshader_indirect >"$D/emulator.log" 2>&1 &
  adb wait-for-device; until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do sleep 2; done
fi
adb install -r -d "$APK" >/dev/null && echo "installed $(basename "$APK")"
mkdir -p "$D/e2e-reports"; REPORT="$D/e2e-reports/maestro-$(date +%Y%m%d-%H%M%S)"
maestro test "$ROOT/mobile/.maestro" -e API_URL="$API_URL" -e SET_SERVER="$SET_SERVER" --format junit --output "$REPORT.xml" --test-output-dir "$REPORT" "$@"
