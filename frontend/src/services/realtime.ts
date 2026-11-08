import type { QueryClient } from "@tanstack/react-query";

import { useAuth } from "@/app/store/auth";

import { API_BASE } from "./api/client";

/**
 * Real-time updates over a native WebSocket. Events only invalidate cached queries;
 * the REST API stays the source of truth. Reconnects with backoff.
 */
const EVENT_KEYS: Record<string, string[][]> = {
  "notification.created": [["notifications"], ["dashboard"]],
  "invitation.updated": [["invitations"], ["dashboard"], ["matches"]],
  "roster.updated": [["roster"], ["matches"], ["dashboard"]],
  "match.updated": [["matches"], ["dashboard"]],
  "payment.updated": [["payments"], ["settlements"], ["dashboard"]],
  "team.membership.updated": [["teams"], ["dashboard"]],
};

export function connectRealtime(qc: QueryClient): () => void {
  let ws: WebSocket | null = null;
  let stopped = false;
  let attempt = 0;
  let ping: ReturnType<typeof setInterval> | undefined;

  const open = () => {
    const token = useAuth.getState().accessToken;
    if (stopped || !token) return;
    const base = API_BASE.startsWith("http") ? API_BASE.replace(/^http/, "ws") : `${location.origin.replace(/^http/, "ws")}${API_BASE}`;
    ws = new WebSocket(`${base}/ws?token=${encodeURIComponent(token)}`);
    ws.onopen = () => {
      attempt = 0;
      ping = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send("ping"), 25_000);
    };
    ws.onmessage = (msg) => {
      try {
        const { event } = JSON.parse(String(msg.data)) as { event: string };
        for (const key of EVENT_KEYS[event] ?? []) void qc.invalidateQueries({ queryKey: key });
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.onclose = () => {
      clearInterval(ping);
      if (stopped) return;
      attempt += 1;
      setTimeout(open, Math.min(30_000, 1000 * 2 ** attempt));
    };
  };
  open();
  return () => {
    stopped = true;
    clearInterval(ping);
    ws?.close();
  };
}
