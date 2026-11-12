/**
 * @cm/shared: API contracts + domain helpers shared by web and mobile.
 * `api-types.ts` is GENERATED from the FastAPI OpenAPI schema (`npm run gen`); never edit by hand.
 */
import type { components } from "./api-types";

export type { components, paths } from "./api-types";
export type Schemas = components["schemas"];
export type S<K extends keyof Schemas> = Schemas[K];

// Frequently used aliases
export type UserMe = S<"UserOut">;
export type PublicUser = S<"PublicUserOut">;
export type PlayerSelf = S<"PlayerSelfOut">;
export type PlayerPublic = S<"PlayerPublicOut">;
export type Team = S<"TeamOut">;
export type TeamMember = S<"TeamMemberOut">;
export type Match = S<"MatchOut">;
export type Invitation = S<"InvitationOut">;
export type Availability = S<"AvailabilityOut">;
export type Settlement = S<"SettlementOut">;
export type PaymentRecord = S<"PaymentRecordOut">;
export type PlayingRole = S<"PlayingRole">;
export type MatchStatus = S<"MatchStatus">;
export type InvitationStatus = S<"InvitationStatus">;
export type PaymentStatus = S<"PaymentStatus">;

export interface ApiErrorBody {
  error: { code: string; message: string; details: Array<Record<string, unknown>> };
  request_id?: string | null;
}

// ------------------------------------------------------------------ money
/** Format integer paise as Indian rupees, e.g. 45000 → "₹450", 33334 → "₹333.34". */
export function formatPaise(paise: number | null | undefined): string {
  const p = paise ?? 0;
  const rupees = Math.trunc(p / 100);
  const rem = Math.abs(p % 100);
  const base = "₹" + rupees.toLocaleString("en-IN");
  return rem ? `${base}.${String(rem).padStart(2, "0")}` : base;
}

/** Parse a rupee string/number entered by a user into integer paise (no floating-point drift). */
export function rupeesToPaise(input: string | number): number {
  const s = String(input).replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{0,2})?$/.test(s)) return NaN;
  const [whole, frac = ""] = s.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

// ------------------------------------------------------------------ labels
export const ROLE_LABELS: Record<PlayingRole, string> = {
  batsman: "Batsman",
  bowler: "Bowler",
  wicketkeeper: "Wicketkeeper",
  all_rounder: "All-rounder",
};
export const ROLE_SHORT: Record<PlayingRole, string> = {
  batsman: "BAT",
  bowler: "BOWL",
  wicketkeeper: "WK",
  all_rounder: "AR",
};
export const PLAYING_ROLES: PlayingRole[] = ["batsman", "bowler", "wicketkeeper", "all_rounder"];

export const MATCH_STATUS_LABELS: Record<MatchStatus, string> = {
  draft: "Draft",
  published: "Published",
  recruiting: "Recruiting",
  squad_confirmed: "Squad confirmed",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};
export const MATCH_LIFECYCLE: MatchStatus[] = [
  "draft", "published", "recruiting", "squad_confirmed", "scheduled", "in_progress", "completed",
];

export const INVITATION_STATUS_LABELS: Record<InvitationStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  rejected: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
  confirmed: "Confirmed",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Pending",
  paid: "Paid",
  exempted: "Exempted",
  disputed: "Disputed",
};

export type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";
export const STATUS_TONE: Record<string, Tone> = {
  draft: "neutral", published: "info", recruiting: "brand", squad_confirmed: "success", scheduled: "success",
  in_progress: "warning", completed: "neutral", cancelled: "danger",
  pending: "warning", accepted: "info", rejected: "danger", expired: "neutral", confirmed: "success",
  paid: "success", exempted: "neutral", disputed: "danger",
  available: "success", tentative: "warning", unavailable: "danger", partial: "warning", unknown: "neutral",
  open: "warning", investigating: "info", resolved: "success", dismissed: "neutral",
};

/**
 * Default operating city and map centre: Noida, Uttar Pradesh.
 * Used as the map's initial view, the registration default, and - when the dev
 * "use default location" flag is on - as the user's current location.
 */
export const DEFAULT_CITY = "Noida";
export const DEFAULT_LOCATION = { lat: 28.5355, lng: 77.391 } as const;

export const SEARCH_RADII_KM = [5, 10, 15, 20] as const;
export const MATCH_FORMATS = ["T10", "T20", "ODI", "OTHER"] as const;
export const MATCH_CATEGORIES = ["friendly", "corporate", "tournament", "practice"] as const;

// ------------------------------------------------------------------ time
/** All API datetimes are UTC ISO strings. Format in the viewer's (or match's) timezone. */
export function formatDateTime(iso: string, tz?: string, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
    timeZone: tz, ...opts,
  }).format(new Date(iso));
}
export function formatTime(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}
export function formatDay(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: tz })
    .format(new Date(iso));
}
export function timeRange(startIso: string, endIso: string, tz?: string): string {
  return `${formatTime(startIso, tz)} – ${formatTime(endIso, tz)}`;
}
/**
 * "in 3 hours" / "2 days ago". Hermes on Android ships without `Intl.RelativeTimeFormat`, so the
 * plain-English fallback below is what phones actually use; browsers and Node keep the real thing.
 */
function relativeFallback(value: number, unit: "second" | "minute" | "hour" | "day"): string {
  const n = Math.abs(value);
  if (unit === "second" && n < 5) return "just now";
  const noun = n === 1 ? unit : `${unit}s`;
  return value < 0 ? `${n} ${noun} ago` : `in ${n} ${noun}`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const diff = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diff);
  const RTF = (Intl as { RelativeTimeFormat?: typeof Intl.RelativeTimeFormat }).RelativeTimeFormat;
  const native = RTF ? new RTF("en", { numeric: "auto" }) : null;
  const fmt = native ? (v: number, u: "second" | "minute" | "hour" | "day") => native.format(v, u) : relativeFallback;
  if (abs < 60) return fmt(Math.round(diff), "second");
  if (abs < 3600) return fmt(Math.round(diff / 60), "minute");
  if (abs < 86400) return fmt(Math.round(diff / 3600), "hour");
  return fmt(Math.round(diff / 86400), "day");
}

// ------------------------------------------------------------------ validation (shared regexes)
export const MOBILE_REGEX = /^(\+[1-9]\d{7,14}|[6-9]\d{9})$/;
export const OTP_REGEX = /^\d{6}$/;
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

export function normaliseMobile(input: string): string {
  const v = input.replace(/[\s-]/g, "");
  return /^[6-9]\d{9}$/.test(v) ? `+91${v}` : v;
}

// ------------------------------------------------------------------ sharing
/** WhatsApp deep link. Opening it does NOT guarantee delivery. */
export function whatsappLink(text: string, phoneE164?: string): string {
  const phone = phoneE164 ? phoneE164.replace(/^\+/, "") : "";
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

// ------------------------------------------------------------------ CricHeroes manual entry
export type CricHeroesProfile = S<"CricHeroesProfileOut">;
export type CricHeroesSnapshotIn = S<"CricHeroesSnapshotIn">;

/** "Name - Role" / "Name, Role" / "Name" per line -> players. Blank lines ignored, max 200. */
export function parseRosterText(text: string): { name: string; sub_title?: string }[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 200)
    .map((line) => {
      const m = line.match(/^(.+?)\s*(?:\s[-–—]\s|,|\|)\s*(.+)$/);
      const name = (m?.[1] ?? line).trim().slice(0, 80);
      const role = m?.[2]?.trim().slice(0, 200);
      return role ? { name, sub_title: role } : { name };
    });
}

/** "Label: value" per line -> stats. Lines without a colon are skipped, max 50. */
export function parseStatsText(text: string): { label: string; value: string }[] {
  return text
    .split(/\r?\n/)
    .flatMap((l) => {
      const m = l.match(/^\s*([^:]{1,60}?)\s*:\s*(.{1,40}?)\s*$/);
      return m?.[1] && m[2] ? [{ label: m[1], value: m[2] }] : [];
    })
    .slice(0, 50);
}
