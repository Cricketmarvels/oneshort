import * as Device from "expo-device";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { DEFAULT_LOCATION } from "@cm/shared";

import { api } from "./api";
import { USE_DEFAULT_LOCATION } from "./config";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true }),
});

/**
 * Asks for foreground location only when the user taps a "use my location" action.
 * Returns the position, or a plain-language reason it couldn't be read (denied, switched off, timed out).
 * With EXPO_PUBLIC_USE_DEFAULT_LOCATION=true (local dev only) it returns Noida without touching GPS.
 */
export type LocationResult = { ok: true; lat: number; lng: number } | { ok: false; reason: string };

export async function readLocation(): Promise<LocationResult> {
  if (USE_DEFAULT_LOCATION) return { ok: true, ...DEFAULT_LOCATION };
  try {
    if (Platform.OS === "web" && !(globalThis as { isSecureContext?: boolean }).isSecureContext) {
      return { ok: false, reason: "Your browser only shares location on secure (https) pages." };
    }
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, reason: Platform.OS === "web"
        ? "Location is blocked for this site. Allow it from the icon in the address bar, or pick an area instead."
        : "Location permission is off for OneShort. Turn it on in Settings, or pick an area instead." };
    }
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 15_000));
    const pos = await Promise.race([Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }), timeout])
      ?? (Platform.OS === "web" ? null : await Location.getLastKnownPositionAsync());
    if (!pos) return { ok: false, reason: "Couldn't get your position in time. Check that location services are on, or pick an area." };
    return { ok: true, lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return { ok: false, reason: "Your device couldn't find your position. Check that location services are on, or pick an area." };
  }
}

/** Position or null (kept for callers that only need the coordinates). */
export async function currentLocation(): Promise<{ lat: number; lng: number } | null> {
  const r = await readLocation();
  return r.ok ? { lat: r.lat, lng: r.lng } : null;
}

/**
 * Registers the native FCM/APNs device token with the backend (FCM adapter).
 * Remote push needs a development/production build with an EAS project id; Expo Go has no remote
 * push, so registration quietly skips there instead of storing undeliverable native tokens.
 */
let registeredPushToken: string | null = null;
/** True once this install has a working remote push token (then the server's pushes carry the sound). */
export const hasRemotePush = (): boolean => registeredPushToken !== null;

/** Called on logout: this device stops receiving pushes for the account that just signed out. */
export async function unregisterPush(): Promise<void> {
  const t = registeredPushToken;
  registeredPushToken = null;
  if (!t) return;
  await api(`/users/me/devices/${encodeURIComponent(t)}`, { method: "DELETE" }).catch(() => undefined);
}

export async function registerForPush(): Promise<void> {
  if (!Device.isDevice) return;
  // Expo Go can't receive remote push: don't prompt for a permission it can't use, and don't fetch a token.
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Match updates", importance: Notifications.AndroidImportance.HIGH });
  }
  const perm = await Notifications.requestPermissionsAsync();
  const granted = Platform.OS === "ios" ? perm.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED || perm.granted : perm.granted;
  if (!granted) return;
  const projectId: string | undefined =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
  if (!projectId) return; // Expo Go / no EAS project yet: remote push unavailable on this install
  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  await api("/users/me/devices", { method: "POST", body: { platform: Platform.OS === "ios" ? "ios" : "android", push_token: token.data } })
    .then(() => { registeredPushToken = token.data; })
    .catch(() => undefined);
}

/** Pick or capture a photo and upload it. Returns the hosted URL. */
export type UploadPurpose = "profile" | "team" | "team_logo" | "team_cover" | "match";
/** Pick (or shoot) a photo, crop it for its purpose and upload it. The server resizes it and strips metadata. */
export async function pickAndUpload(source: "camera" | "library", purpose: UploadPurpose = "profile"): Promise<string | null> {
  if (source === "camera") {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) return null;
  }
  const wide = purpose === "team_cover" || purpose === "match";
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: wide ? [16, 9] : [1, 1], quality: 0.75 };
  const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const form = new FormData();
  const name = a.fileName ?? "photo.jpg";
  if (Platform.OS === "web") {
    // Browsers need a real Blob/File; the {uri,name,type} shape only works with the native fetch.
    const blob = await shrinkForUpload(await (await fetch(a.uri)).blob());
    const type = blob.type || a.mimeType || "image/jpeg";
    form.append("file", new File([blob], type === "image/jpeg" ? name.replace(/\.\w+$/, "") + ".jpg" : name, { type }));
  } else {
    form.append("file", { uri: a.uri, name, type: a.mimeType ?? "image/jpeg" } as unknown as Blob);
  }
  form.append("purpose", purpose);
  const out = await api<{ url: string }>("/uploads/images", { method: "POST", form });
  return out.url;
}

/**
 * Browsers hand over the original file (often a 4–12 MB camera photo; the native picker already compresses).
 * Re-encode anything large to a JPEG of at most 1600 px so it fits the server's 5 MB limit and uploads fast on
 * mobile data. Formats the browser can't decode (e.g. HEIC in Chrome) are sent as they are.
 */
async function shrinkForUpload(blob: Blob): Promise<Blob> {
  const g = globalThis as { createImageBitmap?: (b: Blob) => Promise<ImageBitmap>; document?: Document };
  if (blob.size <= 1_500_000 || !g.createImageBitmap || !g.document) return blob;
  try {
    const img = await g.createImageBitmap(blob);
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = g.document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return out && out.size < blob.size ? out : blob;
  } catch {
    return blob;
  }
}

/**
 * A human name for a position, from the phone's own geocoder (nothing is sent to OneShort): "Sector 76, Noida".
 * Null on the web (browsers have no geocoder) or when the phone can't name the place.
 */
export async function placeName(lat: number, lng: number): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const [a] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!a) return null;
    const area = a.district || a.subregion || a.street || a.name;
    const parts = [area, a.city].filter((x, i, all) => !!x && all.indexOf(x) === i);
    return parts.length ? parts.join(", ") : null;
  } catch {
    return null;
  }
}
