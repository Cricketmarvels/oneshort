/**
 * Home — premium redesign (3-screen reference): header (wordmark, role switcher, bell, avatar), greeting +
 * locality, cricket hero with real nearby-match data, pastel 2×2 quick actions, games near you, invitations,
 * community pulse. Captain view: team hero, captain actions, join requests, squad gaps.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ago, LocationOptions } from "@/components/cricket";
import { ShortChip, shortLabel } from "@/components/brand";
import { ActionCardGrid } from "@/components/dashboard/ActionCardGrid";
import { captainActions, playerActions } from "@/components/dashboard/dashboardActions";
import { CricHeroesEditor, HomeCricHeroesCard } from "@/components/cricheroes-link";
import { PlayRIcon } from "@/components/icons";
import { InvitationCard } from "@/components/invites";
import { AppHeader, MatchDiscoveryCard, SectionHeader, SportsHeroBanner } from "@/components/premium";
import { RacketHome } from "@/components/racket";
import { SmartSearchBar } from "@/components/search-bar";
import { FilterBottomSheet } from "@/components/sheet";
import { SportSwitcher } from "@/components/sports";
import { Avatar, Badge, Button, Chip, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { savePlayerCricHeroes } from "@/lib/cricheroes";
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

/** Real opportunity → compact match card (date, time, distance, area, open spots, roles still needed). */
function GameCard({ o }: { o: Opp }) {
  const needs = Object.entries(o.roles_needed ?? {}).filter(([, n]) => n > 0).map(([r, n]) => roleCount(r, n).toLowerCase()).join(", ");
  return (
    <MatchDiscoveryCard title={o.title} format={fmt(o.format)} date={when(o.start_at, { weekday: "short", day: "numeric", month: "short" })} time={when(o.start_at, { hour: "numeric", minute: "2-digit" })}
      distanceKm={o.approx_distance_km} area={o.area ?? o.city} spots={o.vacancies} needs={needs || null} cta={o.my_status ? "View" : "Join"} cover={o.cover_image}
      onPress={() => router.push({ pathname: "/match/[id]", params: { id: o.match_id } })} />
  );
}

function CricketHome() {
  const insets = useSafeAreaInsets();
  const [ask, setAsk] = useState("");
  const [chEdit, setChEdit] = useState(false);
  const { width } = useWindowDimensions();
  const { user } = useAuth();
  const me = useQuery({ enabled: !!user, queryKey: ["rating", user?.id], queryFn: () => api<S<"PlayerRatingOut">>(`/ratings/players/${user!.id}`) });
  const { lat, lng, label, radius, source: locSource } = useLocation();
  const home = useHome();
  const h = home.data;
  const locSheet = useRef<BottomSheetModal>(null);
  const ctxStore = useHomeContext();
  const onb = useOnboarding();
  const needsOnboarding = onb.needs(user);
  useEffect(() => { void ctxStore.load(); void onb.load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (needsOnboarding) router.push("/onboarding"); }, [needsOnboarding]);

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
  // My own fixtures: every upcoming match I'm in the squad for (as a player or as the captain).
  const playing = useQuery({ queryKey: ["my-matches", "playing"], queryFn: () => api<{ data: Match[] }>("/matches", { query: { role: "all", when: "upcoming" } }), refetchInterval: 60_000 });
  const weekEnd = (() => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); d.setHours(23, 59, 59, 999); return d.getTime(); })(); // end of this Sunday
  const myGames = (playing.data?.data ?? []).filter((m) => ["roster", "manager"].includes(m.viewer_relation) && !["cancelled", "completed"].includes(m.match_status)).sort((a, b) => a.start_at.localeCompare(b.start_at));
  const myWeekend = myGames.filter((m) => new Date(m.start_at).getTime() <= weekEnd);
  const myShown = (myWeekend.length ? myWeekend : myGames).slice(0, 3);
  // People asking to join the captain's team (the team itself, not one match).
  const teamDash = useQuery({ enabled: ctx === "captain" && !!team, queryKey: ["team", team?.id, "dashboard"], queryFn: () => api<S<"TeamDashboardOut">>(`/teams/${team!.id}/dashboard`), refetchInterval: 60_000 });
  const teamRequests = teamDash.data?.can_manage ? teamDash.data.join_requests : [];
  const pulse = useQuery({ queryKey: ["community-feed", "pulse", lat, lng], queryFn: () => api<Pulse[]>("/communities/feed", { query: { scope: "for_you", lat, lng, radius_km: 25, limit: 2 } }) });
  const refresh = () => { for (const q of [home, myTeams, invites, opps, mine, requests, pulse, unread, playing, teamDash]) void q.refetch(); };
  const name = h?.greeting_name ?? user?.full_name.split(" ")[0] ?? "";
  // The place results are measured from: what the player just picked (device or an area) wins over the saved profile area.
  const area = locSource !== "default" ? label : [h?.locality, h?.city].filter(Boolean).join(", ") || label;
  const openSpots = teamMatches.reduce((n, m) => n + m.composition.vacancies, 0);

  const actionCards = ctx === "player" ? playerActions() : captainActions({ teamId: team?.id, matchId: teamMatches[0]?.id });

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: T.bg }} showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: SP.page, paddingTop: insets.top + 8, paddingBottom: 56, gap: 22 }}
        refreshControl={<RefreshControl refreshing={home.isRefetching} onRefresh={refresh} tintColor={T.primary} />}>
        <View style={{ gap: 14 }}>
          <AppHeader role={ctx} canCaptain={isCaptain} onRole={(v) => (isCaptain ? ctxStore.set(v) : undefined)} unread={unread.data?.meta.unread} avatarUri={user?.profile_image} name={user?.full_name ?? name} />
          <View style={{ gap: 6 }}>
            <Txt v="h1" style={{ fontSize: width < 390 ? 21 : 23, lineHeight: width < 390 ? 27 : 29 }}>{greeting()}, {name}</Txt>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Location ${area}. Change`} onPress={() => locSheet.current?.present()} hitSlop={8} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 6 }}>
                <PlayRIcon name="pin" size={18} weight="fill" />
                <Txt v="bodyMed" numberOfLines={1} style={{ flexShrink: 1, fontSize: 15 }}>{area}</Txt>
                <PlayRIcon name="caret" size={15} color={T.ink} weight="bold" />
              </Pressable>
              <SportSwitcher compact />
            </View>
          </View>
        </View>

        <SmartSearchBar value={ask} onChange={setAsk} onSubmit={(v) => { const t = v.trim(); if (t.length >= 2) router.push({ pathname: "/search", params: { q: t } }); }} />

        {ctx === "player" ? (
          <SportsHeroBanner eyebrow={weekend ? "WEEKEND MATCHES" : "NEAR YOU"} title={"Game on\nthis weekend?"}
            body={opps.isPending ? "Checking games near you…" : games.length ? `${games.length} team${games.length === 1 ? " is" : "s are"} short of players within ${radius} km` : `No open games within ${radius} km yet — start one`}
            cta={games.length ? "Find a Game" : "Create Match"} onCta={() => router.push(games.length ? "/quick-match" : "/match/new")} />
        ) : (
          <SportsHeroBanner photo="ground" focus={{ left: "55%", top: "45%" }} eyebrow="CAPTAIN HUB" title={team ? team.team_name : "Your team"}
            body={teamMatches.length ? `${teamMatches.length} upcoming match${teamMatches.length === 1 ? "" : "es"} · ${openSpots ? `${shortLabel(openSpots).toLowerCase()} across the squads` : "every squad is full"}` : "No upcoming matches — create one"}
            cta={teamMatches.length && openSpots ? "Fill Squad" : "Create Match"}
            onCta={() => router.push(teamMatches[0] && openSpots ? { pathname: "/match/players", params: { match: teamMatches[0].id } } : team ? { pathname: "/match/new", params: { team: team.id } } : "/match/new")} />
        )}
        {ctx === "captain" && managed.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0, marginTop: -8 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 8 }}>
            {managed.map((t) => <Chip key={t.id} label={t.team_name} active={t.id === team?.id} onPress={() => setTeamId(t.id)} />)}
          </ScrollView>
        ) : null}

        <ActionCardGrid cards={actionCards} />
        {chEdit ? (
          <CricHeroesEditor kind="player" current={me.data?.cricheroes_profile_url} currentStats={me.data?.cricheroes_stats}
            save={async (u, st) => { await savePlayerCricHeroes(u, st); await me.refetch(); }} onClose={() => setChEdit(false)} />
        ) : me.data ? <HomeCricHeroesCard url={me.data.cricheroes_profile_url} stats={me.data.cricheroes_stats} onEdit={() => setChEdit(true)} /> : null}

        {ctx === "player" && myShown.length ? (
          <View style={{ gap: 12 }}>
            <SectionHeader title={myWeekend.some((m) => [0, 6].includes(new Date(m.start_at).getDay())) ? "Your matches this weekend" : myWeekend.length ? "Your matches this week" : "Your upcoming matches"} action="My Games" onAction={() => router.push("/games")} />
            {myShown.map((m) => (
              <Panel key={m.id} label={`${m.title}, ${when(m.start_at)}`} onPress={() => router.push({ pathname: "/match/[id]", params: { id: m.id } })}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Txt v="h3" numberOfLines={2} style={{ flex: 1, fontSize: 16.5, lineHeight: 21 }}>{m.title}</Txt>
                  <Badge status="success" label={m.viewer_relation === "manager" ? "Captain" : "You're in"} />
                </View>
                <Txt v="small" color={T.ink}>{when(m.start_at, { weekday: "long", day: "numeric", month: "short" })} · {when(m.start_at, { hour: "numeric", minute: "2-digit" })}</Txt>
                <Txt v="small" color={T.muted} numberOfLines={1}>{[m.venue.name, m.venue.area, m.venue.city].filter(Boolean).join(", ")} · {m.team_name}</Txt>
              </Panel>
            ))}
          </View>
        ) : null}

        {ctx === "captain" && teamRequests.length && team ? (
          <View style={{ gap: 12 }}>
            <SectionHeader title="Team join requests" />
            {teamRequests.slice(0, 3).map((r) => (
              <Panel key={r.user.id} label={`${r.user.full_name} requested to join ${team.team_name}`} onPress={() => router.push({ pathname: "/team/[id]", params: { id: team.id } })}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <Avatar name={r.user.full_name} uri={r.user.profile_image} size={44} />
                  <View style={{ flex: 1, minWidth: 0 }}><Txt v="h3" numberOfLines={2}>{r.user.full_name} requested to join the team</Txt><Txt v="small" color={T.muted} numberOfLines={1}>{roleLabel(r.primary_role ?? null)} · {team.team_name}</Txt></View>
                  <Badge status="warning" label="Review" />
                </View>
              </Panel>
            ))}
          </View>
        ) : null}

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
              <SectionHeader title="Squad status" action="My Games" onAction={() => router.push("/games")} />
              {teamMatches.length ? teamMatches.slice(0, 2).map((m) => {
                const gaps = Object.entries(m.composition.required).map(([r, n]) => [r, n - (m.composition.confirmed[r] ?? 0)] as const).filter(([, n]) => n > 0);
                return (
                  <Panel key={m.id} label={m.title} onPress={() => router.push({ pathname: "/match/[id]", params: { id: m.id } })}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Txt v="h3" numberOfLines={2} style={{ flex: 1, fontSize: 16.5, lineHeight: 21 }}>{m.title}</Txt>
                      <ShortChip short={m.composition.vacancies} />
                    </View>
                    <Txt v="small" color={T.muted}>{when(m.start_at)} · {m.composition.confirmed_total}/{m.composition.capacity} confirmed</Txt>
                    {gaps.length ? <Txt v="small" color={T.ink}>Need {gaps.map(([r, n]) => roleCount(r, n).toLowerCase()).join(", ")}</Txt> : null}
                    <View style={{ flexDirection: "row", gap: 8 }}>
                      <Button title="Invite regulars" size="sm" onPress={() => router.push({ pathname: "/match/[id]", params: { id: m.id } })} style={{ flex: 1 }} />
                      <Button title="Find players" size="sm" variant="secondary" onPress={() => router.push({ pathname: "/match/players", params: { match: m.id } })} style={{ flex: 1 }} />
                    </View>
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
                style={{ marginHorizontal: -SP.page }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 12 }} snapToInterval={Math.min(width * 0.86, 360) + 12} decelerationRate="fast"
                renderItem={({ item: o }) => (
                  <View style={{ width: Math.min(width * 0.86, 360) }}>
                    <GameCard o={o} />
                  </View>
                )} />
            ) : (
              <GameCard o={games[0]!} />
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
