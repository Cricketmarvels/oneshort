import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { ScrollView, View } from "react-native";

import { TeamLogo } from "@/components/cricket";
import { Button, Card, EmptyState, ErrorBox, LoadingSkeleton, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { SP, T } from "@/theme";

export default function Teams() {
  const q = useQuery({ queryKey: ["teams", "member"], queryFn: () => api<{ data: S<"TeamOut">[] }>("/teams", { query: { scope: "member" } }) });
  const inv = useQuery({ queryKey: ["teams", "invitations"], queryFn: () => api<S<"TeamOut">[]>("/teams/invitations") });
  return (
    <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.md, paddingBottom: 60 }}>
      <Button title="Create a team" onPress={() => router.push("/team/new")} />
      {(inv.data ?? []).map((t) => (
        <Card key={t.id} onPress={() => router.push({ pathname: "/team/[id]", params: { id: t.id } })} style={{ borderWidth: 1.5, borderColor: T.line }}>
          <Txt v="label" color={T.accent}>Invitation</Txt>
          <Txt v="h3">{t.team_name}</Txt>
          <Txt v="small" color={T.muted}>Captain {t.captain.full_name}. Open to accept or decline.</Txt>
        </Card>
      ))}
      {q.isPending ? <LoadingSkeleton rows={3} /> : q.isError ? <ErrorBox error={q.error} /> : !q.data.data.length ? <EmptyState title="No teams yet" body="Create a team, or ask a captain to invite you." /> : q.data.data.map((t) => (
        <Card key={t.id} onPress={() => router.push({ pathname: "/team/[id]", params: { id: t.id } })} label={t.team_name}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TeamLogo team={t} />
            <View style={{ flex: 1 }}><Txt v="h3">{t.team_name}</Txt><Txt v="small" color={T.muted}>{t.area}, {t.city} · {t.member_count} players</Txt></View>
          </View>
        </Card>
      ))}
    </ScrollView>
  );
}
