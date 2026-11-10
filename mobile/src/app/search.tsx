/**
 * Search. Two engines behind one box:
 *  - while typing: GET /search — instant prefix results for players (with CricHeroes badge), teams and grounds
 *  - on submit (or "Ask GoFindr"): POST /search/smart — plain-language requests like "play on Saturday morning"
 * A query that reads like a sentence (3+ words, or day/time words) goes straight to the smart engine on submit.
 */
import type { S } from "@cm/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CalendarDays, ChevronRight, MapPin, Search, Sparkles } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { PlayerArt, TeamCrest } from "@/components/art";
import { PlayRIcon } from "@/components/icons";
import { SmartSearchBar } from "@/components/search-bar";
import { Avatar, EmptyState, ErrorBox, List, LoadingSkeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { when } from "@/lib/format";
import { useLocation } from "@/lib/location";
import { R, SP, T } from "@/theme";

type Result = S<"SearchResultOut">;
type Unified = S<"UnifiedSearchOut">;
const KIND_LABEL: Record<string, string> = { match: "Open game", fixture: "Your fixture", player: "Player", team: "Team", community: "Community" };
const ROLE: Record<string, string> = { batsman: "Batter", bowler: "Bowler", all_rounder: "All-rounder", wicketkeeper: "Wicket-keeper", wicket_keeper: "Wicket-keeper" };
const SENTENCE = /\b(play|game|match|want|need|looking|saturday|sunday|monday|tuesday|wednesday|thursday|friday|weekend|morning|evening|afternoon|tonight|tomorrow|today|near|within|km)\b/i;

function looksLikeRequest(q: string) {
  return q.trim().split(/\s+/).length >= 3 || SENTENCE.test(q);
}

function useDebounced<V>(value: V, ms: number): V {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

function open(r: Result) {
  if (r.kind === "match") return router.push({ pathname: "/match/[id]", params: { id: r.id } });
  if (r.kind === "fixture") return router.push({ pathname: "/fixture/[id]", params: { id: r.id } });
  if (r.kind === "player") return router.push({ pathname: "/player/[id]", params: { id: r.id } });
  if (r.kind === "team") return router.push({ pathname: "/team/[id]", params: { id: r.id } });
  return router.push({ pathname: "/community/[id]", params: { id: r.id } });
}

function Row({ left, title, subtitle, badge, onPress, label }: { left: React.ReactNode; title: string; subtitle: string; badge?: string | null; onPress: () => void; label: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
      {left}
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Txt v="bodyMed" numberOfLines={1} style={{ flexShrink: 1 }}>{title}</Txt>
          {badge ? <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: R.pill, backgroundColor: T.primarySoft }}><Txt v="small" color={T.primaryDark} style={{ fontSize: 11 }}>{badge}</Txt></View> : null}
        </View>
        <Txt v="small" color={T.muted} numberOfLines={1}>{subtitle}</Txt>
      </View>
      <ChevronRight size={18} color={T.muted} strokeWidth={1.5} />
    </Pressable>
  );
}

function km(d: number | null | undefined) { return d != null ? ` · ~${d} km` : ""; }

function InstantResults({ d, q }: { d: Unified; q: string }) {
  const total = d.players.length + d.teams.length + d.grounds.length;
  if (!total) return <EmptyState icon={<Search size={22} color={T.muted} strokeWidth={1.5} />} title={`No players, teams or grounds called “${q}”`} body="Check the spelling, or describe what you want and ask GoFindr instead." />;
  return (
    <View style={{ gap: SP.lg }}>
      {d.players.length ? (
        <View style={{ gap: 4 }}>
          <Txt v="smallSemi" color={T.muted}>Players</Txt>
          <List>{d.players.map((p) => (
            <Row key={p.id} left={<Avatar uri={p.image} name={p.name} size={40} />} title={p.name} badge={p.has_cricheroes ? "CricHeroes" : null}
              subtitle={[p.role ? ROLE[p.role] ?? p.role : null, p.area ?? p.city, p.verified_matches ? `${p.verified_matches} verified match${p.verified_matches === 1 ? "" : "es"}` : null].filter(Boolean).join(" · ") + km(p.distance_km)}
              label={`Player ${p.name}${p.has_cricheroes ? ", CricHeroes profile linked" : ""}`} onPress={() => router.push({ pathname: "/player/[id]", params: { id: p.id } })} />
          ))}</List>
        </View>
      ) : null}
      {d.teams.length ? (
        <View style={{ gap: 4 }}>
          <Txt v="smallSemi" color={T.muted}>Teams</Txt>
          <List>{d.teams.map((t) => (
            <Row key={t.id} left={t.logo ? <Avatar uri={t.logo} name={t.name} size={40} /> : <TeamCrest name={t.name} size={40} />} title={t.name} badge={t.looking_for_opponents ? "Open to challenges" : null}
              subtitle={[t.area ?? t.city, `${t.member_count} member${t.member_count === 1 ? "" : "s"}`].filter(Boolean).join(" · ") + km(t.distance_km)}
              label={`Team ${t.name}`} onPress={() => router.push({ pathname: "/team/[id]", params: { id: t.id } })} />
          ))}</List>
        </View>
      ) : null}
      {d.grounds.length ? (
        <View style={{ gap: 4 }}>
          <Txt v="smallSemi" color={T.muted}>Grounds</Txt>
          <List>{d.grounds.map((g) => (
            <Row key={g.id} left={<View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: T.primarySoft, alignItems: "center", justifyContent: "center" }}><PlayRIcon name="stadium" size={20} color={T.primaryDark} /></View>}
              title={g.name} subtitle={[g.area, g.city].filter(Boolean).join(", ") + km(g.distance_km)} label={`Ground ${g.name}`}
              onPress={() => router.push({ pathname: "/grounds", params: { focus: g.id, name: g.name, address: g.address ?? "", area: g.area ?? "", city: g.city ?? "", lat: g.lat ?? "", lng: g.lng ?? "" } })} />
          ))}</List>
        </View>
      ) : null}
    </View>
  );
}

export default function SearchScreen() {
  const params = useLocalSearchParams<{ q?: string }>();
  const { lat, lng, radius, label } = useLocation();
  const [text, setText] = useState(params.q ?? "");
  const [ask, setAsk] = useState(params.q && looksLikeRequest(params.q) ? params.q : "");
  useEffect(() => { if (params.q) { setText(params.q); if (looksLikeRequest(params.q)) setAsk(params.q); } }, [params.q]);
  const typed = useDebounced(text.trim(), 250);
  const instant = useQuery({
    queryKey: ["search", typed, lat, lng], enabled: typed.length >= 2 && !ask, staleTime: 20_000, placeholderData: (prev) => prev,
    queryFn: () => api<Unified>("/search", { query: { q: typed, lat, lng, limit: 8 } }),
  });
  const smart = useQuery({
    queryKey: ["smart-search", ask, lat, lng, radius], enabled: ask.trim().length >= 2, staleTime: 60_000,
    queryFn: () => api<S<"SearchOut">>("/search/smart", { method: "POST", body: { query: ask, lat, lng, radius_km: Number(radius) } }),
  });
  const join = useMutation({
    mutationFn: (id: string) => api(`/matches/${id}/join-requests`, { method: "POST", body: {} }),
    onSuccess: () => Alert.alert("Request sent", "The captain will confirm your spot."),
    onError: (e) => Alert.alert("Couldn't request a spot", errorText(e)),
  });
  const submit = (v: string) => { setText(v); setAsk(looksLikeRequest(v) ? v : ""); };
  const d = smart.data;
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <SmartSearchBar value={text} onChange={(v) => { setText(v); if (ask) setAsk(""); }} onSubmit={submit} autoFocus={!params.q} />

      {!text.trim() ? (
        <Txt v="small" color={T.muted}>Type a player, team or ground name. Or describe what you want: a day, a time, a role, a format or a distance.</Txt>
      ) : ask ? null : (
        <>
          {typed.length >= 2 && !looksLikeRequest(typed) ? null : (
            <Pressable accessibilityRole="button" accessibilityLabel={`Ask GoFindr: ${text}`} onPress={() => setAsk(text.trim())}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: R.card, backgroundColor: pressed ? T.pressedSoft : T.primarySoft })}>
              <Sparkles size={18} color={T.primaryDark} />
              <Txt v="bodyMed" color={T.primaryDark} style={{ flex: 1 }} numberOfLines={1}>Ask GoFindr: “{text.trim()}”</Txt>
              <ChevronRight size={18} color={T.primaryDark} strokeWidth={1.5} />
            </Pressable>
          )}
          {typed.length < 2 ? null : instant.isPending ? <LoadingSkeleton rows={4} />
            : instant.isError ? <ErrorBox error={instant.error} onRetry={() => void instant.refetch()} />
            : instant.data ? <InstantResults d={instant.data} q={typed} /> : null}
          {typed.length >= 2 && !looksLikeRequest(typed) ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Ask GoFindr: ${text}`} onPress={() => setAsk(text.trim())} style={{ flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" }}>
              <Sparkles size={15} color={T.primaryDark} />
              <Txt v="smallSemi" color={T.primaryDark}>Not a name? Ask GoFindr for “{text.trim()}”</Txt>
            </Pressable>
          ) : null}
        </>
      )}

      {ask ? (
        smart.isPending ? <LoadingSkeleton rows={4} />
        : smart.isError ? <ErrorBox error={smart.error} onRetry={() => void smart.refetch()} />
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
                          <Txt v="h3" numberOfLines={1}>{r.title}</Txt>
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
        ) : null
      ) : null}
    </ScrollView>
  );
}
