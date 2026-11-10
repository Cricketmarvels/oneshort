/**
 * Server address (beta builds only). Lets a TestFlight build talk to a different HTTPS GoFindr server than the
 * one baked in, e.g. while the gofindr.in domain is still pending. Hidden unless EXPO_PUBLIC_ALLOW_SERVER_OVERRIDE
 * was set for the build; production builds never show it and ignore any saved value.
 */
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Field, InlineNotice, Txt } from "@/components/ui";
import { API_URL, DEFAULT_API_URL, isValidApiUrl, SERVER_OVERRIDE_ALLOWED, setApiUrl } from "@/lib/config";
import { SP, T } from "@/theme";

async function probe(base: string): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(`${base}/auth/options`, { signal: ctrl.signal });
    if (!r.ok) return `Server answered ${r.status}`;
    const j = (await r.json()) as { data?: { beta_sport?: string | null } };
    return j.data ? `Connected${j.data.beta_sport ? ` · ${j.data.beta_sport} beta` : ""}` : "Reached, but this is not a GoFindr API";
  } catch {
    return "Can't reach that address";
  } finally {
    clearTimeout(timer);
  }
}

export default function Server() {
  const insets = useSafeAreaInsets();
  const qc = useQueryClient();
  const [url, setUrl] = useState(API_URL);
  const [status, setStatus] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!SERVER_OVERRIDE_ALLOWED) return null;
  const valid = isValidApiUrl(url);
  const test = async () => { setBusy(true); setStatus(null); setStatus(await probe(url.trim())); setBusy(false); };
  const save = async (value: string | null) => {
    setErr(null);
    setBusy(true);
    try {
      await setApiUrl(value);
      qc.clear(); // nothing cached from the old server survives
      router.back();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ScrollView style={{ flex: 1, backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, paddingTop: insets.top + SP.page, paddingBottom: insets.bottom + SP.page, gap: 14 }} keyboardShouldPersistTaps="handled">
      <Txt v="h1" accessibilityRole="header">Server address</Txt>
      <Txt v="body" color={T.muted}>Beta builds can use a different GoFindr server. Only https addresses ending in /api/v1 are accepted.</Txt>
      <Field label="API address" value={url} onChangeText={(v) => { setUrl(v); setStatus(null); }} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="https://gofindr.in/api/v1" error={url && !valid ? "Use https://host/api/v1" : null} hint={`Built-in: ${DEFAULT_API_URL}`} />
      {status ? <InlineNotice tone={status.startsWith("Connected") ? "info" : "warning"}>{status}</InlineNotice> : null}
      {err ? <InlineNotice tone="warning">{err}</InlineNotice> : null}
      <View style={{ gap: 10 }}>
        <Button title="Test connection" variant="secondary" onPress={() => void test()} disabled={!valid || busy} loading={busy} />
        <Button title="Save and use this server" onPress={() => void save(url)} disabled={!valid || busy || url.trim() === API_URL} />
        <Button title="Use the built-in address" variant="secondary" onPress={() => void save(null)} disabled={busy || API_URL === DEFAULT_API_URL} />
        <Button title="Cancel" variant="secondary" onPress={() => router.back()} disabled={busy} />
      </View>
    </ScrollView>
  );
}
