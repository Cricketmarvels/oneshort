/**
 * Captain home: once a match is over, a card nudges the captain to settle the match fee — split it if nobody has
 * yet, share a draft that's sitting unshared, or chase what's still outstanding. It disappears once everyone has
 * paid. Data: GET /settlements/collect (finished matches in the last 30 days that aren't settled).
 *
 * Look: the "aurora" green of the home banners. While collecting, a ring shows how much is in and "Remind all"
 * sends every unpaid player their own reminder (amount + UPI ID) without leaving home.
 */
import { formatPaise, type S } from "@cm/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { BellRing, ChevronRight, Send, Split, Users } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import Svg, { Circle } from "react-native-svg";

import { AuroraBackground } from "@/components/dashboard/SportsIllustrationCard";
import { Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { when } from "@/lib/format";
import { FW } from "@/theme";

type Due = S<"FeeDueOut">;

const INK = "#102C28";
const INK2 = "#3D5652";
const GREEN = "#0B7F58";
const AURORA = { base: ["#D5F5E3", "#BDEBD3"], glow: "#A8EBC9", deep: "#7FD8B0" } as const;
const SHADOW = { shadowColor: "#183B35", shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.13, shadowRadius: 12, elevation: 5 } as const;

function copy(f: Due): { eyebrow: string; title: string; body: string; cta: string } {
  if (f.stage === "collecting") {
    return { eyebrow: "COLLECT MATCH FEE", title: `${formatPaise(f.outstanding_paise)} to collect`, body: "", cta: "Open" };
  }
  if (f.stage === "draft") {
    return {
      eyebrow: "SPLIT READY",
      title: f.total_paise ? `${formatPaise(f.total_paise)} split, not shared yet` : "Your split isn't shared yet",
      body: "Share it so every player knows exactly what to pay.",
      cta: "Review & share",
    };
  }
  return {
    eyebrow: "GOOD GAME!",
    title: "Time to settle the match fee",
    body: `Add the ground, balls and umpire costs and split them across ${f.squad_size} player${f.squad_size === 1 ? "" : "s"} in a minute.`,
    cta: "Split match fee",
  };
}

function Ring({ pct }: { pct: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: 68, height: 68, alignItems: "center", justifyContent: "center" }} accessibilityLabel={`${pct}% collected`}>
      <Svg width={68} height={68} viewBox="0 0 36 36" style={{ position: "absolute", transform: [{ rotate: "-90deg" }] }}>
        <Circle cx={18} cy={18} r={r} fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth={4} />
        {pct > 0 ? <Circle cx={18} cy={18} r={r} fill="none" stroke={GREEN} strokeWidth={4} strokeLinecap="round" strokeDasharray={`${(Math.max(pct, 4) / 100) * c} ${c}`} /> : null}
      </Svg>
      <Txt style={{ ...FW.display, fontSize: 15, color: INK }}>{pct}%</Txt>
    </View>
  );
}

function Pill({ children, icon }: { children: string; icon?: React.ReactNode }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, backgroundColor: "rgba(255,255,255,0.72)", borderWidth: 1, borderColor: "rgba(255,255,255,0.95)" }}>
      {icon}
      <Txt style={{ ...FW.semibold, fontSize: 12, color: INK }}>{children}</Txt>
    </View>
  );
}

function Action({ title, onPress, primary, icon, trailing, busy, flex, label }: { title: string; onPress: () => void; primary?: boolean; icon?: React.ReactNode; trailing?: React.ReactNode; busy?: boolean; flex?: number; label?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? title} onPress={onPress} disabled={busy}
      style={({ pressed }) => ({ ...(flex ? { flex } : {}), height: 48, borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, transform: [{ scale: pressed ? 0.98 : 1 }],
        backgroundColor: primary ? (pressed ? "#09694A" : GREEN) : "rgba(255,255,255,0.92)",
        shadowColor: primary ? GREEN : "#183B35", shadowOffset: { width: 0, height: primary ? 5 : 3 }, shadowOpacity: primary ? 0.3 : 0.1, shadowRadius: primary ? 8 : 6, elevation: primary ? 3 : 1 })}>
      {busy ? <ActivityIndicator size="small" color={primary ? "#FFFFFF" : GREEN} /> : icon}
      <Txt style={{ ...FW.bold, fontSize: 15, color: primary ? "#FFFFFF" : GREEN }}>{title}</Txt>
      {trailing}
    </Pressable>
  );
}

function FeeCard({ f }: { f: Due }) {
  const c = copy(f);
  const owed = f.collected_paise + f.outstanding_paise;
  const pct = owed ? Math.round((f.collected_paise / owed) * 100) : 0;
  const day = when(f.start_at, { weekday: "short", day: "numeric", month: "short" });
  const open = () => router.push({ pathname: "/fee", params: { ledger: f.match_id, title: f.title } });
  const [note, setNote] = useState<string | null>(null);
  const remind = useMutation({
    mutationFn: () => api<S<"RemindAllOut">>(`/settlements/${f.settlement_id}/remind-all`, { method: "POST", body: {} }),
    onSuccess: (r) => {
      const who = r.reminded === 1 ? "1 player" : `${r.reminded} players`;
      const guests = r.guests.length ? ` ${r.guests.join(", ")} ${r.guests.length === 1 ? "isn't" : "aren't"} on OneShort: send them the group message.` : "";
      setNote(r.reminded ? `Reminder sent to ${who}, each with their amount and your UPI ID.${guests}` : `Nobody on OneShort left to remind.${guests}`);
    },
    onError: (e) => setNote(errorText(e)),
  });
  const collecting = f.stage === "collecting";
  const StageIcon = f.stage === "draft" ? Send : Split;

  return (
    <View style={[{ borderRadius: 22 }, SHADOW]}>
      <View style={{ borderRadius: 22, overflow: "hidden", padding: 18, gap: 14 }}>
        <AuroraBackground id={`fee-${f.match_id}`} colors={AURORA} />
        <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, top: 0, height: 1, backgroundColor: "rgba(255,255,255,0.75)" }} />

        <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Txt style={{ ...FW.bold, fontSize: 11, letterSpacing: 1.1, color: GREEN }}>{c.eyebrow}</Txt>
            <Txt style={{ ...FW.display, fontSize: collecting ? 24 : 19, lineHeight: collecting ? 28 : 23, letterSpacing: -0.3, color: INK }}>{c.title}</Txt>
            <Txt style={{ ...FW.medium, fontSize: 13, color: INK2 }} numberOfLines={2}>{f.title} · {day}</Txt>
          </View>
          {collecting ? <Ring pct={pct} /> : (
            <View style={{ width: 56, height: 56, borderRadius: 18, backgroundColor: "rgba(255,255,255,0.8)", alignItems: "center", justifyContent: "center" }}>
              <StageIcon size={26} color={GREEN} strokeWidth={1.9} />
            </View>
          )}
        </View>

        {collecting ? (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Pill icon={<Users size={14} color={INK} strokeWidth={2} />}>{`${f.paid_count} paid · ${f.pending_count} pending`}</Pill>
            <Pill>{`${formatPaise(f.collected_paise)} of ${formatPaise(owed)}`}</Pill>
          </View>
        ) : <Txt style={{ ...FW.medium, fontSize: 13.5, lineHeight: 19, color: INK2 }}>{c.body}</Txt>}

        {collecting && f.settlement_id && f.pending_count ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Action primary flex={1.4} title="Remind all" label={`Remind all ${f.pending_count} unpaid players`} busy={remind.isPending} onPress={() => remind.mutate()}
              icon={<BellRing size={17} color="#FFFFFF" strokeWidth={2} />} />
            <Action flex={1} title="Open" onPress={open} label="Open collect payments" />
          </View>
        ) : (
          <Action primary title={collecting ? "Collect payments" : c.cta} onPress={open} trailing={<ChevronRight size={17} color="#FFFFFF" strokeWidth={2.2} />} />
        )}
        {note ? <Txt style={{ ...FW.medium, fontSize: 12.5, lineHeight: 17, color: INK2 }}>{note}</Txt> : null}
      </View>
    </View>
  );
}

export function CollectFeesCard() {
  const q = useQuery({ queryKey: ["fees-to-collect"], queryFn: () => api<Due[]>("/settlements/collect"), refetchInterval: 120_000 });
  const items = q.data ?? [];
  if (!items.length) return null;
  return (
    <View style={{ gap: 12 }}>
      {items.slice(0, 2).map((f) => <FeeCard key={f.match_id} f={f} />)}
      {items.length > 2 ? <Txt style={{ ...FW.medium, fontSize: 13, color: INK2 }}>+{items.length - 2} more finished match{items.length - 2 === 1 ? "" : "es"} to settle</Txt> : null}
    </View>
  );
}
