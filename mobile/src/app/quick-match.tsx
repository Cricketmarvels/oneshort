/**
 * Quick Match (refined spec §5.9): games near you that need players soon, filtered by Today / Weekend and distance.
 * Shows only host-supplied facts; the per-head amount is labelled "est." and a request is never shown as a reserved slot.
 */
import { formatPaise, type S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { FlatList, View } from "react-native";

import { GameRow } from "@/components/refined";
import { PhotoBanner } from "@/components/starter";
import { Chip, EmptyState, ErrorBox, LoadingSkeleton, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useIsCaptain } from "@/lib/roles";
import { roleCount, when } from "@/lib/format";
import { useLocation } from "@/lib/location";
import { SP, T } from "@/theme";

type Opp = S<"OpportunityOut">;
type When = "any" | "today" | "weekend";

function windowFor(w: When): { start_at?: string; end_at?: string } {
  const now = new Date();
  if (w === "today") { const e = new Date(now); e.setHours(23, 59, 0, 0); return { start_at: now.toISOString(), end_at: e.toISOString() }; }
  if (w === "weekend") {
    const dow = now.getDay(); // 0 Sun … 6 Sat
    const sun = new Date(now); sun.setDate(now.getDate() + (dow === 0 ? 0 : 7 - dow)); sun.setHours(23, 59, 0, 0);
    const sat = new Date(sun); sat.setDate(sun.getDate() - 1); sat.setHours(0, 0, 0, 0);
    return { start_at: (now > sat ? now : sat).toISOString(), end_at: sun.toISOString() };
  }
  return {};
}

export default function QuickMatch() {
  const captain = useIsCaptain();
  const { lat, lng, label } = useLocation();
  const [w, setW] = useState<When>("any");
  const [radius, setRadius] = useState<5 | 10 | 20>(10);
  const win = useMemo(() => windowFor(w), [w]);
  const q = useQuery({
    queryKey: ["quick-match", lat, lng, radius, w],
    queryFn: () => api<{ data: Opp[] }>("/discovery/teams", { method: "POST", body: { radius_km: radius, location: { lat, lng }, page_size: 50, ...win } }),
  });
  const rows = (q.data?.data ?? []).filter((o) => o.vacancies > 0).sort((a, b) => +new Date(a.start_at) - +new Date(b.start_at) || a.approx_distance_km - b.approx_distance_km);
  return (
    <FlatList
      style={{ backgroundColor: T.bg }}
      contentContainerStyle={{ padding: SP.page, gap: SP.md, paddingBottom: 80 }}
      data={q.isPending || q.isError ? [] : rows}
      keyExtractor={(o) => o.match_id}
      refreshing={q.isRefetching}
      onRefresh={() => void q.refetch()}
      ListHeaderComponent={
        <View style={{ gap: SP.lg, marginBottom: SP.sm }}>
          <PhotoBanner photo="ground" title="Your next game could be around the corner" body={`Games with open spots within ${radius} km of ${label}`} />
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {(["any", "today", "weekend"] as const).map((v) => <Chip key={v} label={{ any: "Any day", today: "Today", weekend: "Weekend" }[v]} active={w === v} onPress={() => setW(v)} />)}
            {([5, 10, 20] as const).map((r) => <Chip key={r} label={`${r} km`} active={radius === r} onPress={() => setRadius(r)} />)}
          </View>
          {q.isPending ? <LoadingSkeleton rows={4} /> : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : rows.length ? (
            <Txt v="small" color={T.muted}>{rows.length} game{rows.length === 1 ? "" : "s"} · soonest first · requests are confirmed by the host</Txt>
          ) : null}
        </View>
      }
      ListEmptyComponent={q.isPending || q.isError ? undefined : (
        <EmptyState title="No open games right now" body={captain ? "Try a wider distance or another day — or start your own match and invite players." : "Try a wider distance or another day. Sharing your availability lets captains find you."} action={captain ? "Create a match" : "Share availability"} onAction={() => router.push(captain ? "/match/new" : "/availability")} />
      )}
      renderItem={({ item: o }) => (
        <GameRow
          title={o.title}
          time={when(o.start_at, { weekday: "short", hour: "numeric", minute: "2-digit" }).toUpperCase()}
          meta={`${o.area ?? o.city ?? "Venue TBC"} · ${o.format === "OTHER" ? "Practice" : o.format} · ~${o.approx_distance_km} km${Object.keys(o.roles_needed).length ? ` · needs ${Object.entries(o.roles_needed).map(([r, n]) => roleCount(r, n).toLowerCase()).join(", ")}` : ""}`}
          spots={o.vacancies}
          fee={o.per_head_fee_paise ? `${formatPaise(o.per_head_fee_paise)} est.` : null}
          cta={o.my_status ? o.my_status.charAt(0).toUpperCase() + o.my_status.slice(1) : "Request to join"}
          onPress={() => router.push({ pathname: "/match/[id]", params: { id: o.match_id } })}
        />
      )}
    />
  );
}
