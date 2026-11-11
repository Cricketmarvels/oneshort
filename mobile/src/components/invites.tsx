/**
 * Match invitations as dashboard cards (player) and rows (captain), with chat entry points once
 * accepted: in-app chat always; WhatsApp only when the other person has opted in (server decides).
 */
import { formatPaise, type S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CalendarDays, MapPin, MessageCircle, Shirt, Wallet } from "lucide-react-native";
import { useState } from "react";
import { Alert, Linking, Pressable, View } from "react-native";

import { ShieldCrest } from "@/components/identity";
import { Avatar, Badge, Button, Field, Row, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { roleLabel, when } from "@/lib/format";
import { R, shadow, SP, T } from "@/theme";

export type Invitation = S<"InvitationOut">;
export type ChatThread = S<"ChatThreadOut">;

export const WHATSAPP_STATUS: Record<string, string> = {
  sent: "WhatsApp message sent",
  failed: "WhatsApp message couldn't be delivered — they still got the in-app invitation",
  not_configured: "WhatsApp isn't connected to GoFindr yet — they got the in-app invitation",
  opted_out: "They haven't switched on WhatsApp updates — they got the in-app invitation",
  no_number: "No verified mobile number — they got the in-app invitation",
};

/** WhatsApp green glyph (simple speech bubble) — avoids using WhatsApp's trademarked logo. */
function WaDot() {
  return <View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: "#25D366", alignItems: "center", justifyContent: "center" }}><MessageCircle size={11} color="#FFFFFF" strokeWidth={2.6} /></View>;
}

export function useChatThread(invitationId: string, enabled: boolean, live = false) {
  return useQuery({ queryKey: ["chat", invitationId], enabled, refetchInterval: live ? 4000 : false, queryFn: () => api<ChatThread>(`/invitations/${invitationId}/chat`) });
}

/** Chat buttons shown once an invitation is accepted. */
export function ChatButtons({ invitationId, compact, quiet }: { invitationId: string; compact?: boolean; quiet?: boolean }) {
  const t = useChatThread(invitationId, true);
  const wa = t.data?.whatsapp_url;
  return (
    <View style={{ flexDirection: "row", gap: 10 }}>
      <Button title="Chat in app" variant={quiet ? "secondary" : "primary"} size={compact ? "sm" : "md"} icon={<MessageCircle size={17} color={quiet ? T.ink : T.onPrimary} strokeWidth={2} />} onPress={() => router.push({ pathname: "/chat/[id]", params: { id: invitationId } })} style={{ flex: 1 }} />
      {wa ? (
        <Button title="WhatsApp" variant="secondary" size={compact ? "sm" : "md"} icon={<WaDot />} onPress={() => void Linking.openURL(wa)} style={{ flex: 1 }} />
      ) : null}
    </View>
  );
}

/** Player dashboard card for a received match invitation. */
export function InvitationCard({ inv }: { inv: Invitation }) {
  const qc = useQueryClient();
  const m = inv.match;
  const act = useMutation({
    mutationFn: (a: "accept" | "reject" | { note: string }) => api<Invitation>(`/invitations/${inv.id}/${a === "reject" ? "reject" : "accept"}`, {
      method: "POST", body: a === "reject" ? { reason: null } : a === "accept" ? { commitment: "confirmed" } : { commitment: "tentative", commitment_note: a.note },
    }),
    onSuccess: (_r, a) => {
      for (const k of ["invitations", "home", "matches", "my-matches", "match", "roster"]) void qc.invalidateQueries({ queryKey: [k] });
      if (a !== "reject") Alert.alert(a === "accept" ? "You're in (pending confirmation)" : "Marked as tentative", `${inv.captain.full_name} will confirm your spot. You can chat with them now.`);
    },
    onError: (e) => Alert.alert("Couldn't update the invitation", errorText(e)),
  });
  const accepted = inv.invitation_status === "accepted" || inv.invitation_status === "confirmed";
  const fee = m.per_head_fee_paise && inv.contribution_type === "payee" ? `~${formatPaise(m.per_head_fee_paise)} per head` : "No fee for you";
  return (
    <View style={{ borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: accepted ? T.successBackground : T.line, overflow: "hidden", ...shadow(1) }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: accepted ? T.successBackground : T.tint }}>
        <Txt v="smallSemi" color={accepted ? T.successText : T.primaryDark} style={{ flex: 1 }}>{accepted ? (inv.invitation_status === "confirmed" ? "You're in the squad" : "Accepted — waiting for the captain to confirm") : "Match invitation"}</Txt>
        <Txt v="small" color={T.muted}>{when(inv.invited_at, { day: "numeric", month: "short" })}</Txt>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${m.title}, invited by ${inv.captain.full_name}`} onPress={() => router.push({ pathname: "/match/[id]", params: { id: m.id } })} style={{ padding: 16, gap: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <ShieldCrest name={m.team_name} size={46} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Txt v="h3" numberOfLines={2} style={{ fontSize: 16 }}>{m.title}</Txt>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Avatar name={inv.captain.full_name} uri={inv.captain.profile_image} size={20} />
              <Txt v="small" color={T.muted} numberOfLines={1}>{inv.captain.full_name} · {m.team_name}</Txt>
            </View>
          </View>
        </View>
        <View style={{ gap: 6 }}>
          {([[CalendarDays, `${when(m.start_at, { weekday: "short", day: "numeric", month: "short" })} · ${when(m.start_at, { hour: "numeric", minute: "2-digit" })}`],
            [MapPin, [m.venue_name, m.area].filter(Boolean).join(", ") || m.city || "Venue to be confirmed"],
            [Shirt, `${m.format === "OTHER" ? "Practice" : m.format} · ${inv.proposed_role ? roleLabel(inv.proposed_role) : "Any role"}${inv.is_substitute ? " · substitute" : ""}`],
            [Wallet, fee]] as const).map(([Icon, text], i) => (
            <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Icon size={16} color={T.primaryDark} strokeWidth={2} /><Txt v="body" style={{ flex: 1, fontSize: 14 }}>{text}</Txt></View>
          ))}
        </View>
        {inv.message ? <Txt v="body" color={T.muted} style={{ fontStyle: "italic" }}>“{inv.message}”</Txt> : null}
      </Pressable>
      <View style={{ paddingHorizontal: 16, paddingBottom: 16 }}>
        {inv.can_accept ? (
          <CommitChoice busy={act.isPending} onConfirmed={() => act.mutate("accept")} onTentative={(note) => act.mutate({ note })} onDecline={() => act.mutate("reject")} />
        ) : (
          <View style={{ gap: 10 }}>
            {inv.commitment === "tentative" ? <Txt v="small" color={T.warningText}>You're tentative{inv.commitment_note ? `: ${inv.commitment_note}` : ""}</Txt> : null}
            {inv.can_chat ? <ChatButtons invitationId={inv.id} compact /> : null}
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * How a player answers: in for sure, tentative (with a note saying by when they can confirm), or not.
 * Used for accepting an invitation and for asking to join a match.
 */
export function CommitChoice({ busy, onConfirmed, onTentative, onDecline, confirmedTitle = "I'm in" }: {
  busy?: boolean; onConfirmed: () => void; onTentative: (note: string) => void; onDecline?: () => void; confirmedTitle?: string;
}) {
  const [tentative, setTentative] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  if (tentative) {
    return (
      <View style={{ gap: 10 }}>
        <Field testID="tentative-note" label="By when can you confirm?" value={note} onChangeText={(v) => { setNote(v); setErr(null); }} placeholder="e.g. Friday evening, after my shift is fixed" maxLength={120} autoFocus error={err} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title="Back" variant="outline" size="sm" disabled={busy} onPress={() => setTentative(false)} style={{ flex: 1 }} />
          <Button testID="tentative-send" title="Join as tentative" size="sm" loading={busy} onPress={() => (note.trim().length < 3 ? setErr("Say by when you can confirm") : onTentative(note.trim()))} style={{ flex: 2 }} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button testID="commit-tentative" title="Tentative" variant="outline" size="sm" disabled={busy} onPress={() => setTentative(true)} style={{ flex: 1 }} />
        <Button testID="commit-confirmed" title={confirmedTitle} variant="highlight" size="sm" loading={busy} onPress={onConfirmed} style={{ flex: 1 }} />
      </View>
      {onDecline ? <Button title="Decline" variant="ghost" size="sm" disabled={busy} onPress={onDecline} /> : null}
    </View>
  );
}

/** Captain view row on the match page: who, how sure they are, and the actions the captain can take right there. */
export function ManagedInvitationRow({ inv, last }: { inv: Invitation; last?: boolean }) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (a: "confirm" | "reject" | "cancel") => api<Invitation>(`/invitations/${inv.id}/${a}`, { method: "POST", body: a === "confirm" ? undefined : { reason: null } }),
    onSuccess: () => { for (const k of ["invitations", "match-invitations", "match", "roster", "my-matches", "home"]) void qc.invalidateQueries({ queryKey: [k] }); },
    onError: (e) => Alert.alert("Couldn't update", errorText(e)),
  });
  const request = inv.direction === "request";
  const tone = inv.invitation_status === "accepted" || inv.invitation_status === "confirmed" ? "success" : inv.invitation_status === "pending" ? "warning" : "neutral";
  const label = request && inv.invitation_status === "pending" ? "Wants to join" : inv.invitation_status === "accepted" ? "Accepted" : inv.invitation_status.charAt(0).toUpperCase() + inv.invitation_status.slice(1);
  const sub = request ? "Asked to join" : inv.whatsapp_status ? (inv.whatsapp_status === "sent" ? "WhatsApp sent" : WHATSAPP_STATUS[inv.whatsapp_status]?.split(" — ")[0] ?? inv.whatsapp_status) : "In-app invitation";
  const busy = (a: string) => act.isPending && act.variables === a;
  return (
    <Row last={last} height={64} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      <Avatar name={inv.player.full_name} uri={inv.player.profile_image} size={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="h3" numberOfLines={1}>{inv.player.full_name}</Txt>
        <Txt v="small" color={T.muted}>{sub}</Txt>
        {inv.commitment === "tentative" && ["pending", "accepted", "confirmed"].includes(inv.invitation_status) ? (
          <Txt v="small" color={T.warningText}>Tentative{inv.commitment_note ? `: ${inv.commitment_note}` : ""}</Txt>
        ) : null}
      </View>
      <Badge status={tone} label={label} />
      {inv.can_confirm || inv.can_reject || inv.can_cancel ? (
        <View style={{ width: "100%", flexDirection: "row", gap: 10, paddingTop: SP.sm }}>
          {inv.can_reject ? <Button title="Decline" variant="outline" size="sm" loading={busy("reject")} disabled={act.isPending} onPress={() => act.mutate("reject")} style={{ flex: 1 }} /> : null}
          {inv.can_cancel && !inv.can_reject ? <Button title={request ? "Decline" : "Cancel invite"} variant="outline" size="sm" loading={busy("cancel")} disabled={act.isPending} onPress={() => act.mutate("cancel")} style={{ flex: 1 }} /> : null}
          {inv.can_confirm ? <Button title={request ? "Accept" : "Confirm spot"} size="sm" loading={busy("confirm")} disabled={act.isPending} onPress={() => act.mutate("confirm")} style={{ flex: 1 }} /> : null}
        </View>
      ) : null}
      {inv.can_chat ? <View style={{ width: "100%", paddingTop: SP.sm }}><ChatButtons invitationId={inv.id} compact /></View> : null}
    </Row>
  );
}
