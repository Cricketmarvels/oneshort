/** Smart search results: plain-language request -> understood intent -> best real options near you. */
import type { S } from "@cm/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CalendarDays, ChevronRight, MapPin, Search } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { PlayerArt, TeamCrest } from "@/components/art";
import { SmartSearchBar } from "@/components/search-bar";
import { EmptyState, ErrorBox, List, LoadingSkeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { when } from "@/lib/format";
import { useLocation } from "@/lib/location";
import { R, SP, T } from "@/theme";

type Result = S<"SearchResultOut">;
const KIND_LABEL: Record<string, string> = { match: "Open game", fixture: "Your fixture", player: "Player", team: "Team", community: "Community" };

function open(r: Result) {
  if (r.kind === "match") return router.push({ pathname: "/match/[id]", params: { id: r.id } });
  if (r.kind === "fixture") return router.push({ pathname: "/fixture/[id]", params: { id: r.id } });
  if (r.kind === "player") return router.push({ pathname: "/player/[id]", params: { id: r.id } });
  if (r.kind === "team") return router.push({ pathname: "/team/[id]", params: { id: r.id } });
  return router.push({ pathname: "/community/[id]", params: { id: r.id } });
}

export default function SmartSearchScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const { lat, lng, radius, label } = useLocation();
  const [text, setText] = useState(params.q ?? "");
  const [q, setQ] = useState(params.q ?? "");
  useEffect(() => { if (params.q) { setText(params.q); setQ(params.q); } }, [params.q]);
  const res = useQuery({
    queryKey: ["smart-search", q, lat, lng, radius], enabled: q.trim().length >= 2, staleTime: 60_000,
    queryFn: () => api<S<"SearchOut">>("/search/smart", { method: "POST", body: { query: q, lat, lng, radius_km: Number(radius) } }),
  });
  const join = useMutation({
    mutationFn: (id: string) => api(`/matches/${id}/join-requests`, { method: "POST", body: {} }),
    onSuccess: () => Alert.alert("Request sent", "The captain will confirm your spot."),
    onError: (e) => Alert.alert("Couldn't request a spot", errorText(e)),
  });
  const d = res.data;
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <SmartSearchBar value={text} onChange={setText} onSubmit={(v) => { setText(v); setQ(v); }} autoFocus={!params.q} />

      {!q ? <Txt v="small" color={T.muted}>Describe what you want in your own words: a day, a time, a role, a format or a distance.</Txt>
        : res.isPending ? <LoadingSkeleton rows={4} />
        : res.isError ? <ErrorBox error={res.error} onRetry={() => void res.refetch()} />
        : d ? (
          <>
            <View style={{ gap: 6 }}>
              <Txt v="small" color={T.accent} style={{ fontSize: 12 }}>Looking for</Txt>
              <Txt v="h3">{d.intent.summary}</Txt>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
                {d.window_label ? <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><CalendarDays size={14} color={T.muted} strokeWidth={1.5} /><Txt v="small" color={T.text2}>{d.window_label}</Txt></View> : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><MapPin size={14} color={T.muted} strokeWidth={1.5} /><Txt v="small" color={T.text2}>{label} · within {d.intent.max_distance_km ?? radius} km</Txt></View>
              </View>
            </View>
            {d.results.length ? (
              <>
                <Txt v="small" color={T.muted}>{d.engine === "claude" ? "Best options picked by AI from current listings near you" : "Best matches from current listings near you"}</Txt>
                <List>
                  {d.results.map((r, i) => (
                    <Pressable key={`${r.kind}${r.id}`} accessibilityRole="button" accessibilityLabel={`${KIND_LABEL[r.kind]}: ${r.title}. ${r.reason}`} onPress={() => open(r)}
                      style={({ pressed }) => ({ paddingVertical: SP.lg, gap: 10, borderTopWidth: i ? 1 : 0, borderTopColor: T.line, opacity: pressed ? 0.7 : 1 })}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                        {r.kind === "player" ? <PlayerArt name={r.image_name ?? r.title} size={44} /> : <TeamCrest name={r.image_name ?? r.title} size={40} />}
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                            <Txt v="h3" numberOfLines={1} style={{ flexShrink: 1 }}>{r.title}</Txt>
                            
                          </View>
                          <Txt v="small" color={T.muted} numberOfLines={1}>{i === 0 ? <Txt v="small" color={T.accent}>Best match · </Txt> : null}{KIND_LABEL[r.kind]} · {r.subtitle}</Txt>
                        </View>
                        <ChevronRight size={18} color={T.muted} strokeWidth={1.5} />
                      </View>
                      <Txt v="small" color={T.text2}>{r.reason}</Txt>
                      {r.when && r.kind !== "player" ? <Txt v="small" color={T.muted}>{when(r.when)}</Txt> : null}
                      {r.kind === "match" ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Request to join ${r.title}`} onPress={() => join.mutate(r.id)}
                          style={{ alignSelf: "flex-start", height: 38, paddingHorizontal: 16, borderRadius: R.pill, backgroundColor: T.brand, justifyContent: "center" }}>
                          <Txt v="smallSemi" color={T.onBrand}>{join.isPending && join.variables === r.id ? "Sending…" : "Request to join"}</Txt>
                        </Pressable>
                      ) : null}
                    </Pressable>
                  ))}
                </List>
              </>
            ) : <EmptyState icon={<Search size={22} color={T.muted} strokeWidth={1.5} />} title="Nothing matched right now" body={d.note ?? "Try a different day, a wider distance, or fewer details."} />}
            {d.note && d.results.length ? <Txt v="small" color={T.muted}>{d.note}</Txt> : null}
          </>
        ) : null}
    </ScrollView>
  );
}
