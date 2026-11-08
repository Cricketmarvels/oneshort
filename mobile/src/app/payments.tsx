import { formatPaise, type S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronRight, Wallet } from "lucide-react-native";
import { useState } from "react";
import { RefreshControl, ScrollView, View } from "react-native";

import { Badge, Card, ChipRow, EmptyState, ErrorBox, LoadingSkeleton, Stat, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { when } from "@/lib/format";
import { R, SP, T } from "@/theme";

const STATUS: Record<string, [string, string]> = { pending: ["warning", "To pay"], paid: ["success", "Paid"], exempted: ["neutral", "Exempt"], disputed: ["danger", "Disputed"] };

/** Every match fee I'm part of, across pickup and team matches. */
export default function MyFees() {
  const [filter, setFilter] = useState<"all" | "pending" | "paid" | "disputed">("all");
  const q = useQuery({ queryKey: ["payments", filter], queryFn: () => api<S<"PlayerDashboardOut">>("/settlements/me", { query: { status: filter === "all" ? undefined : filter } }) });
  if (q.isPending) return <View style={{ padding: SP.page }}><LoadingSkeleton rows={4} /></View>;
  if (q.isError) return <View style={{ padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View>;
  const d = q.data;
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />}>
      <View style={{ backgroundColor: T.tint, borderRadius: R.xl, padding: SP.xl, gap: SP.md, borderWidth: 1, borderColor: T.line }}>
        <Txt v="label" color={T.accent}>You owe</Txt>
        <Txt v="hero">{formatPaise(d.outstanding_paise)}</Txt>
        <View style={{ flexDirection: "row", gap: SP.md }}>
          <Stat label="Paid so far" value={formatPaise(d.paid_paise)} />
          <Stat label="To pay" value={d.pending_count} />
          <Stat label="Disputed" value={d.disputed_count} />
        </View>
        <Txt v="small" color={T.text2}>Pay your captain directly by cash or UPI. They mark it paid; PlayR doesn't process payments.</Txt>
      </View>
      <ChipRow value={filter} onChange={setFilter} options={[{ v: "all", l: "All" }, { v: "pending", l: "To pay" }, { v: "paid", l: "Paid" }, { v: "disputed", l: "Disputed" }]} />
      {!d.records.length ? <EmptyState icon={<Wallet size={22} color={T.ink} strokeWidth={1.5} />} title={filter === "all" ? "No match fees yet" : "Nothing here"} body="When a captain shares a fee split that includes you, it shows up here." /> : d.records.map((r) => (
        <Card key={r.id} onPress={() => router.push({ pathname: "/fee", params: { ledger: r.match_id, title: r.match_title } })} label={`${r.match_title}, ${formatPaise(r.amount_paise)}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="h3" numberOfLines={1}>{r.match_title}</Txt>
              <Txt v="small" color={T.muted}>{r.team_name} · {when(r.match_start_at, { day: "numeric", month: "short" })} · captain {r.captain.full_name}</Txt>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Txt v="number" style={{ fontSize: 17 }}>{formatPaise(r.amount_paise)}</Txt>
              <Badge status={STATUS[r.status]?.[0] ?? "neutral"} label={STATUS[r.status]?.[1] ?? r.status} />
            </View>
            <ChevronRight size={18} color={T.muted} strokeWidth={1.5} />
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
