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

import { api } from "@/lib/api";
import { hasRemotePush } from "@/lib/device";
import { type NotifyData, openNotification } from "@/lib/notify-nav";

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true, // a chat message or invitation should be heard, not just seen
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

type InboxPage = { data: { id: string; type: string; title: string; body: string; read: boolean; created_at: string; data?: Record<string, unknown> }[] };

/**
 * Sound and banner for new notifications while the app is open, on installs without remote push (for example an
 * Android build with no Firebase Cloud Messaging key yet). Checks the inbox every 20 s and presents anything new
 * as a local notification; tapping it navigates like a push. Does nothing once real push works, so no duplicates.
 */
export function useInAppAlerts(enabled: boolean): void {
  const lastSeen = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || Platform.OS === "web") return;
    let stop = false;
    const check = async () => {
      if (hasRemotePush()) return;
      const page = await api<InboxPage>("/notifications", { query: { page_size: 5 } }).catch(() => null);
      const rows = page?.data ?? [];
      if (stop || !rows.length) return;
      const newest = rows[0]!.id;
      if (lastSeen.current === null) { lastSeen.current = newest; return; } // first run: don't replay old ones
      const fresh: InboxPage["data"] = [];
      for (const n of rows) { if (n.id === lastSeen.current) break; if (!n.read) fresh.push(n); }
      lastSeen.current = newest;
      for (const n of fresh.reverse()) {
        const data: Record<string, string> = { type: n.type };
        for (const [k, v] of Object.entries(n.data ?? {})) if (typeof v === "string") data[k] = v;
        await Notifications.scheduleNotificationAsync({ content: { title: n.title, body: n.body, sound: "default", data }, trigger: Platform.OS === "android" ? { channelId: "default" } : null }).catch(() => undefined);
      }
    };
    void check();
    const t = setInterval(() => void check(), 20_000);
    return () => { stop = true; clearInterval(t); };
  }, [enabled]);
}
