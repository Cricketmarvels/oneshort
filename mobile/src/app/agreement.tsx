/**
 * Terms of Use + Privacy Notice consent: shown after first sign-in and whenever a new version is published.
 * Three separate, unticked confirmations (DPDP Act 2023 consent must be a clear affirmative action): the Terms,
 * the Privacy Notice, and being 18 or over.
 */
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, Switch, View } from "react-native";

import { Button, Card, ErrorBox, Loading, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SP, T } from "@/theme";

export default function Agreement() {
  const { reload } = useAuth();
  const q = useQuery({ queryKey: ["agreement"], queryFn: () => api<S<"AgreementOut">>("/agreements/current") });
  const [ok, setOk] = useState(false);
  const [priv, setPriv] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (q.isPending) return <Loading />;
  if (q.isError) return <View style={{ padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View>;
  const accept = async () => {
    setBusy(true); setErr(null);
    try {
      await api("/agreements/acceptance", { method: "POST", body: { version: q.data.version, accepted: true, age_confirmed: adult, privacy_acknowledged: priv } });
      await reload();
      router.replace("/");
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 160 }}>
        <View style={{ gap: 4 }}>
          <Txt v="hero" accessibilityRole="header">{q.data.title}</Txt>
          <Txt v="small" color={T.muted}>Version {q.data.version}{q.data.effective_date ? ` · effective ${q.data.effective_date}` : ""} · please read before you start</Txt>
        </View>
        <Card style={{ gap: SP.md }}>
          {q.data.sections.map((sec) => (
            <View key={sec.heading} style={{ gap: 4 }}>
              <Txt v="h3">{sec.heading}</Txt>
              <Txt v="body" color={T.muted} style={{ lineHeight: 22 }}>{sec.body}</Txt>
            </View>
          ))}
        </Card>
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: SP.page, paddingBottom: SP.xl, gap: SP.md, backgroundColor: T.bg, borderTopWidth: 1, borderTopColor: T.line }}>
        <Consent label="I agree to the Platform User Agreement" text="I have read and agree to the PlayR Terms of Use." value={ok} onChange={setOk} />
        <Consent label="I consent under the Privacy Notice" text="I have read the Privacy Notice and consent to PlayR using my data as it describes." value={priv} onChange={setPriv}
          link={{ label: "Read the Privacy Notice", onPress: () => router.push("/legal/privacy") }} />
        <Consent label="I am 18 or older" text="I am 18 or older." value={adult} onChange={setAdult} />
        {err ? <Txt v="small" color={T.dangerText} accessibilityRole="alert">{err}</Txt> : null}
        <Button title="Accept and continue" size="lg" disabled={!ok || !priv || !adult} loading={busy} onPress={() => void accept()} />
      </View>
    </View>
  );
}

function Consent({ label, text, value, onChange, link }: { label: string; text: string; value: boolean; onChange: (v: boolean) => void; link?: { label: string; onPress: () => void } }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <Switch accessibilityLabel={label} value={value} onValueChange={onChange} trackColor={{ true: T.primary, false: T.switchOff }} thumbColor={T.surface} {...({ activeThumbColor: T.surface, activeTrackColor: T.primary } as object)} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="body">{text}</Txt>
        {link ? <Pressable accessibilityRole="link" onPress={link.onPress} hitSlop={6}><Txt v="smallSemi" color={T.primaryDark} style={{ textDecorationLine: "underline" }}>{link.label}</Txt></Pressable> : null}
      </View>
    </View>
  );
}
