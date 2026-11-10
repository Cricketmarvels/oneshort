import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * API base URL. Baked in at build time with EXPO_PUBLIC_API_URL (e.g. http://10.0.2.2:8000/api/v1 for the
 * Android emulator, or your LAN IP for a physical device).
 *
 * Beta builds (EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE=true) can additionally point at another HTTPS server from the
 * welcome screen, so a TestFlight build keeps working while the gofindr.in domain is pending. The override lives
 * in the keychain, only https + /api/v1 addresses are accepted, and production builds ignore it entirely.
 */
export const DEFAULT_API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:8000/api/v1";

/** Live binding: modules that import it always read the current value (see setApiUrl). */
export let API_URL: string = DEFAULT_API_URL;

export const SERVER_OVERRIDE_ALLOWED: boolean = process.env.EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE === "true" && Platform.OS !== "web";

const OVERRIDE_KEY = "gofindr.api_url";
const API_URL_RE = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)+(:\d{2,5})?\/api\/v1$/i;

/** True for an address this app is willing to talk to: HTTPS, a real host name, ending in /api/v1. */
export const isValidApiUrl = (u: string): boolean => API_URL_RE.test(u.trim());

let loading: Promise<void> | null = null;
/** Resolves once any saved override has been applied; the API client awaits this before its first request. */
export function configReady(): Promise<void> {
  if (!loading) {
    loading = (async () => {
      if (!SERVER_OVERRIDE_ALLOWED) return;
      try {
        const saved = await SecureStore.getItemAsync(OVERRIDE_KEY);
        if (saved && isValidApiUrl(saved)) API_URL = saved.trim();
      } catch { /* keychain unavailable: keep the built-in address */ }
    })();
  }
  return loading;
}

/** Save (or clear with null) the server override. Rejects anything isValidApiUrl() refuses. */
export async function setApiUrl(u: string | null): Promise<void> {
  if (!SERVER_OVERRIDE_ALLOWED) return;
  if (u === null) {
    await SecureStore.deleteItemAsync(OVERRIDE_KEY);
    API_URL = DEFAULT_API_URL;
    return;
  }
  const v = u.trim();
  if (!isValidApiUrl(v)) throw new Error("Enter an https address ending in /api/v1");
  await SecureStore.setItemAsync(OVERRIDE_KEY, v);
  API_URL = v;
}

/** When true, "current location" resolves to the default city (Noida). Set in .env.development. */
export const USE_DEFAULT_LOCATION: boolean = process.env.EXPO_PUBLIC_USE_DEFAULT_LOCATION === "true";

/** "email" opens the login screen on email + password (used for public demos where SMS OTP isn't configured). */
export const DEFAULT_LOGIN: string = process.env.EXPO_PUBLIC_DEFAULT_LOGIN ?? "otp";
