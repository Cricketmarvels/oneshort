/** Platform User Agreement: shown once after first sign-in (and when a new version is published). */
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, Switch, View } from "react-native";

import { Button, Card, ErrorBox, Loading, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { SP, T } from "@/theme";

export default function Agreement() {
  const { reload } = useAuth();
  const q = useQuery({ queryKey: ["agreement"], queryFn: () => api<S<"AgreementOut">>("/agreements/current") });
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (q.isPending) return <Loading />;
  if (q.isError) return <View style={{ padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View>;
  const accept = async () => {
    setBusy(true); setErr(null);
    try {
      await api("/agreements/acceptance", { method: "POST", body: { version: q.data.version, accepted: true } });
      await reload();
      router.replace("/");
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  };
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 160 }}>
        <View style={{ gap: 4 }}>
          <Txt v="hero" accessibilityRole="header">{q.data.title}</Txt>
          <Txt v="small" color={T.muted}>Version {q.data.version} · please read before you start</Txt>
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
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <Switch accessibilityLabel="I agree to the Platform User Agreement" value={ok} onValueChange={setOk} trackColor={{ true: T.primary, false: T.switchOff }} thumbColor={T.surface} {...({ activeThumbColor: T.surface, activeTrackColor: T.primary } as object)} />
          <Txt v="body" style={{ flex: 1 }}>I have read and agree to the Platform User Agreement.</Txt>
        </View>
        {err ? <Txt v="small" color={T.dangerText} accessibilityRole="alert">{err}</Txt> : null}
        <Button title="Accept and continue" size="lg" disabled={!ok} loading={busy} onPress={() => void accept()} />
      </View>
    </View>
  );
}
