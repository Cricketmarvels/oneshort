/**
 * Privacy & data (DPDP Act 2023): read the notice, download your data, make a request (access, correction, erasure,
 * withdraw consent, nominate, grievance) and see its status and deadline, or delete the account.
 */
import type { S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack } from "expo-router";
import { useState } from "react";
import { Alert, Platform, Pressable, ScrollView, Share, View } from "react-native";

import { PlayRIcon } from "@/components/icons";
import { Badge, Button, Card, Chip, ErrorBox, Field, Section, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { when } from "@/lib/format";
import { R, SP, T } from "@/theme";

type Req = S<"PrivacyRequestOut">;
type Kind = Req["type"];
const KINDS: { v: Kind; l: string; hint: string }[] = [
  { v: "access", l: "Get my data", hint: "Ask for a summary of the personal data we hold and who we share it with." },
  { v: "correction", l: "Correct my data", hint: "Tell us what is wrong and what it should say." },
  { v: "erasure", l: "Erase some data", hint: "Tell us what you want erased. To erase everything, delete your account below." },
  { v: "withdraw_consent", l: "Withdraw consent", hint: "Tell us which use of your data you no longer agree to." },
  { v: "nomination", l: "Nominate someone", hint: "Someone who can exercise your rights if you die or become unable to." },
  { v: "grievance", l: "Raise a grievance", hint: "Tell us what went wrong with how we handled your data." },
];
const STATUS: Record<Req["status"], string> = { open: "Received", in_progress: "In progress", resolved: "Resolved", rejected: "Declined", closed: "Closed" };

function Row({ label, sub, onPress }: { label: string; sub?: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ flex: 1, gap: 2 }}><Txt v="bodyMed">{label}</Txt>{sub ? <Txt v="small" color={T.muted}>{sub}</Txt> : null}</View>
      <PlayRIcon name="chevronRight" size={18} color={T.muted} />
    </Pressable>
  );
}

export default function PrivacyScreen() {
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const mine = useQuery({ queryKey: ["privacy-requests"], queryFn: () => api<Req[]>("/privacy/requests/me") });
  const [kind, setKind] = useState<Kind>("access");
  const [details, setDetails] = useState("");
  const [nominee, setNominee] = useState({ name: "", contact: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const send = useMutation({
    mutationFn: () => api<Req>("/privacy/requests", { method: "POST", body: { type: kind, details, ...(kind === "nomination" ? { nominee_name: nominee.name, nominee_contact: nominee.contact } : {}) } }),
    onSuccess: (r) => { setDetails(""); setNominee({ name: "", contact: "" }); setNotice(`Request ${r.reference} received. We'll reply by ${when(r.respond_by, { day: "numeric", month: "short", year: "numeric" })}.`); void qc.invalidateQueries({ queryKey: ["privacy-requests"] }); },
    onError: (e) => setNotice(errorText(e)),
  });
  const download = async () => {
    setExporting(true);
    try {
      const data = await api<Record<string, unknown>>("/users/me/export");
      const text = JSON.stringify(data, null, 2);
      const g = globalThis as unknown as { document?: Document; URL?: typeof URL; Blob?: typeof Blob };
      if (Platform.OS === "web" && g.document && g.URL && g.Blob) {
        const a = g.document.createElement("a");
        a.href = g.URL.createObjectURL(new g.Blob([text], { type: "application/json" }));
        a.download = "playr-my-data.json"; a.click();
      } else {
        await Share.share({ title: "My GoFindr data", message: text });
      }
    } catch (e) { Alert.alert("Couldn't prepare your data", errorText(e)); } finally { setExporting(false); }
  };
  const del = () => Alert.alert("Delete your account?", "We erase your profile, photos, posts and messages straight away. Ratings and fee records stay as \"Deleted player\". This can't be undone.", [
    { text: "Cancel", style: "cancel" },
    { text: "Delete", style: "destructive", onPress: async () => { await api("/users/me", { method: "DELETE", body: { confirm: "DELETE" } }); await signOut(); } },
  ]);
  const k = KINDS.find((x) => x.v === kind)!;
  const ready = details.trim().length >= 10 && (kind !== "nomination" || (nominee.name.trim() && nominee.contact.trim()));
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.xl, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ title: "Privacy & data", headerShown: true }} />
      <Card style={{ gap: 0 }}>
        <Row label="Privacy Notice" sub="What we collect, why, and your rights" onPress={() => router.push("/legal/privacy")} />
        <Row label="Terms of Use" onPress={() => router.push("/legal/terms")} />
        <Row label={exporting ? "Preparing your data…" : "Download my data"} sub="A copy of your account, profile, matches and records" onPress={() => void download()} />
      </Card>

      <Section title="Make a request">
        <Card style={{ gap: SP.md }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{KINDS.map((x) => <Chip key={x.v} label={x.l} active={kind === x.v} onPress={() => { setKind(x.v); setNotice(null); }} />)}</View>
          <Txt v="small" color={T.muted}>{k.hint}</Txt>
          {kind === "nomination" ? (
            <>
              <Field label="Nominee's full name" value={nominee.name} onChangeText={(v) => setNominee((n) => ({ ...n, name: v }))} maxLength={120} />
              <Field label="Nominee's phone or email" value={nominee.contact} onChangeText={(v) => setNominee((n) => ({ ...n, contact: v }))} maxLength={120} />
            </>
          ) : null}
          <Field label="Details" value={details} onChangeText={setDetails} multiline maxLength={2000} hint="At least 10 characters." style={{ minHeight: 96, textAlignVertical: "top" }} />
          {notice ? <Txt v="smallSemi" color={T.primaryDark} accessibilityRole="alert">{notice}</Txt> : null}
          <Button title="Send request" disabled={!ready} loading={send.isPending} onPress={() => send.mutate()} />
          <Txt v="small" color={T.muted}>We reply within 30 days, and always within the 90 days the DPDP Rules allow.</Txt>
        </Card>
      </Section>

      <Section title="Your requests">
        {mine.isError ? <ErrorBox error={mine.error} onRetry={() => void mine.refetch()} /> : !mine.data?.length ? (
          <Txt v="small" color={T.muted}>No requests yet.</Txt>
        ) : (
          <View style={{ gap: 10 }}>
            {mine.data.map((r) => (
              <View key={r.id} style={{ gap: 4, padding: 14, borderRadius: R.card, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Txt v="bodyMed" style={{ flex: 1 }}>{KINDS.find((x) => x.v === r.type)?.l} · {r.reference}</Txt>
                  <Badge status={r.status === "resolved" ? "confirmed" : r.status === "rejected" ? "cancelled" : "pending"} label={STATUS[r.status]} />
                </View>
                <Txt v="small" color={T.muted}>Sent {when(r.created_at, { day: "numeric", month: "short" })} · reply by {when(r.respond_by, { day: "numeric", month: "short" })}</Txt>
                {r.resolution ? <Txt v="small">{r.resolution}</Txt> : null}
              </View>
            ))}
          </View>
        )}
      </Section>

      <Section title="Delete account">
        <Txt v="small" color={T.muted}>Erases your personal data now and signs you out on all devices.</Txt>
        <Button title="Delete my account" variant="danger" onPress={del} />
      </Section>
    </ScrollView>
  );
}
