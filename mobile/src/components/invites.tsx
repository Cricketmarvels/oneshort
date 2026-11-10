/**
 * Match invitations as dashboard cards (player) and rows (captain), with chat entry points once
 * accepted: in-app chat always; WhatsApp only when the other person has opted in (server decides).
 */
import { formatPaise, type S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CalendarDays, MapPin, MessageCircle, Shirt, Wallet } from "lucide-react-native";
import { Alert, Linking, Pressable, View } from "react-native";

import { ShieldCrest } from "@/components/identity";
import { Avatar, Badge, Button, Row, Txt } from "@/components/ui";
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

export function useChatThread(invitationId: string, enabled: boolean) {
  return useQuery({ queryKey: ["chat", invitationId], enabled, queryFn: () => api<ChatThread>(`/invitations/${invitationId}/chat`) });
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
    mutationFn: (a: "accept" | "reject") => api<Invitation>(`/invitations/${inv.id}/${a}`, { method: "POST", body: a === "reject" ? { reason: null } : undefined }),
    onSuccess: (_r, a) => {
      for (const k of ["invitations", "home", "matches"]) void qc.invalidateQueries({ queryKey: [k] });
      if (a === "accept") Alert.alert("You're in (pending confirmation)", `${inv.captain.full_name} will confirm your spot. You can chat with them now.`);
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
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button title="Decline" variant="outline" size="sm" loading={act.isPending && act.variables === "reject"} onPress={() => act.mutate("reject")} style={{ flex: 1 }} />
            <Button title="Accept" variant="highlight" size="sm" loading={act.isPending && act.variables === "accept"} onPress={() => act.mutate("accept")} style={{ flex: 1 }} />
          </View>
        ) : inv.can_chat ? <ChatButtons invitationId={inv.id} compact /> : null}
      </View>
    </View>
  );
}

/** Captain view row on the match page: status, WhatsApp delivery, chat once accepted. */
export function ManagedInvitationRow({ inv, last }: { inv: Invitation; last?: boolean }) {
  const tone = inv.invitation_status === "accepted" || inv.invitation_status === "confirmed" ? "success" : inv.invitation_status === "pending" ? "warning" : "neutral";
  return (
    <Row last={last} height={64} style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      <Avatar name={inv.player.full_name} uri={inv.player.profile_image} size={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="h3" numberOfLines={1}>{inv.player.full_name}</Txt>
        <Txt v="small" color={T.muted}>{inv.whatsapp_status ? (inv.whatsapp_status === "sent" ? "WhatsApp sent" : WHATSAPP_STATUS[inv.whatsapp_status]?.split(" — ")[0] ?? inv.whatsapp_status) : "In-app invitation"}</Txt>
      </View>
      <Badge status={tone} label={inv.invitation_status.charAt(0).toUpperCase() + inv.invitation_status.slice(1)} />
      {inv.can_chat ? <View style={{ width: "100%", paddingTop: SP.sm }}><ChatButtons invitationId={inv.id} compact /></View> : null}
    </Row>
  );
}
