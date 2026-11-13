/**
 * Signed-in devices: one row per device session. Signing out one device kills its tokens; "Sign out
 * everywhere" also invalidates access tokens already issued (the server checks issue time), then signs
 * this device out too.
 */
import type { S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { Alert, ScrollView, View } from "react-native";

import { PlayRIcon } from "@/components/icons";
import { Button, Card, ErrorBox, LoadingSkeleton, Section, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { when } from "@/lib/format";
import { SP, T } from "@/theme";

type Session = S<"SessionOut">;

/** Short device label from the stored user agent — display only. */
function deviceLabel(ua: string): string {
  if (/iphone|ipad|ios/i.test(ua)) return "iPhone or iPad";
  if (/android/i.test(ua)) return "Android phone";
  if (/macintosh|mac os/i.test(ua)) return "Mac browser";
  if (/windows/i.test(ua)) return "Windows browser";
  if (/okhttp|expo|playr/i.test(ua)) return "OneShort app";
  return ua ? "Browser" : "Unknown device";
}

export default function SessionsScreen() {
  const qc = useQueryClient();
  const { signOut } = useAuth();
  const q = useQuery({ queryKey: ["sessions"], queryFn: () => api<Session[]>("/auth/sessions") });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/auth/sessions/${id}`, { method: "DELETE" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["sessions"] }),
    onError: (e) => Alert.alert("Couldn't sign that device out", errorText(e)),
  });
  const everywhere = () =>
    Alert.alert("Sign out everywhere?", "Every device, including this one, is signed out immediately.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out everywhere",
        style: "destructive",
        onPress: async () => {
          await api("/auth/logout-all", { method: "POST" }).catch(() => undefined);
          await signOut();
        },
      },
    ]);
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.xl, paddingBottom: 60 }}>
      <Stack.Screen options={{ title: "Signed-in devices", headerShown: true }} />
      <Section title="Where you're signed in">
        {q.isPending ? <LoadingSkeleton rows={3} /> : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : (
          <View style={{ gap: 10 }}>
            {q.data.map((s) => (
              <Card key={s.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
                <PlayRIcon name={/mac|windows|mozilla/i.test(s.user_agent) ? "discover" : "profile"} size={20} color={T.primaryDark} />
                <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                  <Txt v="bodyMed">{deviceLabel(s.user_agent)}{s.current ? " · this device" : ""}</Txt>
                  <Txt v="small" color={T.muted}>Active {when(s.last_used_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</Txt>
                </View>
                {!s.current ? (
                  <Button title="Sign out" size="sm" variant="secondary" loading={revoke.isPending && revoke.variables === s.id} onPress={() => revoke.mutate(s.id)} />
                ) : null}
              </Card>
            ))}
          </View>
        )}
      </Section>
      <Section title="Lost a phone?">
        <Txt v="small" color={T.muted}>Signing out everywhere ends every session immediately, even mid-use.</Txt>
        <Button title="Sign out everywhere" variant="danger" onPress={everywhere} />
      </Section>
    </ScrollView>
  );
}
