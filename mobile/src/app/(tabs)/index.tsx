/**
 * Home — premium redesign (3-screen reference): header (wordmark, role switcher, bell, avatar), greeting +
 * locality, cricket hero with real nearby-match data, pastel 2×2 quick actions, games near you, invitations,
 * community pulse. Captain view: team hero, captain actions, join requests, squad gaps.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { CalendarPlus, ChevronDown, IndianRupee, LandPlot, MapPin, Shield, Trophy, UserRoundSearch, UsersRound } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ago, LocationOptions } from "@/components/cricket";
import { InvitationCard } from "@/components/invites";
import { AppHeader, AvailabilityPill, MatchDiscoveryCard, QuickActionsGrid, SectionHeader, SportsHeroBanner } from "@/components/premium";
import { RacketHome } from "@/components/racket";
import { FilterBottomSheet } from "@/components/sheet";
import { SportSwitcher } from "@/components/sports";
import { Avatar, Badge, Button, Chip, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHomeContext } from "@/lib/context";
import { roleCount, roleLabel, when } from "@/lib/format";
import { useHome } from "@/lib/hooks";
import { useLocation } from "@/lib/location";
import { useOnboarding } from "@/lib/onboarding";
import { isRacket, useSport } from "@/lib/sports";
import { shadow, SP, T } from "@/theme";

type Opp = S<"OpportunityOut">;
type Match = S<"MatchOut">;
type Pulse = { id: string; community_id: string; body: string; created_at: string; community_name?: string | null; author: { full_name: string } };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
const fmt = (f?: string | null) => (f ? (f === "OTHER" ? "Practice" : f) : null);

function Panel({ children, onPress, label }: { children: React.ReactNode; onPress?: () => void; label?: string }) {
  return (
    <Pressable accessibilityRole={onPress ? "button" : undefined} accessibilityLabel={label} disabled={!onPress} onPress={onPress}
      style={({ pressed }) => ({ backgroundColor: pressed ? T.surface2 : T.surface, borderRadius: 20, padding: 16, borderWidth: 1, borderColor: T.line, gap: 8, ...shadow(1) })}>
      {children}
    </Pressable>
  );
}

function CricketHome() {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const { lat, lng, label, radius } = useLocation();
  const home = useHome();
  const h = home.data;
  const locSheet = useRef<BottomSheetModal>(null);
  const ctxStore = useHomeContext();
  const onboarding = useOnboarding((x) => x.pending);
  useEffect(() => { void ctxStore.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (onboarding) router.push("/onboarding"); }, [onboarding]);

  const unread = useQuery({ queryKey: ["notifications", "unread"], queryFn: () => api<{ meta: { unread: number } }>("/notifications", { query: { page_size: 1 } }), refetchInterval: 60_000 });
  const myTeams = useQuery({ queryKey: ["teams", "mine"], queryFn: () => api<{ data: S<"TeamOut">[] }>("/teams", { query: { scope: "mine", page_size: 10 } }) });
  const managed = myTeams.data?.data.filter((t) => h?.managed_team_ids.includes(t.id)) ?? [];
  const isCaptain = managed.length > 0;
  const ctx = isCaptain ? ctxStore.ctx ?? "captain" : "player";
  const [teamId, setTeamId] = useState<string | null>(null);
  const team = managed.find((t) => t.id === teamId) ?? managed[0];

  const invites = useQuery({ queryKey: ["invitations", "received"], queryFn: () => api<{ data: S<"InvitationOut">[] }>("/invitations/me", { query: { box: "received", page_size: 20 } }), refetchInterval: 30_000 });
  const inviteCards = (invites.data?.data ?? []).filter((i) => (i.invitation_status === "pending" && i.can_accept) || ((i.invitation_status === "accepted" || i.invitation_status === "confirmed") && new Date(i.match.start_at).getTime() > Date.now())).slice(0, 2);
  const opps = useQuery({ queryKey: ["home-open-games", lat, lng, radius], queryFn: () => api<{ data: Opp[] }>("/discovery/teams", { method: "POST", body: { radius_km: Number(radius), location: { lat, lng } } }) });
  const games = (opps.data?.data ?? []).filter((o) => o.vacancies > 0);
  const weekend = games.filter((o) => [0, 6].includes(new Date(o.start_at).getDay()) && new Date(o.start_at).getTime() - Date.now() < 7 * 864e5).length;
  const mine = useQuery({ enabled: ctx === "captain", queryKey: ["my-matches"], queryFn: () => api<{ data: Match[] }>("/matches", { query: { role: "captain", when: "upcoming" } }) });
  const teamMatches = (mine.data?.data ?? []).filter((m) => m.viewer_relation === "manager" && (!team || m.team_id === team.id) && ["published", "recruiting", "squad_confirmed"].includes(m.match_status));
  const requests = useQuery({ enabled: ctx === "captain", queryKey: ["invitations", "managed", "requests"], queryFn: () => api<{ data: S<"InvitationOut">[] }>("/invitations/managed", { query: { direction: "request", status: "pending" } }) });
  const pulse = useQuery({ queryKey: ["community-feed", "pulse", lat, lng], queryFn: () => api<Pulse[]>("/communities/feed", { query: { scope: "for_you", lat, lng, radius_km: 25, limit: 2 } }) });
  const refresh = () => { for (const q of [home, myTeams, invites, opps, mine, requests, pulse, unread]) void q.refetch(); };
  const name = h?.greeting_name ?? user?.full_name.split(" ")[0] ?? "";
  const area = [h?.locality, h?.city].filter(Boolean).join(", ") || label;
  const openSpots = teamMatches.reduce((n, m) => n + m.composition.vacancies, 0);

  const playerTiles = [
    { icon: UsersRound, title: "Find Players", sub: "Join nearby games", tone: "mint" as const, onPress: () => router.push("/find/players") },
    { icon: UserRoundSearch, title: "Find Teams", sub: "Teams near you", tone: "aqua" as const, onPress: () => router.push("/find/teams") },
    { icon: LandPlot, title: "Book Ground", sub: "Grounds near you", tone: "peach" as const, onPress: () => router.push("/grounds") },
    { icon: IndianRupee, title: "Split Fees", sub: "Settle match expenses", tone: "lilac" as const, onPress: () => router.push("/payments") },
  ];
  const captainTiles = [
    { icon: CalendarPlus, title: "Create Match", sub: "Date, venue, squad", tone: "mint" as const, onPress: () => router.push(team ? { pathname: "/match/new", params: { team: team.id } } : "/match/new") },
    { icon: UserRoundSearch, title: "Find Players", sub: "Fill by role & time", tone: "aqua" as const, onPress: () => router.push(teamMatches[0] ? { pathname: "/match/players", params: { match: teamMatches[0].id } } : "/match/players") },
    { icon: Shield, title: "Manage Team", sub: "Roster & requests", tone: "peach" as const, onPress: () => team && router.push({ pathname: "/team/[id]", params: { id: team.id } }) },
    { icon: Trophy, title: "Challenge", sub: "Play a nearby team", tone: "lilac" as const, onPress: () => team && router.push({ pathname: "/challenge/new", params: { from: team.id } }) },
  ];

  return (
    <>
      <ScrollView style={{ flex: 1, backgroundColor: T.bg }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP.page, paddingTop: insets.top + 8, paddingBottom: 32, gap: 22 }}
        refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={refresh} tintColor={T.primary} />}>
        <View style={{ gap: 14 }}>
          <AppHeader role={ctx} canCaptain={isCaptain} onRole={(v) => (isCaptain ? ctxStore.set(v) : undefined)} unread={unread.data?.meta.unread} avatarUri={user?.profile_image} name={user?.full_name ?? name} />
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
              <Txt v="h1" numberOfLines={1} style={{ fontSize: 24, lineHeight: 30 }}>{greeting()}, {name} 👋</Txt>
              <Pressable accessibilityRole="button" accessibilityLabel={`Location ${area}. Change`} onPress={() => locSheet.current?.present()} hitSlop={8} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <MapPin size={17} color={T.primary} fill={T.primarySoft} strokeWidth={2.2} />
                <Txt v="bodyMed" numberOfLines={1} style={{ flexShrink: 1, fontSize: 15 }}>{area}</Txt>
                <ChevronDown size={16} color={T.ink} strokeWidth={2.2} />
              </Pressable>
            </View>
            <SportSwitcher compact />
          </View>
        </View>

        {ctx === "player" ? (
          <SportsHeroBanner eyebrow={weekend ? "WEEKEND MATCHES" : "NEAR YOU"} title={"Game on\nthis weekend?"}
            body={opps.isPending ? "Checking games near you…" : games.length ? `${games.length} game${games.length === 1 ? " needs" : "s need"} players within ${radius} km` : `No open games within ${radius} km yet — start one`}
            cta={games.length ? "Find a Game" : "Create Match"} onCta={() => router.push(games.length ? "/quick-match" : "/match/new")} />
        ) : (
          <SportsHeroBanner photo="night" eyebrow="CAPTAIN HUB" title={team ? team.team_name : "Your team"}
            body={teamMatches.length ? `${teamMatches.length} upcoming match${teamMatches.length === 1 ? "" : "es"} · ${openSpots} open spot${openSpots === 1 ? "" : "s"}` : "No upcoming matches — create one"}
            cta={teamMatches.length && openSpots ? "Fill Squad" : "Create Match"}
            onCta={() => router.push(teamMatches[0] && openSpots ? { pathname: "/match/players", params: { match: teamMatches[0].id } } : team ? { pathname: "/match/new", params: { team: team.id } } : "/match/new")} />
        )}
        {ctx === "captain" && managed.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0, marginTop: -8 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 8 }}>
            {managed.map((t) => <Chip key={t.id} label={t.team_name} active={t.id === team?.id} onPress={() => setTeamId(t.id)} />)}
          </ScrollView>
        ) : null}

        <QuickActionsGrid tiles={ctx === "player" ? playerTiles : captainTiles} />

        {inviteCards.length ? (
          <View style={{ gap: 12 }}>
            <SectionHeader title="Match invitations" />
            {inviteCards.map((inv) => <InvitationCard key={inv.id} inv={inv} />)}
          </View>
        ) : null}

        {ctx === "captain" ? (
          <>
            {requests.data?.data.length ? (
              <View style={{ gap: 12 }}>
                <SectionHeader title="Join requests" />
                {requests.data.data.slice(0, 3).map((i) => (
                  <Panel key={i.id} label={`${i.player.full_name} wants to join ${i.match.title}`} onPress={() => router.push({ pathname: "/match/[id]", params: { id: i.match.id } })}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Avatar name={i.player.full_name} uri={i.player.profile_image} size={44} />
                      <View style={{ flex: 1, minWidth: 0 }}><Txt v="h3" numberOfLines={1}>{i.player.full_name}</Txt><Txt v="small" color={T.muted} numberOfLines={1}>{roleLabel(i.proposed_role ?? null)} · {i.match.title}</Txt></View>
                      <Badge status="warning" label="Review" />
                    </View>
                  </Panel>
                ))}
              </View>
            ) : null}
            <View style={{ gap: 12 }}>
              <SectionHeader title="Squad gaps" action="My Games" onAction={() => router.push("/games")} />
              {teamMatches.length ? teamMatches.slice(0, 2).map((m) => {
                const gaps = Object.entries(m.composition.required).map(([r, n]) => [r, n - (m.composition.confirmed[r] ?? 0)] as const).filter(([, n]) => n > 0);
                return (
                  <Panel key={m.id} label={m.title} onPress={() => router.push({ pathname: "/match/[id]", params: { id: m.id } })}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Txt v="h3" numberOfLines={1} style={{ flex: 1 }}>{m.title}</Txt>
                      <Txt v="smallSemi" color={T.muted}>{m.composition.confirmed_total}/{m.composition.capacity}</Txt>
                    </View>
                    <Txt v="small" color={T.muted}>{when(m.start_at)}</Txt>
                    {gaps.length ? <AvailabilityPill text={`Need ${gaps.map(([r, n]) => roleCount(r, n).toLowerCase()).join(", ")}`} /> : <Txt v="small" color={T.successText}>Required roles filled</Txt>}
                    <Button title="Find players" size="sm" onPress={() => router.push({ pathname: "/match/players", params: { match: m.id } })} />
                  </Panel>
                );
              }) : (
                <Panel><Txt v="h3">No upcoming matches</Txt><Txt v="small" color={T.muted}>Create one, then invite available players by role and time.</Txt></Panel>
              )}
            </View>
          </>
        ) : opps.isPending ? null : games.length ? (
          <View style={{ gap: 12 }}>
            <SectionHeader title="Games near you" action="View all" onAction={() => router.push("/quick-match")} />
            {games.length > 1 ? (
              <FlatList horizontal data={games.slice(0, 6)} keyExtractor={(o) => o.match_id} showsHorizontalScrollIndicator={false}
                style={{ marginHorizontal: -SP.page }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 12 }} snapToInterval={width * 0.84 + 12} decelerationRate="fast"
                renderItem={({ item: o }) => (
                  <View style={{ width: width * 0.84 }}>
                    <MatchDiscoveryCard title={o.title} format={fmt(o.format)} when={when(o.start_at, { weekday: "short", hour: "numeric", minute: "2-digit" })} distanceKm={o.approx_distance_km} spots={o.vacancies} onPress={() => router.push({ pathname: "/match/[id]", params: { id: o.match_id } })} />
                  </View>
                )} />
            ) : (
              <MatchDiscoveryCard title={games[0]!.title} format={fmt(games[0]!.format)} when={when(games[0]!.start_at, { weekday: "short", hour: "numeric", minute: "2-digit" })} distanceKm={games[0]!.approx_distance_km} spots={games[0]!.vacancies} onPress={() => router.push({ pathname: "/match/[id]", params: { id: games[0]!.match_id } })} />
            )}
          </View>
        ) : null}

        <View style={{ gap: 12 }}>
          <SectionHeader title="Community pulse" action="Open" onAction={() => router.push("/community")} />
          {pulse.data?.length ? pulse.data.map((p) => (
            <Panel key={p.id} label={`${p.author.full_name}: ${p.body}`} onPress={() => router.push({ pathname: "/community/[id]", params: { id: p.community_id } })}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Avatar name={p.community_name ?? p.author.full_name} size={36} />
                <View style={{ flex: 1, minWidth: 0 }}><Txt v="h3" numberOfLines={1} style={{ fontSize: 15 }}>{p.community_name ?? p.author.full_name}</Txt><Txt v="small" color={T.muted}>{p.author.full_name} · {ago(p.created_at)}</Txt></View>
              </View>
              <Txt v="body" numberOfLines={2} style={{ fontSize: 14 }}>{p.body}</Txt>
            </Panel>
          )) : (
            <Panel onPress={() => router.push("/community")} label="Open community"><Txt v="h3">Your local cricket community</Txt><Txt v="small" color={T.muted}>Match moments, player requests and team news near {label}.</Txt></Panel>
          )}
        </View>
      </ScrollView>
      <FilterBottomSheet ref={locSheet} title="Where are you playing?" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </>
  );
}

/** Home switches by selected sport; badminton/pickleball keep their own home. */
export default function Home() {
  const { sport } = useSport();
  return isRacket(sport) ? <RacketHome sport={sport} /> : <CricketHome />;
}
