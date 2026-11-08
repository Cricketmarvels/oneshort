/**
 * Explore (starter v2 app/discover.tsx): one search entry and "Title →" cards to every discovery journey.
 * Old deep links (/discover?tab=…) forward to the matching screen.
 */
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { LandPlot, Trophy, UserRoundSearch, Users, UsersRound, Zap } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { SmartSearchBar } from "@/components/search-bar";
import { H, LinkCard, SectionRow, StarterScreen } from "@/components/starter";
import { Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useLocation } from "@/lib/location";
import { T } from "@/theme";

const FORWARD = { matches: "/quick-match", players: "/find/players", teams: "/find/teams", grounds: "/grounds", communities: "/community" } as const;

export default function Explore() {
  const params = useLocalSearchParams<{ tab?: keyof typeof FORWARD }>();
  useEffect(() => { if (params.tab && FORWARD[params.tab]) router.push(FORWARD[params.tab]); }, [params.tab]);
  const { lat, lng, radius, label } = useLocation();
  const [q, setQ] = useState("");
  const players = useQuery({ queryKey: ["explore", "players", lat, lng, radius], queryFn: () => api<unknown[]>("/players/nearby", { query: { lat, lng, radius_km: radius } }) });
  const teams = useQuery({ queryKey: ["explore", "teams", lat, lng, radius], queryFn: () => api<{ open_spots: number }[]>("/teams/discover", { query: { lat, lng, radius_km: radius, purpose: "join", recruiting: true } }) });
  const grounds = useQuery({ queryKey: ["grounds", lat, lng, ""], queryFn: () => api<unknown[]>("/venues", { query: { lat, lng } }) });
  const games = useQuery({ queryKey: ["home-open-games", lat, lng, radius], queryFn: () => api<{ data: S<"OpportunityOut">[] }>("/discovery/teams", { method: "POST", body: { radius_km: Number(radius), location: { lat, lng } } }) });
  const n = (x?: unknown[]) => (x ? x.length : null);
  const open = games.data?.data.filter((o) => o.vacancies > 0).length;
  return (
    <StarterScreen safeTop refreshing={players.isRefetching} onRefresh={() => { for (const x of [players, teams, grounds, games]) void x.refetch(); }}>
      <H title="Explore" sub={`Find your next sports connection · ${label}, ${radius} km`} />
      <SmartSearchBar value={q} onChange={setQ} onSubmit={(v) => { if (v.trim().length >= 2) router.push({ pathname: "/search", params: { q: v.trim() } }); }} />
      <View style={{ gap: 12 }}>
        <LinkCard icon={UserRoundSearch} title="Find Players" sub={n(players.data) != null ? `${n(players.data)} players within ${radius} km` : "Players near you"} onPress={() => router.push("/find/players")} />
        <LinkCard icon={Users} title="Find Teams" sub={n(teams.data) != null ? `${n(teams.data)} teams looking for players` : "Teams near you"} onPress={() => router.push("/find/teams")} />
        <LinkCard icon={LandPlot} title="Book a Ground" sub={n(grounds.data) != null ? `${n(grounds.data)} grounds · contact the venue to book` : "Grounds near you"} onPress={() => router.push("/grounds")} />
        <LinkCard icon={Zap} title="Quick Match" sub={open != null ? `${open} game${open === 1 ? "" : "s"} with open spots` : "Games that need players soon"} onPress={() => router.push("/quick-match")} />
      </View>
      <View style={{ gap: 12 }}>
        <SectionRow title="More" />
        <LinkCard icon={Trophy} title="Leaderboard" sub="Local rankings from verified matches" onPress={() => router.push("/leaderboard")} />
        <LinkCard icon={UsersRound} title="Communities" sub="Local groups for your sector, society or office" onPress={() => router.push("/community")} />
      </View>
      <Txt v="small" color={T.muted}>Distances are approximate. Exact player locations are never shown.</Txt>
    </StarterScreen>
  );
}
