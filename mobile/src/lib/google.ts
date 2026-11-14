/**
 * Google Sign-In on the device. The native module only exists in a development/production build (not Expo Go,
 * not web), so it is loaded lazily and everything degrades to "unavailable" when it's missing. The server also
 * has to be configured (GET /auth/options → google); the button only shows when both are true.
 *
 * The app never trusts anything Google returns: it hands the ID token to POST /auth/google and the API verifies
 * signature, issuer, audience and expiry before opening or creating the account.
 */
import { Platform } from "react-native";

import { API_URL } from "@/lib/config";

const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";
const IOS_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? "";

type Lib = typeof import("@react-native-google-signin/google-signin");
let lib: Lib | null | undefined;
function load(): Lib | null {
  if (lib !== undefined) return lib;
  if (Platform.OS === "web" || !WEB_CLIENT_ID) return (lib = null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require("@react-native-google-signin/google-signin") as Lib;
    m.GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, ...(IOS_CLIENT_ID ? { iosClientId: IOS_CLIENT_ID } : {}) });
    lib = m;
  } catch {
    lib = null; // Expo Go, or the native module isn't in this build
  }
  return lib;
}

/** True when this build can show the Google button (native module present and a web client id configured). */
export function googleAvailable(): boolean {
  return load() !== null;
}

export type GoogleResult = { idToken: string } | { cancelled: true } | { error: string };

/** Opens the Google account picker and returns the ID token for the API. */
export async function googleIdToken(): Promise<GoogleResult> {
  const m = load();
  if (!m) return { error: "Google sign-in isn't available in this build." };
  try {
    await m.GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const res = await m.GoogleSignin.signIn();
    if (m.isCancelledResponse(res)) return { cancelled: true };
    if (!m.isSuccessResponse(res)) return { error: "Google sign-in didn't complete. Try again." };
    const idToken = res.data.idToken ?? (await m.GoogleSignin.getTokens()).idToken;
    if (!idToken) return { error: "Google didn't return a sign-in token. Try again." };
    return { idToken };
  } catch (e) {
    if (m.isErrorWithCode(e)) {
      if (e.code === m.statusCodes.IN_PROGRESS) return { error: "Google sign-in is already open." };
      if (e.code === m.statusCodes.PLAY_SERVICES_NOT_AVAILABLE) return { error: "Google Play services are needed for Google sign-in." };
    }
    return { error: "Google sign-in failed. Check your connection and try again." };
  }
}

/** Forget the Google session on the device (called on sign-out so the picker shows again next time). */
export async function googleSignOut(): Promise<void> {
  const m = load();
  if (!m) return;
  try { await m.GoogleSignin.signOut(); } catch { /* nothing to forget */ }
}

export const GOOGLE_API_PATH = `${API_URL}/auth/google`;
