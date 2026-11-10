/**
 * CricHeroes profile links (players + teams) and a player's self-reported CricHeroes stats. GoFindr stores what the
 * person pastes or types and opens the link in the browser; nothing is fetched from CricHeroes, imported or
 * verified, and the stats are always labelled as self-reported. Validation mirrors the server (https, exact
 * cricheroes.com host, /player-profile|/team-profile/<id>/…) — the server is still the authority.
 */
import type { S } from "@cm/shared";
import { useState } from "react";
import { Linking, Pressable, View } from "react-native";

import { PlayRIcon } from "@/components/icons";
import { Button, Field, Txt } from "@/components/ui";
import { R, SP, T } from "@/theme";

export type CHKind = "player" | "team";
export type CHStats = S<"CricHeroesStats">;
type CHStatsOut = S<"CricHeroesStatsOut">;

/** Form fields (strings while typing). `kind` decides parsing and validation. */
const STAT_FIELDS = [
  { k: "matches", l: "Matches", t: "int", max: 5000 },
  { k: "runs", l: "Runs", t: "int", max: 250000 },
  { k: "highest_score", l: "Highest score", t: "hs", ph: "e.g. 87 or 102*" },
  { k: "batting_average", l: "Batting average", t: "num", max: 300 },
  { k: "strike_rate", l: "Strike rate", t: "num", max: 500 },
  { k: "wickets", l: "Wickets", t: "int", max: 10000 },
  { k: "best_bowling", l: "Best bowling", t: "bb", ph: "e.g. 4/18" },
  { k: "economy", l: "Economy", t: "num", max: 36 },
  { k: "catches", l: "Catches", t: "int", max: 5000 },
] as const;
export type StatsForm = Partial<Record<(typeof STAT_FIELDS)[number]["k"], string>>;

export function statsToForm(s: CHStats | null | undefined): StatsForm {
  const f: StatsForm = {};
  if (s) for (const d of STAT_FIELDS) { const v = s[d.k]; if (v != null) f[d.k] = String(v); }
  return f;
}

/** Parse the form: `{ stats }` (null when empty) or `{ error }` naming the first bad field. */
export function formToStats(f: StatsForm): { stats: CHStats | null; error?: string } {
  const out: Record<string, number | string> = {};
  for (const d of STAT_FIELDS) {
    const raw = (f[d.k] ?? "").trim().replace(/,/g, "");
    if (!raw) continue;
    if (d.t === "int" || d.t === "num") {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > d.max || (d.t === "int" && !Number.isInteger(n))) return { stats: null, error: `${d.l}: enter a ${d.t === "int" ? "whole " : ""}number up to ${d.max.toLocaleString("en-IN")}` };
      out[d.k] = n;
    } else if (d.t === "hs") {
      if (!/^\d{1,3}\*?$/.test(raw)) return { stats: null, error: "Highest score: a number, with * if not out (e.g. 102*)" };
      out[d.k] = raw;
    } else {
      if (!/^\d{1,2}\/\d{1,3}$/.test(raw)) return { stats: null, error: "Best bowling: wickets/runs, e.g. 4/18" };
      out[d.k] = raw;
    }
  }
  return { stats: Object.keys(out).length ? (out as CHStats) : null };
}

/** Stats inputs in a two-column grid. */
export function CricHeroesStatsFields({ value, onChange }: { value: StatsForm; onChange: (v: StatsForm) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt v="label">Your CricHeroes stats (optional)</Txt>
      <Txt v="small" color={T.muted}>Copy them from your CricHeroes profile. They're shown as self-reported and don't affect your GoFindr rating.</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
        {STAT_FIELDS.map((d) => (
          <View key={d.k} style={{ width: "47%", flexGrow: 1 }}>
            <Field label={d.l} value={value[d.k] ?? ""} onChangeText={(v) => onChange({ ...value, [d.k]: v })}
              placeholder={"ph" in d ? d.ph : ""} keyboardType={d.t === "int" ? "number-pad" : d.t === "num" ? "decimal-pad" : "numbers-and-punctuation"} maxLength={8} />
          </View>
        ))}
      </View>
    </View>
  );
}

/** Read-only grid on the profile, clearly labelled as self-reported. */
export function CricHeroesStatsGrid({ stats }: { stats: CHStatsOut }) {
  const rows = STAT_FIELDS.filter((d) => stats[d.k] != null);
  if (!rows.length) return null;
  const updated = stats.updated_at ? new Date(stats.updated_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : null;
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {rows.map((d) => (
          <View key={d.k} style={{ width: "31.5%", paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12, backgroundColor: T.surface2, alignItems: "center", gap: 2 }}>
            <Txt v="h3" style={{ fontSize: 17 }}>{typeof stats[d.k] === "number" && d.t === "int" ? (stats[d.k] as number).toLocaleString("en-IN") : String(stats[d.k])}</Txt>
            <Txt v="small" color={T.muted} style={{ fontSize: 11.5, textAlign: "center" }}>{d.l}</Txt>
          </View>
        ))}
      </View>
      <Txt v="small" color={T.faint} style={{ fontSize: 11.5 }}>Self-reported from CricHeroes{updated ? ` · updated ${updated}` : ""} · not verified by GoFindr</Txt>
    </View>
  );
}
const EXAMPLE = { player: "https://cricheroes.com/player-profile/4794795/your-name/stats", team: "https://cricheroes.com/team-profile/1275057/your-team/stats" };
const HOSTS = new Set(["cricheroes.com", "www.cricheroes.com"]);
const PATH = { player: /^\/player-profile\/(\d{1,12})(?:\/[A-Za-z0-9._~%-]{1,120})?(?:\/[a-z-]{1,20})?\/?$/, team: /^\/team-profile\/(\d{1,12})(?:\/[A-Za-z0-9._~%-]{1,120})?(?:\/[a-z-]{1,20})?\/?$/ };

/** Returns null when valid (or empty), else a friendly message. */
export function cricHeroesError(raw: string, kind: CHKind): string | null {
  const v = raw.trim();
  if (!v) return null;
  const withScheme = /^(www\.)?cricheroes\.com\//i.test(v) ? `https://${v}` : v;
  let u: URL;
  try { u = new URL(withScheme); } catch { return `That isn't a valid link. Use e.g. ${EXAMPLE[kind]}`; }
  if (u.protocol !== "https:") return "Only secure https:// CricHeroes links are accepted";
  if (!HOSTS.has(u.hostname.toLowerCase()) || u.username || u.password || (u.port && u.port !== "443")) return "Only links on cricheroes.com are accepted";
  const other: CHKind = kind === "player" ? "team" : "player";
  if (!PATH[kind].test(u.pathname)) return PATH[other].test(u.pathname) ? `That's a CricHeroes ${other} profile — paste your ${kind} profile link` : `That isn't a CricHeroes ${kind} profile link, e.g. ${EXAMPLE[kind]}`;
  return null;
}

export function CricHeroesField({ kind, value, onChange, serverError }: { kind: CHKind; value: string; onChange: (v: string) => void; serverError?: string | null }) {
  const err = cricHeroesError(value, kind) ?? serverError ?? null;
  return (
    <Field label={kind === "player" ? "CricHeroes Player Profile (optional)" : "CricHeroes Team Profile (optional)"} value={value} onChangeText={onChange}
      placeholder={kind === "player" ? "Paste your CricHeroes player profile URL" : "Paste your CricHeroes team profile URL"}
      autoCapitalize="none" autoCorrect={false} keyboardType="url" error={value.trim() ? err : null}
      hint={kind === "player" ? "On CricHeroes open your profile → Share → copy link. Others can then view your stats." : "On CricHeroes open your team → Share → copy link."} />
  );
}

async function openLink(url: string, onError: (m: string) => void) {
  if (!url.startsWith("https://")) return onError("This link can't be opened");
  try {
    const ok = await Linking.canOpenURL(url).catch(() => true);
    if (!ok) return onError("No browser available to open this link");
    await Linking.openURL(url);
  } catch {
    onError("Couldn't open CricHeroes. Check your connection and try again.");
  }
}

/** Public card on player/team pages. Hidden by the caller when there's no link and the viewer can't edit. */
export function CricHeroesCard({ kind, url, onEdit, compact, stats }: { kind: CHKind; url: string | null | undefined; onEdit?: () => void; compact?: boolean; stats?: CHStatsOut | null }) {
  const [err, setErr] = useState<string | null>(null);
  const title = kind === "player" ? "CricHeroes Stats" : "CricHeroes Team Stats";
  const body = kind === "player" ? "View my cricket career statistics, match history, batting and bowling performance." : "Explore our team's cricket statistics, recent matches, and performance on CricHeroes.";
  const action = kind === "player" ? "View CricHeroes Player Stats" : "View CricHeroes Team Stats";
  if (!url && !stats) {
    if (!onEdit) return null;
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={`Add your CricHeroes ${kind} profile`} onPress={onEdit}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: R.card, borderWidth: 1.5, borderStyle: "dashed", borderColor: T.primary, backgroundColor: pressed ? T.primarySoft : "transparent" })}>
        <PlayRIcon name="link" size={22} weight="bold" />
        <View style={{ flex: 1 }}>
          <Txt v="h3" color={T.primaryDark}>Link your CricHeroes {kind === "player" ? "profile" : "team"}</Txt>
          <Txt v="small" color={T.muted}>Optional — {kind === "player" ? "add your profile link and stats so captains can see your record" : "lets others open your team stats on CricHeroes"}.</Txt>
        </View>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: compact ? 8 : 10, padding: compact ? 14 : SP.lg, borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: T.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <PlayRIcon name="stats" size={22} weight="duotone" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="h3">{title}</Txt>
          {!compact ? <Txt v="small" color={T.muted}>{body}</Txt> : null}
        </View>
        {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel="Edit CricHeroes link" onPress={onEdit} hitSlop={10}><Txt v="smallSemi" color={T.primaryDark}>Edit</Txt></Pressable> : null}
      </View>
      {stats && !compact ? <CricHeroesStatsGrid stats={stats} /> : null}
      {url ? (<>
      <Pressable accessibilityRole="link" accessibilityLabel={`${action}, opens cricheroes.com`} onPress={() => { setErr(null); void openLink(url, setErr); }}
        style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, height: 46, borderRadius: R.button, backgroundColor: pressed ? T.pressedSoft : T.primarySoft })}>
        <Txt v="h3" color={T.primaryDark} style={{ fontSize: 15 }}>{action}</Txt>
        <PlayRIcon name="external" size={18} color={T.primaryDark} weight="bold" />
      </Pressable>
      {err ? <Txt v="small" color={T.dangerText}>{err}</Txt> : <Txt v="small" color={T.faint} style={{ fontSize: 11.5 }}>Opens cricheroes.com · stats there aren't verified by GoFindr</Txt>}
      </>) : null}
    </View>
  );
}

/** Inline editor: paste / change / remove. `save(null)` removes. */
export function CricHeroesEditor({ kind, current, currentStats, save, onClose }: {
  kind: CHKind; current: string | null | undefined; currentStats?: CHStats | null;
  save: (url: string | null, stats?: CHStats | null) => Promise<void>; onClose: () => void;
}) {
  const [v, setV] = useState(current ?? "");
  const [form, setForm] = useState<StatsForm>(statsToForm(currentStats));
  const parsed = kind === "player" ? formToStats(form) : { stats: null };
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (url: string | null, stats?: CHStats | null) => {
    setBusy(true); setErr(null);
    try { await save(url, stats); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); } finally { setBusy(false); }
  };
  const invalid = !!v.trim() && !!cricHeroesError(v, kind);
  return (
    <View style={{ gap: 12, padding: SP.lg, borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }}>
      <CricHeroesField kind={kind} value={v} onChange={setV} serverError={err} />
      {kind === "player" ? <CricHeroesStatsFields value={form} onChange={setForm} /> : null}
      {parsed.error ? <Txt v="small" color={T.dangerText}>{parsed.error}</Txt> : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button title="Save" size="sm" disabled={(kind === "team" ? !v.trim() : !v.trim() && !parsed.stats) || invalid || !!parsed.error} loading={busy}
          onPress={() => void run(v.trim() || null, kind === "player" ? parsed.stats : undefined)} style={{ flex: 1 }} />
        {current || currentStats ? <Button title="Remove" size="sm" variant="secondary" disabled={busy} onPress={() => void run(null, kind === "player" ? null : undefined)} style={{ flex: 1 }} /> : null}
        <Button title="Cancel" size="sm" variant="ghost" onPress={onClose} />
      </View>
    </View>
  );
}
