import * as Device from "expo-device";
import * as ImagePicker from "expo-image-picker";
import * as Location from "expo-location";
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
 * Push delivery stays inactive until FCM credentials are configured server-side.
 */
export async function registerForPush(): Promise<void> {
  if (!Device.isDevice) return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Match updates", importance: Notifications.AndroidImportance.HIGH });
  }
  const perm = await Notifications.requestPermissionsAsync();
  const granted = Platform.OS === "ios" ? perm.ios?.status === Notifications.IosAuthorizationStatus.AUTHORIZED || perm.granted : perm.granted;
  if (!granted) return;
  const token = await Notifications.getDevicePushTokenAsync();
  await api("/users/me/devices", { method: "POST", body: { platform: Platform.OS === "ios" ? "ios" : "android", push_token: String(token.data) } }).catch(() => undefined);
}

/** Pick or capture a photo and upload it. Returns the hosted URL. */
export async function pickAndUpload(source: "camera" | "library", purpose: "profile" | "team" = "profile"): Promise<string | null> {
  if (source === "camera") {
    const p = await ImagePicker.requestCameraPermissionsAsync();
    if (!p.granted) return null;
  }
  const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.7 };
  const res = source === "camera" ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
  if (res.canceled || !res.assets[0]) return null;
  const a = res.assets[0];
  const form = new FormData();
  form.append("file", { uri: a.uri, name: a.fileName ?? "photo.jpg", type: a.mimeType ?? "image/jpeg" } as unknown as Blob);
  form.append("purpose", purpose);
  const out = await api<{ url: string }>("/uploads/images", { method: "POST", form });
  return out.url;
}
