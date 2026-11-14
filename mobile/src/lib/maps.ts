/** Open a ground in the phone's maps app. The Google Maps search URL opens Apple Maps/Google Maps on iOS, Google Maps on Android, and the browser on web. */
import { Linking } from "react-native";

export async function openInMaps(lat: number, lng: number, label?: string | null): Promise<void> {
  const q = label ? `${lat},${lng}(${encodeURIComponent(label)})` : `${lat},${lng}`;
  try { await Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`); } catch { /* no maps app available */ }
}
