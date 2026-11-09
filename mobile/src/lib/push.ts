/**
 * Push notification handling (docs/design/PUSH_NOTIFICATIONS.md).
 *
 * - Foreground: notifications are shown as banners (the server already filtered by preference).
 * - Tap (background, foreground or cold start): navigate through the same map as the in-app inbox.
 * - Signed out or mid-consent when tapped: the target is parked and opened after authentication,
 *   mirroring how captain invite links resume (lib/joinlink.ts).
 */
import * as Notifications from "expo-notifications";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { create } from "zustand";

import { type NotifyData, openNotification } from "@/lib/notify-nav";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

type Pending = { target: { type?: string; data: NotifyData } | null; set: (t: { type?: string; data: NotifyData }) => void; clear: () => void };
export const usePendingNotification = create<Pending>((set) => ({
  target: null,
  set: (target) => set({ target }),
  clear: () => set({ target: null }),
}));

function payloadOf(response: Notifications.NotificationResponse): { type?: string; data: NotifyData } {
  const raw = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
  const data: NotifyData = {};
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") data[k] = v;
  return { type: data.type, data };
}

/**
 * Mount once (root Gate). `ready` = authenticated with the agreement satisfied; until then taps are parked.
 * Handles cold start (app launched by a tap) via the last-response API, and later taps via the listener.
 */
export function usePushNavigation(ready: boolean): void {
  const pending = usePendingNotification();
  const coldStartChecked = useRef(false);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      usePendingNotification.getState().set(payloadOf(response));
    });
    if (!coldStartChecked.current) {
      coldStartChecked.current = true;
      void Notifications.getLastNotificationResponseAsync().then((response) => {
        if (response) usePendingNotification.getState().set(payloadOf(response));
      });
    }
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!ready || !pending.target) return;
    const { type, data } = pending.target;
    pending.clear();
    openNotification(type, data);
  }, [ready, pending.target]); // eslint-disable-line react-hooks/exhaustive-deps
}
