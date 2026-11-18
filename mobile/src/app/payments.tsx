/**
 * Manage fees (player). Three questions, in order: what do I owe and to whom; what has cricket cost me
 * (by team, by month, filterable by year/month); and the individual fee records to pay or dispute.
 * Captains mark payments; OneShort never moves money.
 */
import { formatPaise, type S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ChevronRight, Wallet } from "lucide-react-native";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";

import { SectionHeader } from "@/components/refined";
import { Badge, Card, Chip, ChipRow, EmptyState, ErrorBox, LoadingSkeleton, Segmented, Stat, Txt } from "@/components/ui";
import { SpendBars, seriesColor } from "@/components/viz";
import { api } from "@/lib/api";
import { when } from "@/lib/format";
import { R, SP, T } from "@/theme";

type Spend = S<"SpendOut">;
type Period = "month" | "year" | "all";

const STATUS: Record<string, [string, string]> = { pending: ["warning", "To pay"], paid: ["success", "Paid"], exempted: ["neutral", "Exempt"], disputed: ["danger", "Disputed"], carried_forward: ["neutral", "Moved"] };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const now = new Date();

export default function ManageFees() {
  const { width } = useWindowDimensions();
  const [period, setPeriod] = useState<Period>("year");
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [team, setTeam] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "pending" | "paid" | "disputed">("all");

  const params = period === "all" ? {} : period === "year" ? { year } : { year, month };
  const spend = useQuery({ queryKey: ["spend", params], queryFn: () => api<Spend>("/settlements/me/spend", { query: params }), placeholderData: (prev) => prev });
  const fees = useQuery({ queryKey: ["payments", filter], queryFn: () => api<S<"PlayerDashboardOut">>("/settlements/me", { query: { status: filter === "all" ? undefined : filter } }) });
  const refresh = () => { void spend.refetch(); void fees.refetch(); };

  if (spend.isPending || fees.isPending) return <View style={{ padding: SP.page }}><LoadingSkeleton rows={5} /></View>;
  if (spend.isError) return <View style={{ padding: SP.page }}><ErrorBox error={spend.error} onRetry={refresh} /></View>;
  if (fees.isError) return <View style={{ padding: SP.page }}><ErrorBox error={fees.error} onRetry={refresh} /></View>;

  const sp = spend.data;
  const years = sp.years.length ? sp.years : [now.getFullYear()];
  const teamIds = sp.teams.map((t) => t.team_id);
  const periodLabel = period === "all" ? "all time" : period === "year" ? String(year) : `${MONTHS[month - 1]} ${year}`;
  const records = (fees.data.records ?? []).filter((r) => !team || r.team_id === team);
  const teamName = team ? sp.teams.find((t) => t.team_id === team)?.team_name : null;

  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.section, paddingBottom: 60 }}
      refreshControl={<RefreshControl refreshing={spend.isRefetching || fees.isRefetching} onRefresh={refresh} tintColor={T.primary} />}>
      {/* What I owe — never filtered by period: a debt from last season is still a debt. */}
      <View style={{ backgroundColor: T.tint, borderRadius: R.xl, padding: SP.xl, gap: SP.md, borderWidth: 1, borderColor: T.line }}>
        <Txt v="label" color={T.accent}>You owe</Txt>
        <Txt v="hero">{formatPaise(sp.owed_paise)}</Txt>
        <View style={{ flexDirection: "row", gap: SP.md }}>
          <Stat label={`Spent · ${periodLabel}`} value={formatPaise(sp.paid_paise)} />
          <Stat label="Matches" value={sp.matches} />
          <Stat label="Teams" value={sp.teams.length} />
        </View>
        <Txt v="small" color={T.text2}>Pay your captain by cash or UPI; they mark it paid here.</Txt>
      </View>

      {/* Period */}
      <View style={{ gap: SP.sm }}>
        <Segmented value={period} onChange={setPeriod} options={[{ v: "month", l: "Month" }, { v: "year", l: "Year" }, { v: "all", l: "All time" }]} />
        {period !== "all" && years.length > 1 ? (
          <ChipRow value={String(year)} onChange={(v) => setYear(Number(v))} options={years.map((y) => ({ v: String(y), l: String(y) }))} />
        ) : null}
        {period === "month" ? (
          <ChipRow value={String(month)} onChange={(v) => setMonth(Number(v))} options={MONTHS.map((l, i) => ({ v: String(i + 1), l }))} />
        ) : null}
      </View>

      {/* By team */}
      <View style={{ gap: SP.md }}>
        <SectionHeader title="By team" action={team ? "Show all" : undefined} onAction={() => setTeam(null)} />
        {!sp.teams.length ? (
          <EmptyState icon={<Wallet size={22} color={T.ink} strokeWidth={1.5} />} title="No match fees yet" body="When a captain shares a fee split that includes you, your teams show up here." />
        ) : sp.teams.map((t, i) => {
          const on = team === t.team_id;
          return (
            <Pressable key={t.team_id} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`${t.team_name}: owe ${formatPaise(t.owed_paise)}, spent ${formatPaise(t.paid_paise)}`}
              onPress={() => setTeam(on ? null : t.team_id)}
              style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: R.card, borderWidth: on ? 1.5 : 1, borderColor: on ? T.primary : T.line, backgroundColor: on ? T.primarySoft : T.surface }}>
              <View style={{ width: 10, height: 36, borderRadius: 5, backgroundColor: seriesColor(i) }} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Txt v="h3" numberOfLines={1}>{t.team_name}</Txt>
                <Txt v="small" color={T.muted}>{t.matches} match{t.matches === 1 ? "" : "es"} · spent {formatPaise(t.paid_paise)}</Txt>
              </View>
              <View style={{ alignItems: "flex-end", gap: 2 }}>
                <Txt v="number" style={{ fontSize: 17 }} color={t.owed_paise ? T.dangerText : T.ink}>{formatPaise(t.owed_paise)}</Txt>
                <Txt v="micro" color={T.muted}>{t.owed_paise ? "to pay" : "settled"}</Txt>
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Spend over time, stacked by team */}
      {sp.months.length ? (
        <Card label={`Spend by month, ${periodLabel}`}>
          <Txt v="h3">Spend across teams</Txt>
          <SpendBars months={sp.months} teams={teamIds} w={width - 2 * SP.page - 2 * SP.lg} h={150} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {sp.teams.filter((t) => t.paid_paise > 0).map((t, i) => (
              <View key={t.team_id} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: seriesColor(teamIds.indexOf(t.team_id) < 0 ? i : teamIds.indexOf(t.team_id)) }} />
                <Txt v="small" color={T.muted}>{t.team_name}</Txt>
              </View>
            ))}
          </View>
        </Card>
      ) : sp.teams.length ? (
        <Txt v="small" color={T.muted}>Nothing paid in {periodLabel}. Pick another period to see your spending.</Txt>
      ) : null}

      {/* Records */}
      <View style={{ gap: SP.md }}>
        <SectionHeader title={teamName ? `Fees · ${teamName}` : "Your fees"} />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {([["all", "All"], ["pending", "To pay"], ["paid", "Paid"], ["disputed", "Disputed"]] as const).map(([v, l]) => <Chip key={v} label={l} active={filter === v} onPress={() => setFilter(v)} />)}
        </View>
        {!records.length ? (
          <EmptyState icon={<Wallet size={22} color={T.ink} strokeWidth={1.5} />} title={filter === "all" && !team ? "No match fees yet" : "Nothing here"} body={team ? "No fees from this team match the filter." : "When a captain shares a fee split that includes you, it shows up here."} />
        ) : records.map((r) => (
          <Card key={r.id} onPress={() => router.push({ pathname: "/fee", params: { ledger: r.match_id, title: r.match_title } })} label={`${r.match_title}, ${formatPaise(r.amount_paise)}`}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1, gap: 2 }}>
                <Txt v="h3" numberOfLines={1}>{r.match_title}</Txt>
                <Txt v="small" color={T.muted}>{r.team_name} · {when(r.match_start_at, { day: "numeric", month: "short" })} · captain {r.captain.full_name}</Txt>
                {r.carried_to_match_title ? <Txt v="small" color={T.text2} numberOfLines={2}>Added to the {r.carried_to_match_title} fee</Txt>
                  : r.carried_paise ? <Txt v="small" color={T.text2}>Includes {formatPaise(r.carried_paise)} unpaid from earlier matches</Txt> : null}
              </View>
              <View style={{ alignItems: "flex-end", gap: 4 }}>
                <Txt v="number" style={{ fontSize: 17 }}>{formatPaise(r.amount_paise)}</Txt>
                <Badge status={STATUS[r.status]?.[0] ?? "neutral"} label={STATUS[r.status]?.[1] ?? r.status} />
              </View>
              <ChevronRight size={18} color={T.muted} strokeWidth={1.5} />
            </View>
          </Card>
        ))}
      </View>
    </ScrollView>
  );
}
