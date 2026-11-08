/**
 * Refined UI primitives (spec: .claude/skills/playr-refined-ui). Warm canvas, white tiles with a
 * soft-aqua icon well, dark "local sports circle" hero, small kicker chips, role steppers and the
 * radar "searching" state used by the captain request flow.
 */
import { router } from "expo-router";
import { Minus, Plus } from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, View, type ViewStyle } from "react-native";

import { PlayRIcon } from "@/components/icons";
import { Txt } from "@/components/ui";
import { R, SP, T } from "@/theme";

export type IconT = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

/** Small uppercase kicker chip: "STEP 1 OF 3", "YOUR LOCAL SPORTS CIRCLE", "4 SPOTS LEFT". */
export function KickerChip({ label, tone = "aqua", style }: { label: string; tone?: "aqua" | "dark" | "orange" | "success"; style?: ViewStyle }) {
  const c = {
    aqua: [T.primarySoft, T.primaryDark],
    dark: ["rgba(255,255,255,0.14)", "#FFFFFF"],
    orange: [T.accentOrangeSoft, "#9A5B0E"],
    success: [T.successBackground, T.successText],
  }[tone];
  return (
    <View style={[{ alignSelf: "flex-start", paddingHorizontal: 12, height: 26, borderRadius: R.pill, backgroundColor: c[0], justifyContent: "center" }, style]}>
      <Txt v="micro" color={c[1]} style={{ fontSize: 10.5, letterSpacing: 0.5 }}>{label}</Txt>
    </View>
  );
}

/** Section title row with an optional deep-teal text action. */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 28 }}>
      <Txt v="h2" style={{ fontSize: 17 }}>{title}</Txt>
      {action && onAction ? (
        <Pressable accessibilityRole="button" hitSlop={12} onPress={onAction}><Txt v="smallSemi" color={T.primaryDark}>{action}</Txt></Pressable>
      ) : null}
    </View>
  );
}

/** "Make something happen" tile: white card, soft-aqua icon well, single label (+ optional real hint). */
export function ActionTile({ icon: Icon, title, hint, onPress, tone = "aqua" }: { icon: IconT; title: string; hint?: string; onPress: () => void; tone?: "aqua" | "slate" }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={hint ? `${title}. ${hint}` : title} onPress={onPress}
      style={({ pressed }) => ({ flex: 1, minHeight: 76, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 12, borderRadius: R.card, backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: T.line })}>
      <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: tone === "aqua" ? T.primarySoft : "#EAF0F4", alignItems: "center", justifyContent: "center" }}>
        <Icon size={20} color={T.primaryDark} strokeWidth={2} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Txt v="h3" numberOfLines={2} style={{ fontSize: 14.5, lineHeight: 19 }}>{title}</Txt>
        {hint ? <Txt v="small" color={T.muted} numberOfLines={2} style={{ fontSize: 12, lineHeight: 16 }}>{hint}</Txt> : null}
      </View>
    </Pressable>
  );
}

/** 2×2 grid of ActionTiles. */
export function ActionGrid({ tiles }: { tiles: Parameters<typeof ActionTile>[0][] }) {
  const rows = [tiles.slice(0, 2), tiles.slice(2, 4)];
  return (
    <View style={{ gap: 10 }}>
      {rows.map((r, i) => <View key={i} style={{ flexDirection: "row", gap: 10 }}>{r.map((t, j) => <ActionTile key={t.title} tone={(i + j) % 2 ? "slate" : "aqua"} {...t} />)}</View>)}
    </View>
  );
}

/** Dark ink hero card ("YOUR LOCAL SPORTS CIRCLE"). Content must be backed by real data. */
export function PulseCard({ kicker, title, body, cta, onPress }: { kicker: string; title: string; body?: string; cta?: string; onPress?: () => void }) {
  return (
    <Pressable accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={`${title}. ${body ?? ""}`} disabled={!onPress} onPress={onPress}
      style={({ pressed }) => ({ borderRadius: 22, padding: 20, gap: 10, backgroundColor: pressed ? "#163231" : T.heroInk })}>
      <KickerChip label={kicker} tone="dark" />
      <Txt v="h1" color="#FFFFFF" style={{ fontSize: 22, lineHeight: 28 }}>{title}</Txt>
      {body ? <Txt v="small" color="rgba(255,255,255,0.78)">{body}</Txt> : null}
      {cta ? <Txt v="smallSemi" color="#7FE0D6">{cta} →</Txt> : null}
    </Pressable>
  );
}

/** Choice card (onboarding "I'm a Player" / sport rows): selected = soft aqua + teal border. */
export function ChoiceCard({ title, body, selected, onPress, left, right }: { title: string; body?: string; selected?: boolean; onPress: () => void; left?: ReactNode; right?: ReactNode }) {
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ selected: !!selected }} accessibilityLabel={`${title}. ${body ?? ""}`} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 14, padding: 16, minHeight: 76, borderRadius: R.card, borderWidth: selected ? 1.5 : 1, borderColor: selected ? T.primary : T.line, backgroundColor: selected ? T.primarySoft : pressed ? T.surface2 : T.surface })}>
      {left}
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Txt v="h3" color={selected ? T.primaryDark : T.ink}>{title}</Txt>
        {body ? <Txt v="small" color={T.muted}>{body}</Txt> : null}
      </View>
      {right}
    </Pressable>
  );
}

/** Pill used inside cards: "SELECT", "VIEW", "JOIN GAME". */
export function PillAction({ label, onPress, active }: { label: string; onPress?: () => void; active?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} hitSlop={8}
      style={({ pressed }) => ({ paddingHorizontal: 14, height: 30, borderRadius: R.pill, justifyContent: "center", backgroundColor: active ? T.primary : pressed ? T.pressedSoft : T.primarySoft })}>
      <Txt v="micro" color={active ? "#FFFFFF" : T.primaryDark} style={{ fontSize: 11, letterSpacing: 0.4 }}>{label}</Txt>
    </Pressable>
  );
}

/** − n + stepper for "how many of this role do you need". */
export function RoleStepper({ label, hint, value, onChange, max = 11 }: { label: string; hint?: string; value: number; onChange: (n: number) => void; max?: number }) {
  const btn = (dir: -1 | 1, Icon: IconT, disabled: boolean) => (
    <Pressable accessibilityRole="button" accessibilityLabel={`${dir < 0 ? "Fewer" : "More"} ${label}`} disabled={disabled} onPress={() => onChange(value + dir)}
      style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: disabled ? T.surface2 : pressed ? T.pressedSoft : T.primarySoft, opacity: disabled ? 0.5 : 1 })}>
      <Icon size={18} color={T.primaryDark} strokeWidth={2.4} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 56 }}>
      <View style={{ flex: 1 }}>
        <Txt v="h3">{label}</Txt>
        {hint ? <Txt v="small" color={T.muted}>{hint}</Txt> : null}
      </View>
      {btn(-1, Minus, value <= 0)}
      <Txt v="stat" accessibilityLabel={`${value} ${label}`} style={{ width: 28, textAlign: "center", fontSize: 20 }}>{value}</Txt>
      {btn(1, Plus, value >= max)}
    </View>
  );
}

/** Ola/Uber-style radar pulse shown while the search runs. */
export function RadarSearch({ title, body }: { title: string; body?: string }) {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];
  useEffect(() => {
    const anims = rings.map((v, i) => Animated.loop(Animated.sequence([
      Animated.delay(i * 600),
      Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
    ])));
    anims.forEach((a) => a.start());
    return () => anims.forEach((a) => a.stop());
  }, [rings]);
  return (
    <View accessibilityRole="progressbar" accessibilityLabel={title} style={{ alignItems: "center", paddingVertical: SP.xxl, gap: SP.lg }}>
      <View style={{ width: 220, height: 220, alignItems: "center", justifyContent: "center" }}>
        {rings.map((v, i) => (
          <Animated.View key={i} style={{ position: "absolute", width: 220, height: 220, borderRadius: 110, borderWidth: 2, borderColor: T.primary,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }] }} />
        ))}
        <View style={{ width: 132, height: 132, borderRadius: 66, backgroundColor: T.primarySoft, alignItems: "center", justifyContent: "center" }}>
          <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: T.primary, alignItems: "center", justifyContent: "center" }}>
            <Txt v="h2" color="#FFFFFF">P</Txt>
          </View>
        </View>
      </View>
      <View style={{ alignItems: "center", gap: 4, paddingHorizontal: SP.xl }}>
        <Txt v="h2" style={{ textAlign: "center" }}>{title}</Txt>
        {body ? <Txt v="small" color={T.muted} style={{ textAlign: "center" }}>{body}</Txt> : null}
      </View>
    </View>
  );
}

/** Progress "2 of 4 spots filled" bar. */
export function FillBar({ filled, total }: { filled: number; total: number }) {
  const pct = total ? Math.min(1, filled / total) : 0;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Txt v="smallSemi">{filled} of {total} spot{total === 1 ? "" : "s"} filled</Txt>
        <Txt v="small" color={T.muted}>{Math.max(0, total - filled)} open</Txt>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: T.surface2, borderWidth: 1, borderColor: T.line, overflow: "hidden" }}>
        <View style={{ width: `${pct * 100}%`, height: "100%", backgroundColor: pct >= 1 ? T.successText : T.primary }} />
      </View>
    </View>
  );
}

/** Game row for "Happening near you" / Quick Match. Shows only supplied facts. */
export function GameRow({ title, meta, time, fee, spots, onPress, cta = "View" }: { title: string; meta: string; time?: string; fee?: string | null; spots?: number; onPress: () => void; cta?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${meta}`} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", gap: 14, padding: 14, borderRadius: R.card, backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: T.line })}>
      <View style={{ width: 64, borderRadius: 14, backgroundColor: T.primarySoft, alignItems: "center", justifyContent: "center", paddingVertical: 10 }}>
        <Txt v="h2" color={T.primaryDark}>{spots ?? "–"}</Txt>
        <Txt v="small" color={T.primaryDark} style={{ fontSize: 11 }}>spot{spots === 1 ? "" : "s"}</Txt>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        {time ? <KickerChip label={time} /> : null}
        <Txt v="h3" numberOfLines={1}>{title}</Txt>
        <Txt v="small" color={T.muted} numberOfLines={1}>{meta}</Txt>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 }}>
          <Txt v="smallSemi" color={fee ? "#9A5B0E" : T.faint}>{fee ?? ""}</Txt>
          <Txt v="smallSemi" color={T.primaryDark}>{cta} →</Txt>
        </View>
      </View>
    </Pressable>
  );
}

export const goFindPlayers = () => router.push("/match/players");

// ---------------------------------------------------------------- feed (refined spec §5.6)
export type FeedPost = {
  id: string; community_id: string; type: string; body: string; created_at: string; event_at?: string | null;
  author: { id: string; full_name: string; profile_image?: string | null }; author_role?: string | null;
  community_name?: string | null; community_area?: string | null; approx_distance_km?: number | null; community_joined?: boolean | null;
  poll?: { text: string; votes: number }[] | null; my_vote?: number | null; can_remove?: boolean;
};

const LOOKING = /\b(need|needed|looking for|short of|require)\b/i;
/** Post-type chip: real post type, plus "LOOKING FOR PLAYERS" when the text asks for players. */
export function postChip(p: Pick<FeedPost, "type" | "body">): { label: string; tone: "aqua" | "orange" | "success" } | null {
  if (p.type === "match") return { label: "MATCH DAY", tone: "aqua" };
  if (p.type === "tournament") return { label: "TOURNAMENT", tone: "aqua" };
  if (p.type === "announcement") return { label: "TEAM ANNOUNCEMENT", tone: "success" };
  if (p.type === "poll") return { label: "POLL", tone: "aqua" };
  if (LOOKING.test(p.body)) return { label: "LOOKING FOR PLAYERS", tone: "orange" };
  return null;
}

export function FeedPostCard({ p, ago, onMore, onOpen, onShare, onVote }: {
  p: FeedPost; ago: string; onMore: () => void; onOpen: () => void; onShare: () => void; onVote?: (i: number) => void;
}) {
  const chip = postChip(p);
  const where = [p.community_name, p.community_area, p.approx_distance_km != null ? `~${p.approx_distance_km} km` : null].filter(Boolean).join(" · ");
  const total = p.poll?.reduce((a, o) => a + o.votes, 0) ?? 0;
  return (
    <View style={{ backgroundColor: T.surface, borderRadius: R.card, borderWidth: 1, borderColor: T.line, padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <AvatarLite name={p.author.full_name} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="h3" numberOfLines={1} style={{ fontSize: 15 }}>{p.author.full_name}{p.author_role && p.author_role !== "member" ? <Txt v="small" color={T.muted}> · {p.author_role}</Txt> : null}</Txt>
          <Txt v="small" color={T.muted} numberOfLines={1}>{ago}{where ? ` · ${where}` : ""}</Txt>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Post options: hide, report or block" onPress={onMore} hitSlop={10} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}>
          <Txt v="h2" color={T.muted} style={{ marginTop: -8 }}>…</Txt>
        </Pressable>
      </View>
      {chip ? <KickerChip label={chip.label} tone={chip.tone} /> : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Open in community" onPress={onOpen}>
        <Txt v="body" numberOfLines={6}>{p.body}</Txt>
      </Pressable>
      {p.poll ? (
        <View style={{ gap: 6 }}>
          {p.poll.map((o, i) => {
            const share = total ? o.votes / total : 0;
            return (
              <Pressable key={i} accessibilityRole="button" accessibilityLabel={`Vote ${o.text}`} disabled={p.my_vote != null || !onVote} onPress={() => onVote?.(i)}
                style={{ minHeight: 44, borderRadius: 12, overflow: "hidden", borderWidth: 1, borderColor: p.my_vote === i ? T.primary : T.line, justifyContent: "center" }}>
                <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.round(share * 100)}%`, backgroundColor: p.my_vote != null ? T.primarySoft : "transparent" }} />
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14 }}>
                  <Txt v="body" style={{ fontSize: 14 }}>{o.text}</Txt>
                  {p.my_vote != null ? <Txt v="small" color={T.muted}>{Math.round(share * 100)}%</Txt> : null}
                </View>
              </Pressable>
            );
          })}
          <Txt v="small" color={T.muted}>{total} vote{total === 1 ? "" : "s"}</Txt>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 18, paddingTop: 2 }}>
        <Pressable accessibilityRole="button" onPress={onOpen} hitSlop={8}><Txt v="smallSemi" color={T.primaryDark}>{p.community_joined === false ? "View community" : "Reply in community"}</Txt></Pressable>
        <Pressable accessibilityRole="button" onPress={onShare} hitSlop={8}><Txt v="smallSemi" color={T.muted}>Share</Txt></Pressable>
      </View>
    </View>
  );
}

function AvatarLite({ name }: { name: string }) {
  const ini = name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return <View style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: T.primarySoft, alignItems: "center", justifyContent: "center" }}><Txt v="smallSemi" color={T.primaryDark}>{ini}</Txt></View>;
}

export const REPORT_REASONS = ["Spam or scam", "Abusive or hateful", "Harassment", "Fake or misleading", "Something else"] as const;

/** Sheet body: hide post, report post (reason), block author. Calls the real endpoints; shows the outcome inline. */
export function ReportBlockSheet({ post, onHide, onReport, onBlock, busy, result }: {
  post: FeedPost; onHide: () => void; onReport: (reason: string) => void; onBlock: () => void; busy: boolean; result: string | null;
}) {
  const [reason, setReason] = useState<string | null>(null);
  return (
    <View style={{ gap: SP.lg }}>
      {result ? <View style={{ padding: 14, borderRadius: 14, backgroundColor: T.successBackground }}><Txt v="smallSemi" color={T.successText}>{result}</Txt></View> : null}
      <View style={{ gap: 6 }}>
        <Txt v="h3">Hide this post</Txt>
        <Txt v="small" color={T.muted}>Removes it from your feeds only.</Txt>
        <SheetAction label="Hide post" onPress={onHide} disabled={busy} />
      </View>
      <View style={{ gap: 8 }}>
        <Txt v="h3">Report</Txt>
        <Txt v="small" color={T.muted}>Community moderators review reports. Posts reported by several members are hidden until reviewed.</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {REPORT_REASONS.map((r) => <PillAction key={r} label={r.toUpperCase()} active={reason === r} onPress={() => setReason(r)} />)}
        </View>
        <SheetAction label="Send report" onPress={() => reason && onReport(reason)} disabled={!reason || busy} />
      </View>
      <View style={{ gap: 6 }}>
        <Txt v="h3">Block {post.author.full_name}</Txt>
        <Txt v="small" color={T.muted}>You won't see their posts anywhere. They aren't told. You can unblock from your profile.</Txt>
        <SheetAction label={`Block ${post.author.full_name.split(" ")[0]}`} onPress={onBlock} disabled={busy} danger />
      </View>
    </View>
  );
}

function SheetAction({ label, onPress, disabled, danger }: { label: string; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: danger ? T.dangerBackground : T.line, backgroundColor: danger ? (pressed ? "#F3D6D6" : T.dangerBackground) : pressed ? T.surface2 : T.surface, opacity: disabled ? 0.5 : 1 })}>
      <Txt v="smallSemi" color={danger ? T.dangerText : T.ink} style={{ fontSize: 15 }}>{label}</Txt>
    </Pressable>
  );
}

// ---------------------------------------------------------------- discovery helpers
/** 5 / 10 / 20 km chips. */
export function RadiusSelector<V extends string | number>({ value, options, onChange }: { value: V; options: V[]; onChange: (v: V) => void }) {
  return (
    <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="radiogroup">
      {options.map((o) => (
        <Pressable key={String(o)} accessibilityRole="radio" accessibilityState={{ selected: value === o }} onPress={() => onChange(o)}
          style={{ paddingHorizontal: 12, height: 34, borderRadius: R.pill, justifyContent: "center", backgroundColor: value === o ? T.primarySoft : T.surface, borderWidth: 1, borderColor: value === o ? T.primary : T.line }}>
          <Txt v="smallSemi" color={value === o ? T.primaryDark : T.ink}>{o} km</Txt>
        </Pressable>
      ))}
    </View>
  );
}

export function MapListToggle({ value, onChange }: { value: "map" | "list"; onChange: (v: "map" | "list") => void }) {
  return (
    <View style={{ flexDirection: "row", padding: 3, borderRadius: R.pill, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }} accessibilityRole="tablist">
      {(["map", "list"] as const).map((v) => (
        <Pressable key={v} accessibilityRole="tab" accessibilityState={{ selected: value === v }} onPress={() => onChange(v)}
          style={{ paddingHorizontal: 14, height: 30, borderRadius: R.pill, justifyContent: "center", backgroundColor: value === v ? T.primary : "transparent" }}>
          <Txt v="smallSemi" color={value === v ? "#FFFFFF" : T.muted}>{v === "map" ? "Map" : "List"}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Schematic map preview: pins placed by real venue coordinates relative to the search centre (equirectangular).
 * No tiles — it's a position guide; "Open in Maps" is the real map. Venue locations are public places.
 */
export function MapPreview({ center, pins, selected, onSelect, height = 240, radiusKm }: {
  center: { lat: number; lng: number }; pins: { id: string; lat: number; lng: number; label: string }[];
  selected?: string | null; onSelect: (id: string) => void; height?: number; radiusKm: number;
}) {
  const kmLat = 110.574, kmLng = 111.32 * Math.cos((center.lat * Math.PI) / 180);
  const span = Math.max(2, Math.min(radiusKm, Math.max(...pins.map((p) => Math.max(Math.abs(p.lat - center.lat) * kmLat, Math.abs(p.lng - center.lng) * kmLng)), 2) * 1.15));
  return (
    <View style={{ height, borderRadius: R.card, overflow: "hidden", backgroundColor: "#E7EFEA", borderWidth: 1, borderColor: T.line }} accessibilityLabel={`Map preview with ${pins.length} places`}>
      {[0.25, 0.5, 0.75].map((f) => <View key={`h${f}`} style={{ position: "absolute", left: 0, right: 0, top: `${f * 100}%`, height: 1, backgroundColor: "rgba(23,43,43,0.06)" }} />)}
      {[0.25, 0.5, 0.75].map((f) => <View key={`v${f}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${f * 100}%`, width: 1, backgroundColor: "rgba(23,43,43,0.06)" }} />)}
      <View style={{ position: "absolute", left: "8%", right: "12%", top: "58%", height: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.8)", transform: [{ rotate: "-12deg" }] }} />
      <View style={{ position: "absolute", top: "6%", bottom: "10%", left: "62%", width: 6, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.8)", transform: [{ rotate: "18deg" }] }} />
      <View style={{ position: "absolute", left: "50%", top: "50%", width: 14, height: 14, marginLeft: -7, marginTop: -7, borderRadius: 7, backgroundColor: T.heroInk, borderWidth: 3, borderColor: "#FFFFFF" }} accessibilityLabel="Search centre" />
      {pins.map((p) => {
        const x = 50 + ((p.lng - center.lng) * kmLng / span) * 45;
        const y = 50 - ((p.lat - center.lat) * kmLat / span) * 45;
        const on = selected === p.id;
        return (
          <Pressable key={p.id} accessibilityRole="button" accessibilityLabel={p.label} onPress={() => onSelect(p.id)} hitSlop={10}
            style={{ position: "absolute", left: `${Math.max(4, Math.min(96, x))}%`, top: `${Math.max(6, Math.min(94, y))}%`, width: on ? 24 : 18, height: on ? 24 : 18, marginLeft: on ? -12 : -9, marginTop: on ? -12 : -9, borderRadius: 12, backgroundColor: on ? T.accentOrange : T.primary, borderWidth: 3, borderColor: "#FFFFFF" }} />
        );
      })}
      <View style={{ position: "absolute", left: 10, bottom: 8, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: "rgba(255,255,255,0.85)" }}><Txt v="small" color={T.muted} style={{ fontSize: 11 }}>Approximate positions · dark dot = search centre</Txt></View>
    </View>
  );
}

/** Achievement row: earned = soft aqua medal; in progress = real progress bar. */
export function AchievementBadge({ title, description, earned, progress, target }: { title: string; description: string; earned: boolean; progress: number; target: number }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }} accessibilityLabel={`${title}. ${description}. ${earned ? "Earned" : `${progress} of ${target}`}`}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: earned ? T.primarySoft : T.surface2, borderWidth: earned ? 0 : 1, borderColor: T.line, alignItems: "center", justifyContent: "center" }}>
        <PlayRIcon name="star" size={22} color={earned ? T.primaryDark : T.faint} weight={earned ? "fill" : "regular"} />
      </View>
      <View style={{ flex: 1, gap: 4 }}>
        <Txt v="h3" color={earned ? T.ink : T.muted}>{title}</Txt>
        <Txt v="small" color={T.muted}>{description}</Txt>
        {!earned ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: T.surface2, overflow: "hidden" }}><View style={{ width: `${Math.min(100, (progress / target) * 100)}%`, height: "100%", backgroundColor: T.primary }} /></View>
            <Txt v="small" color={T.muted} style={{ fontSize: 11 }}>{progress}/{target}</Txt>
          </View>
        ) : null}
      </View>
      {earned ? <KickerChip label="EARNED" tone="success" /> : null}
    </View>
  );
}
