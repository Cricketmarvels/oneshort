import { formatDay, formatPaise, MATCH_STATUS_LABELS, timeRange, type S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { MapPin, Share2, Users, Wallet } from "lucide-react-native";
import { Alert, Linking, ScrollView, Share, View } from "react-native";

import { CommitChoice, ManagedInvitationRow } from "@/components/invites";
import { CancelMatch } from "@/components/match-admin";
import { KickerChip } from "@/components/refined";
import { MatchCoverImage, MediaEditButton } from "@/components/media";
import { InviteRegularsCard } from "@/components/regulars";
import { Avatar, Badge, Button, Card, Chip, ErrorBox, InlineNotice, List, LoadingSkeleton, Section, Txt } from "@/components/ui";
import { roleCount, roleLabel } from "@/lib/format";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SP, T } from "@/theme";

export default function MatchDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useQuery({ queryKey: ["match", id], queryFn: () => api<S<"MatchOut">>(`/matches/${id}`) });
  const inSquad = q.data && ["roster", "manager"].includes(q.data.viewer_relation);
  const roster = useQuery({ queryKey: ["roster", id], enabled: !!inSquad, queryFn: () => api<S<"RosterOut">>(`/matches/${id}/roster`) });
  const invs = useQuery({ queryKey: ["invitations", "match", id], enabled: q.data?.viewer_relation === "manager", queryFn: () => api<S<"InvitationOut">[]>(`/matches/${id}/invitations`) });
  const [joinMsg, setJoinMsg] = useState<string | null>(null);
  const qc = useQueryClient();
  const { user } = useAuth();
  // Everything that lists this match or its squad (this page, Home, My Games, the captain's board) must update together.
  const refreshAll = () => { for (const k of ["match", "roster", "invitations", "match-invitations", "my-matches", "matches", "home", "home-open-games"]) void qc.invalidateQueries({ queryKey: [k] }); };
  const join = useMutation({
    mutationFn: (note: string | null) => api(`/matches/${id}/join-requests`, { method: "POST", body: note ? { commitment: "tentative", commitment_note: note } : {} }),
    onSuccess: (_r, note) => { setJoinMsg(note ? "Tentative request sent. The captain decides on spots." : "Request sent. Your spot isn't reserved until the captain accepts."); refreshAll(); },
    onError: (e) => setJoinMsg(errorText(e)),
  });
  const commit = useMutation({
    mutationFn: (note: string | null) => api(`/matches/${id}/commitment`, { method: "POST", body: note ? { commitment: "tentative", commitment_note: note } : { commitment: "confirmed" } }),
    onSuccess: () => { setChanging(false); refreshAll(); },
    onError: (e) => Alert.alert("Couldn't update", errorText(e)),
  });
  const [changing, setChanging] = useState(false);
  const remove = (playerId: string, name: string) => Alert.alert(`Remove ${name}?`, "They leave this match's squad and are notified. They can ask to join again.", [{ text: "Cancel", style: "cancel" }, {
    text: "Remove", style: "destructive", onPress: async () => { try { await api(`/matches/${id}/roster/${playerId}`, { method: "PUT", body: { status: "removed" } }); refreshAll(); } catch (e) { Alert.alert("Couldn't remove", errorText(e)); } },
  }]);
  if (q.isPending) return <View style={{ padding: SP.page }}><LoadingSkeleton rows={3} /></View>;
  if (q.isError) return <View style={{ padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View>;
  const m = q.data;
  const share = () => Share.share({ message: `${m.title} · ${m.team_name}\n${formatDay(m.start_at, m.timezone)} ${timeRange(m.start_at, m.end_at, m.timezone)}\n${m.venue.area}, ${m.venue.city}\nMatch ID ${m.match_code}` });
  const withdraw = () => Alert.alert("Withdraw?", "The captain will be notified.", [{ text: "Cancel", style: "cancel" }, {
    text: "Withdraw", style: "destructive", onPress: async () => { try { await api(`/matches/${id}/withdraw`, { method: "POST", body: {} }); qc.removeQueries({ queryKey: ["roster", id] }); refreshAll(); } catch (e) { Alert.alert("Error", errorText(e)); } },
  }]);
  const manager = m.viewer_relation === "manager";
  const lookingFor = Object.entries(m.composition.required).map(([r, n]) => [r, n - ((m.composition.confirmed as Record<string, number>)[r] ?? 0)] as const).filter(([, n]) => n > 0);
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.xl, paddingBottom: 60 }}>
      <View style={{ gap: 0 }}>
        <View style={{ height: 210, borderRadius: 22, overflow: "hidden", marginBottom: 16 }}>
          <MatchCoverImage uri={m.cover_image} title={m.title} format={m.format === "OTHER" ? "Practice" : m.format} style={{ width: "100%", height: 210 }} />
          {manager ? (
            <View style={{ position: "absolute", top: 10, right: 10 }}>
              <MediaEditButton onDark label={m.cover_image ? "Change photo" : "Add match photo"} purpose="match" save={(u) => api(`/matches/${m.id}`, { method: "PUT", body: { cover_image: u } }).then(() => q.refetch())} />
            </View>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", gap: 6, marginBottom: 8 }}><Badge status={m.match_status} label={MATCH_STATUS_LABELS[m.match_status]} /><Badge status="neutral" label={m.format === "OTHER" ? "Practice" : m.format} /></View>
        <Txt v="h1" style={{ fontSize: 25, lineHeight: 31, fontFamily: "Inter_800ExtraBold" }}>{m.title}</Txt>
        <Txt v="small" color={T.muted} style={{ marginTop: 8, fontSize: 14 }}>{formatDay(m.start_at, m.timezone)} · {timeRange(m.start_at, m.end_at, m.timezone)}</Txt>
        <Txt v="small" color={T.muted} style={{ marginTop: 2 }}>Hosted by {m.team_name} · {m.match_code}</Txt>
      </View>
      <View style={{ backgroundColor: T.surface, borderRadius: 20, borderWidth: 1, borderColor: T.line, padding: SP.lg, gap: SP.md }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View>
            <Txt v="h3" style={{ fontSize: 17 }} accessibilityLabel={`${m.composition.confirmed_total} of ${m.composition.capacity} players joined`}>{m.composition.confirmed_total} / {m.composition.capacity} Players Joined</Txt>
          </View>
          {m.composition.vacancies > 0 ? <KickerChip label={`${m.composition.vacancies} SPOT${m.composition.vacancies === 1 ? "" : "S"} LEFT`} /> : <KickerChip label="SQUAD FULL" tone="success" />}
        </View>
        {lookingFor.length ? (
          <View style={{ gap: 8 }}>
            <Txt v="smallSemi" color={T.muted}>Looking for</Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {lookingFor.map(([r, n]) => <Chip key={r} label={roleCount(r, n)} />)}
            </View>
          </View>
        ) : null}
        {manager && !["published", "recruiting"].includes(m.match_status) ? (
          <Button title="Open request board" size="lg" onPress={() => router.push({ pathname: "/match/players", params: { match: m.id } })} />
        ) : !manager && m.viewer_relation === "public" && ["published", "recruiting"].includes(m.match_status) && m.composition.vacancies > 0 ? (
          m.my_invitation_status === "pending" ? <InlineNotice>Request sent — the captain confirms spots. You'll be notified.</InlineNotice>
            : <CommitChoice confirmedTitle="Request to join" busy={join.isPending} onConfirmed={() => join.mutate(null)} onTentative={(note) => join.mutate(note)} />
        ) : null}
        {joinMsg ? <InlineNotice>{joinMsg}</InlineNotice> : null}
        {!manager ? <Txt v="small" color={T.muted}>A request is not a confirmed spot until the captain accepts it.</Txt> : null}
      </View>
      {manager && ["published", "recruiting"].includes(m.match_status) ? (
        <InviteRegularsCard matchId={m.id} confirmed={m.composition.confirmed_total} capacity={m.composition.capacity} />
      ) : null}
      <Card style={{ gap: SP.md }}>
        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
          <MapPin size={18} color={T.ink} strokeWidth={1.5} />
          <View style={{ flex: 1 }}>
            <Txt v="bodyMed">{m.venue.name ?? `${m.venue.area}, ${m.venue.city}`}</Txt>
            <Txt v="small" color={T.muted}>{m.venue.restricted ? "Exact venue is shared once you're in the squad" : `${m.venue.address ?? ""} ${m.venue.area}`}</Txt>
          </View>
        </View>
        {!m.venue.restricted && m.venue.lat != null ? <Button variant="secondary" size="sm" title="Open in Maps" onPress={() => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${m.venue.lat},${m.venue.lng}`)} /> : null}
      </Card>
      <View style={{ backgroundColor: T.surface, borderRadius: 20, padding: SP.lg, gap: SP.sm, borderWidth: 1, borderColor: T.line }}>
        <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Wallet size={18} color={T.ink} strokeWidth={1.5} /><Txt v="h3">Match fee</Txt></View>
        <Txt v="small" color={T.text2}>
          {m.per_head_fee_paise ? `${formatPaise(m.per_head_fee_paise)} suggested per player (estimate set by the captain).` : "No fee estimate yet."}
          {m.my_contribution_type ? ` You're ${m.my_contribution_type === "payee" ? "paying" : "playing free"}.` : ""}
        </Txt>
        {manager ? <Button title="Split match fee" variant="secondary" onPress={() => router.push({ pathname: "/fee", params: { ledger: m.id, title: m.title } })} />
          : m.viewer_relation === "roster" ? <Button title="View fee split" variant="secondary" onPress={() => router.push({ pathname: "/fee", params: { ledger: m.id, title: m.title } })} /> : null}
      </View>
      <Section title={`Squad · ${m.composition.confirmed_total}/${m.composition.capacity}`}>
        <Card style={{ gap: 0 }}>
          {Object.entries(m.composition.required).map(([role, need]) => (
            <View key={role} style={{ flexDirection: "row", paddingVertical: 6 }}>
              <Txt v="body" style={{ flex: 1 }}>{roleLabel(role)}</Txt>
              <Txt v="smallSemi">{(m.composition.confirmed as Record<string, number>)[role] ?? 0}/{need}</Txt>
            </View>
          ))}
        </Card>
        {inSquad && roster.data?.active.length ? (
          <Card style={{ gap: 0 }}>
            {roster.data.active.map((e, i) => (
              <View key={e.player.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: T.line }}>
                <Avatar uri={e.player.profile_image} name={e.player.full_name} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt v="bodyMed" numberOfLines={1}>{e.player.full_name}{e.is_captain ? " (C)" : ""}</Txt>
                  {e.commitment === "tentative" ? <Txt v="small" color={T.warningText} numberOfLines={2}>Tentative{e.commitment_note ? `: ${e.commitment_note}` : ""}</Txt> : null}
                </View>
                {e.commitment === "tentative" ? <Badge status="warning" label="Tentative" /> : null}
                <Badge status={e.contribution_type === "payee" ? "neutral" : "brand"} label={e.contribution_type === "payee" ? "Pays" : "Free"} />
                {manager && !e.is_captain && !["completed", "cancelled"].includes(m.match_status) ? (
                  <Button title="Remove" size="sm" variant="ghost" onPress={() => remove(e.player.id, e.player.full_name)} />
                ) : null}
              </View>
            ))}
          </Card>
        ) : !inSquad ? <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}><Users size={16} color={T.muted} strokeWidth={1.5} /><Txt v="small" color={T.muted}>The squad list is visible to players in the match.</Txt></View> : null}
      </Section>
      {manager && invs.data?.length ? (
        <Section title={`Invitations · ${invs.data.length}`}>
          <List>{invs.data.map((inv, k) => <ManagedInvitationRow key={inv.id} inv={inv} last={k === invs.data!.length - 1} />)}</List>
        </Section>
      ) : null}
      {manager && ["published", "recruiting"].includes(m.match_status) ? null : <Button title="Share match" variant="secondary" icon={<Share2 size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => void share()} />}
      {manager && m.allowed_transitions.includes("cancelled") ? (
        <CancelMatch id={m.id} squad={m.composition.confirmed_total} onCancelled={() => { refreshAll(); router.back(); }} />
      ) : null}
      {m.match_status === "cancelled" ? (
        <InlineNotice>This match was called off{m.cancelled_reason ? `: ${m.cancelled_reason}` : ""}. It no longer appears in anyone's upcoming matches.</InlineNotice>
      ) : null}
      {m.viewer_relation === "roster" && !["completed", "cancelled"].includes(m.match_status) ? (() => {
        const mine = roster.data?.active.find((e) => e.player.id === user?.id);
        return (
          <Card style={{ gap: SP.md }}>
            <Txt v="h3">Your spot</Txt>
            <Txt v="small" color={T.muted}>{mine?.commitment === "tentative" ? `You're tentative${mine.commitment_note ? `: ${mine.commitment_note}` : ""}` : "You're confirmed for this match."}</Txt>
            {mine?.commitment === "tentative" ? <Button title="I'm confirmed now" loading={commit.isPending} onPress={() => commit.mutate(null)} />
              : changing ? <CommitChoice confirmedTitle="Stay confirmed" busy={commit.isPending} onConfirmed={() => setChanging(false)} onTentative={(note) => commit.mutate(note)} />
              : <Button title="Change to tentative" variant="secondary" onPress={() => setChanging(true)} />}
            <Button title="Withdraw from squad" variant="ghost" onPress={withdraw} />
          </Card>
        );
      })() : null}
    </ScrollView>
  );
}
