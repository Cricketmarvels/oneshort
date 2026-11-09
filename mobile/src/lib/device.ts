import * as Device from "expo-device";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
import Constants from "expo-constants";
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
 * With EXPO_PUBLIC_USE_DEFAULT_LOCATION=true (dev default) it returns Noida without touching GPS.
 */
export async function currentLocation(): Promise<{ lat: number; lng: number } | null> {
  if (USE_DEFAULT_LOCATION) return { ...DEFAULT_LOCATION };
  const { granted } = await Location.requestForegroundPermissionsAsync();
  if (!granted) return null;
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

/**
 * Registers the native FCM/APNs device token with the backend (FCM adapter).
 * Remote push needs a development/production build with an EAS project id; Expo Go has no remote
 * push, so registration quietly skips there instead of storing undeliverable native tokens.
 */
export async function registerForPush(): Promise<void> {
  if (!Device.isDevice) return;
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
  await api("/users/me/devices", { method: "POST", body: { platform: Platform.OS === "ios" ? "ios" : "android", push_token: token.data } }).catch(() => undefined);
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
  form.append("file", { uri: a.uri, name: a.fileName ?? "photo.jpg", type: a.mimeType ?? "image/jpeg" } as unknown as Blob);
  form.append("purpose", purpose);
  const out = await api<{ url: string }>("/uploads/images", { method: "POST", form });
  return out.url;
}
