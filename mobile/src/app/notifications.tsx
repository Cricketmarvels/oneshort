import type { S } from "@cm/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays, Mail, Megaphone, MessageCircle, ShieldAlert, Swords, TrendingUp, Trophy, Users } from "lucide-react-native";
import { type ReactNode, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";

import { NotificationItem } from "@/components/cricket";
import { openNotification } from "@/lib/notify-nav";
import { EmptyState, ErrorBox, List, LoadingSkeleton, Section, TextLink, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { SP, T } from "@/theme";

type N = S<"NotificationOut">;

type Kind = "all" | "invitations" | "matches" | "teams";
function kindOf(t: string): Exclude<Kind, "all"> | "other" {
  if (t.includes("invit") || t.includes("join") || t === "chat_message") return "invitations";
  if (t.startsWith("result") || t.includes("fixture") || t.includes("match")) return "matches";
  if (t.includes("team") || t.startsWith("challenge")) return "teams";
  return "other";
}
function iconFor(t: string): [ReactNode, string] {
  const k = (I: typeof Bell, c: string, bg: string): [ReactNode, string] => [<I key="i" size={21} color={c} strokeWidth={2} />, bg];
  if (t === "chat_message") return k(MessageCircle, T.primaryDark, T.tint);
  if (t.startsWith("challenge") || t === "team_challenge") return k(Swords, T.dangerText, T.dangerBackground);
  if (t.startsWith("result")) return k(Trophy, T.warningText, T.warningBackground);
  if (t === "rating_updated") return k(TrendingUp, T.warningText, T.warningBackground);
  if (t.startsWith("community")) return k(Megaphone, T.primaryDark, T.tint);
  if (t === "moderation" || t === "report_update") return k(ShieldAlert, T.dangerText, T.dangerBackground);
  if (t.includes("invit") || t.includes("join")) return k(Mail, T.successText, T.successBackground);
  if (t.includes("team")) return k(Users, T.primaryDark, T.tint);
  if (t.includes("match") || t.includes("fixture")) return k(CalendarDays, T.primaryDark, T.tint);
  return k(Bell, T.primaryDark, T.tint);
}

function open(n: N) {
  openNotification(n.type, n.data as Record<string, string | undefined>); // same map as push taps
}

function group(at: string) {
  const d = new Date(at), now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? "This week" : "Earlier";
}

export default function Notifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ data: N[]; meta: { unread: number } }>("/notifications", { query: { page_size: 50 } }) });
  const tap = async (n: N) => {
    if (!n.read) { await api(`/notifications/${n.id}/read`, { method: "POST" }).catch(() => undefined); void qc.invalidateQueries({ queryKey: ["notifications"] }); }
    open(n);
  };
  const [kind, setKind] = useState<Kind>("all");
  const groups: [string, N[]][] = [];
  for (const n of (q.data?.data ?? []).filter((n) => kind === "all" || kindOf(n.type) === kind)) {
    const g = group(n.created_at);
    const last = groups[groups.length - 1];
    if (last && last[0] === g) last[1].push(n); else groups.push([g, [n]]);
  }
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ paddingHorizontal: SP.page, paddingTop: SP.sm, gap: SP.lg, paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={T.primary} />}>
      {q.data?.meta.unread ? (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Txt v="small" color={T.muted}>{q.data.meta.unread} unread</Txt>
          <TextLink title="Mark all read" onPress={async () => { await api("/notifications/read-all", { method: "POST" }); void qc.invalidateQueries({ queryKey: ["notifications"] }); }} />
        </View>
      ) : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 8 }}>
        {([["all", "All"], ["invitations", "Invitations"], ["matches", "Matches"], ["teams", "Teams"]] as const).map(([v, l]) => (
          <Pressable key={v} accessibilityRole="button" accessibilityState={{ selected: kind === v }} onPress={() => setKind(v)}
            style={{ height: 36, paddingHorizontal: 16, borderRadius: 18, justifyContent: "center", backgroundColor: kind === v ? T.primary : T.surface, borderWidth: 1, borderColor: kind === v ? T.primary : T.line }}>
            <Txt v="smallSemi" color={kind === v ? T.surface : T.ink}>{l}</Txt>
          </Pressable>
        ))}
      </ScrollView>
      {q.isPending ? <LoadingSkeleton rows={5} /> : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : !q.data.data.length ? (
        <EmptyState icon={<Bell size={22} color={T.primaryDark} strokeWidth={1.8} />} title="You're all caught up" body="Invitations, match updates and challenges will appear here." />
      ) : !groups.length ? <EmptyState title="Nothing here" body="Try another filter." /> : groups.map(([g, items]) => (
        <Section key={g} title={g}>
          <List>{items.map((n, i) => <NotificationItem key={n.id} title={n.title} body={n.body} at={n.created_at} unread={!n.read} icon={iconFor(n.type)[0]} tone={iconFor(n.type)[1]} onPress={() => void tap(n)} last={i === items.length - 1} />)}</List>
        </Section>
      ))}
    </ScrollView>
  );
}
