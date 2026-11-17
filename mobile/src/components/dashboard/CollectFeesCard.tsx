/**
 * Captain home: once a match is over, a card nudges the captain to settle the match fee — split it if nobody has
 * yet, share a draft that's sitting unshared, or chase what's still outstanding. It disappears once everyone has
 * paid. Data: GET /settlements/collect (finished matches in the last 30 days that aren't settled).
 */
import { formatPaise, type S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Wallet } from "lucide-react-native";
import { View } from "react-native";

import { Button, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { when } from "@/lib/format";
import { R, shadow, SP, T } from "@/theme";

type Due = S<"FeeDueOut">;

function copy(f: Due): { eyebrow: string; title: string; body: string; cta: string } {
  const day = when(f.start_at, { weekday: "short", day: "numeric", month: "short" });
  if (f.stage === "collecting") {
    return {
      eyebrow: "COLLECT MATCH FEE",
      title: `${formatPaise(f.outstanding_paise)} still to collect`,
      body: `${f.paid_count} paid, ${f.pending_count} to go for ${f.title} (${day}). A friendly nudge in the group usually does it.`,
      cta: "Collect payments",
    };
  }
  if (f.stage === "draft") {
    return {
      eyebrow: "SPLIT READY",
      title: "Your fee split isn't shared yet",
      body: `${f.title} (${day})${f.total_paise ? ` · ${formatPaise(f.total_paise)}` : ""}. Share it so every player knows exactly what to pay.`,
      cta: "Review & share",
    };
  }
  return {
    eyebrow: "GOOD GAME!",
    title: "Time to settle the match fee",
    body: `${f.title} (${day}) is done. Add the ground, balls and umpire costs and split them across ${f.squad_size} player${f.squad_size === 1 ? "" : "s"} in a minute.`,
    cta: "Split match fee",
  };
}

function FeeCard({ f }: { f: Due }) {
  const c = copy(f);
  const owed = f.collected_paise + f.outstanding_paise;
  const pct = owed ? Math.round((f.collected_paise / owed) * 100) : 0;
  const open = () => router.push({ pathname: "/fee", params: { ledger: f.match_id, title: f.title } });
  return (
    <View style={{ borderRadius: 20, padding: 16, gap: 10, backgroundColor: T.primarySoft, borderWidth: 1, borderColor: T.line, ...shadow(1) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: T.surface }}>
          <Wallet size={22} color={T.primaryDark} strokeWidth={1.8} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt v="label" color={T.primaryDark}>{c.eyebrow}</Txt>
          <Txt v="h3" numberOfLines={2}>{c.title}</Txt>
        </View>
      </View>
      <Txt v="small" color={T.text2}>{c.body}</Txt>
      {f.stage === "collecting" ? (
        <View style={{ gap: 4 }}>
          <View style={{ height: 8, borderRadius: R.pill, backgroundColor: T.surface, overflow: "hidden" }}>
            <View style={{ width: `${pct}%`, height: "100%", borderRadius: R.pill, backgroundColor: T.primary }} />
          </View>
          <Txt v="small" color={T.muted}>{formatPaise(f.collected_paise)} of {formatPaise(owed)} collected</Txt>
        </View>
      ) : null}
      <Button title={c.cta} size="sm" onPress={open} />
    </View>
  );
}

export function CollectFeesCard() {
  const q = useQuery({ queryKey: ["fees-to-collect"], queryFn: () => api<Due[]>("/settlements/collect"), refetchInterval: 120_000 });
  const items = q.data ?? [];
  if (!items.length) return null;
  return (
    <View style={{ gap: SP.md }}>
      {items.slice(0, 2).map((f) => <FeeCard key={f.match_id} f={f} />)}
      {items.length > 2 ? <Txt v="small" color={T.muted}>+{items.length - 2} more finished match{items.length - 2 === 1 ? "" : "es"} to settle</Txt> : null}
    </View>
  );
}
