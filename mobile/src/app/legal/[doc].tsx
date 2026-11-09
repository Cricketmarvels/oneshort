/** Terms of Use and Privacy Notice: public (readable before signing in) at /legal/terms and /legal/privacy. */
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Pressable, ScrollView, View } from "react-native";

import { PlayRIcon } from "@/components/icons";
import { ErrorBox, LoadingSkeleton, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { R, SP, T } from "@/theme";

type Doc = S<"LegalDocOut">;

export default function LegalDoc() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const kind = doc === "privacy" ? "privacy" : "terms";
  const q = useQuery({ queryKey: ["legal", kind], queryFn: () => api<Doc>(`/legal/${kind}`) });
  const other = kind === "terms" ? { path: "/legal/privacy" as const, label: "Read the Privacy Notice" } : { path: "/legal/terms" as const, label: "Read the Terms of Use" };
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <Stack.Screen options={{ title: kind === "terms" ? "Terms of Use" : "Privacy Notice", headerShown: true }} />
      <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 60, maxWidth: 760, width: "100%", alignSelf: "center" }}>
        {q.isPending ? <LoadingSkeleton rows={6} /> : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : (
          <>
            <View style={{ gap: 4 }}>
              <Txt v="hero" accessibilityRole="header">{q.data.title}</Txt>
              <Txt v="small" color={T.muted}>Version {q.data.version} · effective {q.data.effective_date}</Txt>
            </View>
            {q.data.sections.map((s) => (
              <View key={s.heading} style={{ gap: 6 }}>
                <Txt v="h3" accessibilityRole="header">{s.heading}</Txt>
                <Txt v="body" color={T.ink} style={{ lineHeight: 23 }}>{s.body}</Txt>
              </View>
            ))}
            <Pressable accessibilityRole="link" onPress={() => router.push(other.path)}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, padding: 14, borderRadius: R.card, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface })}>
              <Txt v="smallSemi" color={T.primaryDark} style={{ flex: 1 }}>{other.label}</Txt>
              <PlayRIcon name="chevronRight" size={18} color={T.primaryDark} />
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  );
}
