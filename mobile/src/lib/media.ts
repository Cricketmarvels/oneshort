/** Resolve stored media paths. PlayR stores uploads as relative "/uploads/…" paths; resolve them against the API origin. */
import { API_URL } from "@/lib/config";

const ORIGIN = /^https?:\/\//i.test(API_URL) ? API_URL.replace(/\/api\/v\d+\/?$/, "") : "";

export function mediaUrl(u: string | null | undefined): string | null {
  if (!u) return null;
  if (u.startsWith("/uploads/")) return `${ORIGIN}${u}`; // web build uses a relative API → same origin
  if (/^https:\/\//i.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)/i.test(u)) return u;
  return null; // anything else (data:, javascript:, plain http to third parties) is never rendered
}
