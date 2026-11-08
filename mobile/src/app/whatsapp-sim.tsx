/**
 * WhatsApp simulator (TEST MODE). Shows every WhatsApp message PlayR would have sent to a number — login codes,
 * invitations, notifications — exactly as worded, so the feature can be tested end to end without a provider.
 * Logged in: your own number. Before login: needs the simulator key (keeps other people's codes private).
 */
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CheckCheck, FlaskConical } from "lucide-react-native";
import { useState } from "react";
import { Platform, ScrollView, View } from "react-native";

import { Button, EmptyState, ErrorBox, Field, InlineNotice, LoadingSkeleton, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { simKey, useSimCode } from "@/lib/simulator";
import { R, SP, T } from "@/theme";

type Msg = { id: string; to_last4: string; kind: string; body: string; code: string | null; created_at: string };
const KIND: Record<string, string> = { otp: "Login code", notify: "Notification", invite: "Match invitation" };

export default function WhatsAppSimulator() {
  const { user } = useAuth();
  const params = useLocalSearchParams<{ phone?: string }>();
  const setCode = useSimCode((s) => s.setCode);
  const [phone, setPhone] = useState(params.phone ?? "");
  const [key, setKey] = useState(simKey.get());
  const [copied, setCopied] = useState<string | null>(null);
  const mine = !!user && !params.phone;
  const q = useQuery({
    queryKey: ["wa-sim", mine ? "me" : phone, key],
    enabled: mine || (phone.replace(/\D/g, "").length >= 10 && key.length > 0),
    refetchInterval: 3000,
    queryFn: () => (mine ? api<Msg[]>("/whatsapp/simulator/me") : api<Msg[]>("/whatsapp/simulator/inbox", { query: { phone }, headers: { "x-simulator-key": key } })),
  });
  const copy = async (code: string) => {
    try { if (Platform.OS === "web") await navigator.clipboard.writeText(code); setCopied(code); } catch { setCopied(null); }
  };
  const msgs = [...(q.data ?? [])].reverse();
  return (
    <View style={{ flex: 1, backgroundColor: "#E7EFEC" }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, padding: 12, backgroundColor: T.warningBackground }}>
        <FlaskConical size={16} color={T.warningText} strokeWidth={2} />
        <Txt v="small" color={T.warningText} style={{ flex: 1 }}>Test mode — these messages were NOT sent to real WhatsApp. They show what PlayR would send.</Txt>
      </View>
      {!mine ? (
        <View style={{ padding: SP.page, gap: 10, backgroundColor: T.bg, borderBottomWidth: 1, borderBottomColor: T.line }}>
          <Field label="Phone number" value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="98765 43210" />
          <Field label="Simulator key" value={key} onChangeText={(k) => { setKey(k); simKey.set(k); }} autoCapitalize="none" placeholder="From the developer (.env WHATSAPP_SIMULATOR_KEY)" secureTextEntry />
        </View>
      ) : null}
      <ScrollView contentContainerStyle={{ padding: SP.page, gap: 10, flexGrow: 1 }}>
        {mine || (phone && key) ? (
          q.isPending ? <LoadingSkeleton rows={3} /> : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : !msgs.length ? (
            <EmptyState title="No messages yet" body="Tap “Get code on WhatsApp” or trigger a notification — it appears here within a few seconds." />
          ) : msgs.map((m) => (
            <View key={m.id} style={{ alignSelf: "flex-start", maxWidth: "88%", gap: 2 }}>
              <View style={{ padding: 12, borderRadius: 14, borderTopLeftRadius: 4, backgroundColor: "#FFFFFF", gap: 8, shadowColor: "#000", shadowOpacity: 0.06, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}>
                <Txt v="micro" color={T.primaryDark}>PlayR · {KIND[m.kind] ?? m.kind}</Txt>
                <Txt v="body" selectable style={{ fontSize: 15, lineHeight: 21 }}>{m.body}</Txt>
                {m.code ? (
                  <View style={{ gap: 8 }}>
                    <View style={{ alignItems: "center", paddingVertical: 8, borderRadius: R.md, backgroundColor: T.tint }}>
                      <Txt v="display" selectable style={{ fontSize: 30, letterSpacing: 6 }}>{m.code}</Txt>
                    </View>
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      {Platform.OS === "web" ? <Button title={copied === m.code ? "Copied" : "Copy code"} variant="secondary" size="sm" onPress={() => void copy(m.code!)} style={{ flex: 1 }} /> : null}
                      {!user ? <Button title="Use this code" size="sm" onPress={() => { setCode(m.code); router.back(); }} style={{ flex: 1 }} /> : null}
                    </View>
                  </View>
                ) : null}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 4 }}>
                <Txt v="small" color={T.muted} style={{ fontSize: 11 }}>to ••{m.to_last4} · {new Date(m.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Txt>
                <CheckCheck size={13} color="#34B7F1" strokeWidth={2.2} />
              </View>
            </View>
          ))
        ) : <InlineNotice>Enter the phone number and the simulator key to see that number's simulated WhatsApp messages.</InlineNotice>}
      </ScrollView>
    </View>
  );
}
