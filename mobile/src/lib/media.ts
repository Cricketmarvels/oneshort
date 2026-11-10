/** Resolve media links. The API returns short-lived signed paths ("/api/v1/media/…"); resolve them against the API origin. */
import { API_URL } from "@/lib/config";

/** Read per call: beta builds can change the server at runtime (lib/config.ts). */
const origin = () => (/^https?:\/\//i.test(API_URL) ? API_URL.replace(/\/api\/v\d+\/?$/, "") : "");

export function mediaUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u.startsWith("/api/") || u.startsWith("/uploads/")) return `${origin()}${u}`; // signed media link from the API (relative → same origin on web)
  if (/^https:\/\//i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)/i.test(u)) return u;
  return null; // anything else (data:, javascript:, plain http to third parties) is never rendered
}
