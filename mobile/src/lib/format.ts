import type { Category, FixtureFormat, Scope } from "./types";

export const SCOPES: { v: Scope; l: string }[] = [
  { v: "5km", l: "5 km" }, { v: "10km", l: "10 km" }, { v: "20km", l: "20 km" }, { v: "50km", l: "50 km" },
  { v: "city", l: "City" }, { v: "state", l: "State" }, { v: "national", l: "National" },
];
export const CATEGORIES: { v: Category; l: string }[] = [
  { v: "overall", l: "Overall" }, { v: "batting", l: "Best Batter" }, { v: "bowling", l: "Best Bowler" },
  { v: "all_rounder", l: "All-rounder" }, { v: "fielding", l: "Best Fielder" }, { v: "consistency", l: "Most Consistent" }, { v: "rising", l: "Rising Stars" },
];
export const FORMATS: { v: FixtureFormat; l: string }[] = [
  { v: "T10", l: "T10" }, { v: "T15", l: "T15" }, { v: "T20", l: "T20" }, { v: "30_OVER", l: "30-over" }, { v: "40_OVER", l: "40-over" }, { v: "CUSTOM", l: "Custom" },
];
export const formatLabel = (f: string) => FORMATS.find((x) => x.v === f)?.l ?? f;

export const ROLE: Record<string, string> = { batsman: "Batter", bowler: "Bowler", all_rounder: "All-rounder", wicketkeeper: "Wicketkeeper" };
export const roleLabel = (r?: string | null) => (r ? ROLE[r] ?? r : "Player");
/** "1 Batter", "2 Bowlers", "3 All-rounders". */
export const roleCount = (r: string, n: number) => `${n} ${roleLabel(r)}${n === 1 ? "" : "s"}`;

const IST = "Asia/Kolkata";
export const when = (iso: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: IST, ...opts });
export const day = (iso: string) => when(iso, { day: "numeric", month: "short" });
export const overs = (balls: number) => `${Math.floor(balls / 6)}${balls % 6 ? `.${balls % 6}` : ""}`;
export const rating = (r?: number | null) => (r == null ? "—" : String(Math.round(r)));
export const pct = (v: number) => `${Math.round(v * 100)}%`;

export const CHALLENGE_LABEL: Record<string, string> = {
  draft: "Draft", pending: "Pending", accepted: "Accepted", counter_proposed: "Counter-proposed", confirmed: "Confirmed",
  rejected: "Rejected", cancelled: "Cancelled", completed: "Completed",
};
export const CHALLENGE_TONE: Record<string, string> = {
  draft: "neutral", pending: "warning", accepted: "info", counter_proposed: "warning", confirmed: "lime", rejected: "danger", cancelled: "neutral", completed: "success",
};
