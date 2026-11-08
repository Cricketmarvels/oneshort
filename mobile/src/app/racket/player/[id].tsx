/** One racket-sport player's profile: level, times, availability, formats, distance, and the play request action. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { Alert, ScrollView, View } from "react-native";

import { StatTile } from "@/components/identity";
import { AVAIL, FORMATS, LEVELS, type Nearby, TIMES } from "@/components/racket";
import { Avatar, Badge, Button, Card, ErrorBox, Field, LoadingSkeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useLocation } from "@/lib/location";
import { isRacket, type RacketSport, SPORTS, useSport } from "@/lib/sports";
import { R, SP, T } from "@/theme";
import { useState } from "react";

const lbl = (list: readonly { v: string; l: string }[], vs: string[]) => vs.map((v) => list.find((x) => x.v === v)?.l ?? v).join(", ") || "Not set";

export default function RacketPlayer() {
  const { id, sport: sp } = useLocalSearchParams<{ id: string; sport?: string }>();
  const { sport: current } = useSport();
  const sport = (isRacket(sp as RacketSport) ? sp : current) as RacketSport;
  const { lat, lng } = useLocation();
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const q = useQuery({ queryKey: ["racket", sport, "player", id, lat, lng], queryFn: () => api<Nearby>(`/racket/${sport}/players/${id}`, { query: { lat, lng } }) });
  const send = useMutation({
    mutationFn: () => api(`/racket/${sport}/requests`, { method: "POST", body: { to_user_id: id, message: msg.trim() || null } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["racket"] }); Alert.alert("Play request sent", "They'll be notified and can accept or decline."); },
    onError: (e) => Alert.alert("Couldn't send request", errorText(e)),
  });
  if (q.isPending) return <View style={{ flex: 1, backgroundColor: T.bg, padding: SP.page }}><LoadingSkeleton rows={4} /></View>;
  if (q.isError) return <View style={{ flex: 1, backgroundColor: T.bg, padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View>;
  const p = q.data;
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 60 }}>
      <Stack.Screen options={{ title: "Player profile", headerTitleAlign: "center" }} />
      <View style={{ alignItems: "center", gap: 6, paddingVertical: SP.lg, borderRadius: R.card, backgroundColor: T.tint }}>
        <Avatar name={p.user.full_name} uri={p.user.profile_image} size={104} />
        <Txt v="hero" style={{ fontSize: 23 }}>{p.user.full_name}</Txt>
        <Txt v="body" color={T.muted}>{SPORTS[sport].name} • {LEVELS.find((l) => l.v === p.level)?.l} • ~{p.distance_km} km</Txt>
        {p.available_today ? <Badge status="success" label="Available today" /> : null}
      </View>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <StatTile tone="tint" value={p.rating != null ? p.rating.toFixed(1) : "New"} label="Player rating" />
        <StatTile value={String(p.matches_played)} label="Matches played" />
      </View>
      <Card style={{ gap: 12 }}>
        {([["Preferred time", lbl(TIMES, p.preferred_times)], ["Availability", lbl(AVAIL, p.availability)], ["Formats", lbl(FORMATS, p.formats)], ["Area", p.locality ?? p.user.city ?? "—"]] as const).map(([k, v]) => (
          <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}><Txt v="small" color={T.muted}>{k}</Txt><Txt v="smallSemi" style={{ flex: 1, textAlign: "right" }}>{v}</Txt></View>
        ))}
      </Card>
      {p.request_status === "pending" ? <Badge status="warning" label="Play request sent — waiting for a reply" />
        : p.request_status === "accepted" ? <Badge status="success" label="Connected — agree the time and court together" />
        : (
          <View style={{ gap: 10 }}>
            <Field label="Message (optional)" value={msg} onChangeText={setMsg} placeholder="e.g. Doubles on Saturday evening?" maxLength={200} />
            <Button title="Send play request" variant="highlight" size="lg" loading={send.isPending} onPress={() => send.mutate()} />
          </View>
        )}
      <Txt v="small" color={T.muted}>Ratings for {SPORTS[sport].name.toLowerCase()} start once verified matches are recorded. PlayR never shares exact locations or phone numbers.</Txt>
    </ScrollView>
  );
}
