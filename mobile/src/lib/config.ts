import Constants from "expo-constants";

/**
 * API base URL. Override with EXPO_PUBLIC_API_URL (e.g. http://10.0.2.2:8000/api/v1 for the
 * Android emulator, or your LAN IP for a physical device).
 */
export const API_URL: string =
  process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string | undefined) ?? "http://localhost:8000/api/v1";

/** When true, "current location" resolves to the default city (Noida). Set in .env.development. */
export const USE_DEFAULT_LOCATION: boolean = process.env.EXPO_PUBLIC_USE_DEFAULT_LOCATION === "true";

/** "email" opens the login screen on email + password (used for public demos where SMS OTP isn't configured). */
export const DEFAULT_LOGIN: string = process.env.EXPO_PUBLIC_DEFAULT_LOGIN ?? "otp";
