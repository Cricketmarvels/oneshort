import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { BadgeCheck, CalendarPlus, ChevronRight, Crown, Mail, MapPin, Shield, Swords, Trophy, UserPlus, UserRoundSearch, Users } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, useWindowDimensions, View } from "react-native";

import { VersusCard } from "@/components/art";
import { RowHeader, ShareButton, ShieldCrest, StatTile } from "@/components/identity";
import { CricHeroesSection } from "@/components/CricHeroes";
import { CricHeroesCard, CricHeroesEditor } from "@/components/cricheroes-link";
import { DemoBanner, HeadToHeadCard, MatchCard, SkillBadge, TeamChallengeCard } from "@/components/cricket";
import { FilterBottomSheet, PromptModal } from "@/components/sheet";
import { Avatar, Badge, Button, Card, EmptyState, ErrorBox, LoadingSkeleton, Section, Segmented, Stat, TextLink, Txt } from "@/components/ui";
import { FormPills, PlayerPerformanceChart } from "@/components/viz";
import { MediaEditButton, TeamCoverImage, TeamLogo } from "@/components/media";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rating, roleCount, roleLabel, when } from "@/lib/format";
import { ActionGrid, KickerChip, SectionHeader } from "@/components/refined";
import type { S } from "@cm/shared";
import { useManagedTeam } from "@/lib/hooks";
import { useLocation } from "@/lib/location";
import type { Dashboard, DiscoverTeam } from "@/lib/types";
import { R, SP, T } from "@/theme";

type Tab = "overview" | "roster" | "performance";
type Member = Dashboard["roster"][number];

/** Compact fixture row: opponent crest, date · time, "vs Opponent", venue. */
function FixtureRow({ f, me }: { f: Dashboard["upcoming"][number]; me: string }) {
  const opp = f.home_team.id === me ? f.away_team : f.home_team;
  return (
    <Card onPress={() => router.push({ pathname: "/fixture/[id]", params: { id: f.id } })} label={`vs ${opp.team_name}`} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      <ShieldCrest name={opp.team_name} size={40} />
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="small" color={T.muted}>{when(f.start_at, { weekday: "short", day: "numeric", month: "short" })} • {when(f.start_at, { hour: "numeric", minute: "2-digit" })}</Txt>
        <Txt v="h3"><Txt v="h3" color={T.primaryDark}>vs </Txt>{opp.team_name}</Txt>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><MapPin size={12} color={T.faint} strokeWidth={2} /><Txt v="small" color={T.muted} numberOfLines={1}>{f.venue.name}</Txt></View>
      </View>
      <ChevronRight size={20} color={T.muted} strokeWidth={2} />
    </Card>
  );
}

export default function TeamDashboard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const myTeam = useManagedTeam();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const key = ["team", id, "dashboard"];
  const q = useQuery({ queryKey: key, queryFn: () => api<Dashboard>(`/teams/${id}/dashboard`) });
  const loc = useLocation();
  const rival = useQuery({
    queryKey: ["team", id, "rival", loc.lat, loc.lng], enabled: !!q.data?.can_manage,
    queryFn: async () => (await api<DiscoverTeam[]>("/teams/discover", { query: { lat: loc.lat, lng: loc.lng, radius_km: 25, from_team_id: id } })).filter((t) => !t.open_challenge_id),
  });
  const [tab, setTab] = useState<Tab>("overview");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [focus, setFocus] = useState<Member | null>(null);
  const sheet = useRef<BottomSheetModal>(null);
  const reload = () => { void qc.invalidateQueries({ queryKey: key }); void qc.invalidateQueries({ queryKey: ["home"] }); };
  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try { await fn(); sheet.current?.dismiss(); reload(); if (done) Alert.alert(done); } catch (e) { Alert.alert("Couldn't do that", errorText(e)); }
  };
  const [chEdit, setChEdit] = useState(false);
  const capMatches = useQuery({ queryKey: ["my-matches"], queryFn: () => api<{ data: S<"MatchOut">[] }>("/matches", { query: { role: "captain", when: "upcoming" } }) });
  const join = useMutation({ mutationFn: () => api(`/teams/${id}/join-requests`, { method: "POST" }), onSuccess: () => { reload(); Alert.alert("Request sent", "The captain will review it."); }, onError: (e) => Alert.alert("Couldn't send", errorText(e)) });

  if (q.isPending) return <View style={{ flex: 1, backgroundColor: T.paper, padding: SP.page }}><LoadingSkeleton rows={5} /></View>;
  if (q.isError) return <View style={{ padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View>;
  const d = q.data;
  const rec = d.record;
  const canChallenge = myTeam && myTeam !== d.team.id && !d.can_manage;
  const active = d.roster.filter((r) => r.member_status === "active");
  const invited = d.roster.filter((r) => r.member_status === "invited").length;
  const openMatches = (capMatches.data?.data ?? []).filter((m) => m.team_id === d.team.id && m.viewer_relation === "manager" && ["published", "recruiting"].includes(m.match_status) && m.composition.vacancies > 0);

  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={reload} tintColor={T.primary} />}>
      <Stack.Screen options={{ title: d.can_manage ? "My Team" : "Team Profile", headerTitleAlign: "left", headerRight: () => <ShareButton message={`${d.team.team_name} on OneShort — rating ${d.team.rating ? rating(d.team.rating.rating) : "new"}`} /> }} />
      {d.can_manage ? (
        /* My team (captain dashboard) */
        <View style={{ paddingHorizontal: SP.page, paddingTop: SP.sm, gap: SP.lg }}>
          <View style={{ borderRadius: 22, overflow: "hidden", backgroundColor: T.heroInk }}>
            <TeamCoverImage name={d.team.team_name} uri={d.team.cover_image} height={128} />
            <View style={{ position: "absolute", top: 10, right: 10 }}>
              <MediaEditButton onDark label={d.team.cover_image ? "Change cover" : "Add cover photo"} purpose="team_cover" save={(u) => api(`/teams/${id}`, { method: "PUT", body: { cover_image: u } }).then(reload)} />
            </View>
          <View style={{ padding: 20, gap: 14 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <TeamLogo name={d.team.team_name} uri={d.team.logo} size={64} ring />
              <View style={{ flex: 1, gap: 4 }}>
                <KickerChip label="YOUR TEAM" tone="dark" />
                <Txt v="h1" color="#FFFFFF" numberOfLines={2}>{d.team.team_name}</Txt>
                <Txt v="small" color="rgba(255,255,255,0.75)">{[d.team.area, d.team.city].filter(Boolean).join(", ")}</Txt>
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              {([
                [String(active.length), "Roster"],
                [String(openMatches.reduce((n, m) => n + m.composition.vacancies, 0)), "Open spots"],
                [d.team.rating && d.team.matches ? rating(d.team.rating.rating) : "New", d.rank_city ? `Rating · #${d.rank_city}` : "Rating"],
              ] as const).map(([v, l]) => (
                <View key={l} style={{ flex: 1, padding: 10, borderRadius: 14, backgroundColor: "rgba(255,255,255,0.08)" }}>
                  <Txt v="h2" color="#FFFFFF" numberOfLines={1}>{v}</Txt>
                  <Txt v="small" color="rgba(255,255,255,0.72)" style={{ fontSize: 12 }}>{l}</Txt>
                </View>
              ))}
            </View>
            <MediaEditButton onDark label={d.team.logo ? "Change team logo" : "Add team logo"} purpose="team_logo" save={(u) => api(`/teams/${id}`, { method: "PUT", body: { logo: u } }).then(reload)} />
          </View>
          </View>
          <ActionGrid tiles={[
            { icon: CalendarPlus, title: "Create Match", onPress: () => router.push({ pathname: "/match/new", params: { team: d.team.id } }) },
            { icon: UserRoundSearch, title: "Find Players", onPress: () => router.push(openMatches[0] ? { pathname: "/match/players", params: { match: openMatches[0].id } } : "/match/players") },
            { icon: UserPlus, title: "Invite by number", onPress: () => setInviteOpen(true) },
            { icon: Trophy, title: "Challenge", onPress: () => router.push({ pathname: "/challenge/new", params: { from: d.team.id } }) },
          ]} />
          {openMatches.length ? (
            <View style={{ gap: SP.sm }}>
              <SectionHeader title="Open positions" />
              {openMatches.slice(0, 3).map((m) => {
                const gaps = Object.entries(m.composition.required).map(([r, n]) => [r, n - (m.composition.confirmed[r] ?? 0)] as const).filter(([, n]) => n > 0);
                return (
                  <Pressable key={m.id} accessibilityRole="button" accessibilityLabel={`${m.title}: ${m.composition.vacancies} open. Find players`} onPress={() => router.push({ pathname: "/match/players", params: { match: m.id } })}
                    style={({ pressed }) => ({ padding: 14, gap: 8, borderRadius: R.card, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface })}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Txt v="h3" numberOfLines={1} style={{ flex: 1 }}>{m.title}</Txt>
                      <KickerChip label={`${m.composition.vacancies} OPEN`} tone="orange" />
                    </View>
                    <Txt v="small" color={T.muted}>{when(m.start_at)} · {m.composition.confirmed_total} / {m.composition.capacity} in squad</Txt>
                    {gaps.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{gaps.map(([r, n]) => <KickerChip key={r} label={roleCount(r, n).toUpperCase()} />)}</View> : null}
                    <Txt v="smallSemi" color={T.primaryDark}>Find players →</Txt>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
          <View>
            <RowHeader title="Team overview" action="See all" onAction={() => setTab("roster")} />
            <View style={{ flexDirection: "row", gap: 12 }}>
              {([["Join requests", d.join_requests.length, `${d.join_requests.length} request${d.join_requests.length === 1 ? "" : "s"}`, Users], ["Pending invites", invited, `${invited} invite${invited === 1 ? "" : "s"}`, Mail]] as const).map(([l, , sub, Icon]) => (
                <Card key={l} style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
                  <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.tint, alignItems: "center", justifyContent: "center" }}><Icon size={19} color={T.primaryDark} strokeWidth={2} /></View>
                  <View style={{ flex: 1 }}><Txt v="smallSemi">{l}</Txt><Txt v="small" color={T.muted}>{sub}</Txt></View>
                </Card>
              ))}
            </View>
          </View>
          {d.upcoming[0] ? (
            <View>
              <RowHeader title="Next fixture" />
              <FixtureRow f={d.upcoming[0]} me={d.team.id} />
            </View>
          ) : null}
        </View>
      ) : (
        /* Team profile (public) */
        <View style={{ paddingHorizontal: SP.page, paddingTop: SP.md, gap: SP.lg }}>
          <View style={{ alignItems: "center", gap: 6 }}>
            <View style={{ alignSelf: "stretch", borderRadius: 22, overflow: "hidden" }}><TeamCoverImage name={d.team.team_name} uri={d.team.cover_image} height={140} /></View>
            <View style={{ marginTop: -56 }}><TeamLogo name={d.team.team_name} uri={d.team.logo} size={104} ring /></View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 }}>
              <Txt v="hero" style={{ fontSize: 23 }}>{d.team.team_name}</Txt>
              {d.team.rating && !d.team.rating.provisional ? <BadgeCheck size={19} color={T.surface} fill={T.primary} strokeWidth={2} accessibilityLabel="Verified team" /> : null}
            </View>
            <Txt v="body" color={T.muted}>{[d.team.area, d.team.city].filter(Boolean).join(", ")} · Captain {d.captain.full_name}</Txt>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <StatTile value={d.team.rating ? rating(d.team.rating.rating) : "New"} label={d.rank_city ? `Team rating · #${d.rank_city}` : "Team rating"} />
            <StatTile value={rec?.win_pct != null ? `${Math.round(rec.win_pct)}%` : "—"} label="Win rate" />
          </View>
          {rec?.form.length ? (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <Txt v="h3">Recent form</Txt>
              <FormPills form={rec.form.slice(-5)} />
            </View>
          ) : null}
          {active.length ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Roster, ${active.length} players`} onPress={() => setTab("roster")} style={{ flexDirection: "row", alignItems: "center" }}>
              {active.slice(0, 5).map((m, i) => <View key={m.user.id} style={{ marginLeft: i ? -8 : 0, borderRadius: 30, borderWidth: 3, borderColor: T.bg }}><Avatar uri={m.user.profile_image} name={m.user.full_name} size={46} /></View>)}
              {active.length > 5 ? <View style={{ marginLeft: -8, width: 52, height: 52, borderRadius: 26, borderWidth: 3, borderColor: T.bg, backgroundColor: T.surface2, alignItems: "center", justifyContent: "center" }}><Txt v="smallSemi" color={T.muted}>+{active.length - 5}</Txt></View> : null}
            </Pressable>
          ) : null}
          {d.upcoming.length ? (
            <View>
              <RowHeader title="Upcoming fixtures" action={d.upcoming.length > 1 ? "See all" : undefined} onAction={() => router.push("/games")} />
              <FixtureRow f={d.upcoming[0]!} me={d.team.id} />
            </View>
          ) : null}
          <View style={{ gap: 10 }}>
            {d.my_membership === "invited" ? <Button title="Accept invitation" variant="highlight" size="lg" onPress={() => void act(() => api(`/teams/${id}/membership/accept`, { method: "POST" }), "Welcome to the team!")} /> : null}
            {!d.my_membership ? <Button title="Join team" variant="highlight" size="lg" onPress={() => join.mutate()} loading={join.isPending} /> : null}
            {d.my_membership === "requested" ? <Badge status="warning" label="Join request pending — the captain will review it" /> : null}
            {canChallenge ? <Button title="Challenge team" variant="outline" size="lg" icon={<Swords size={18} color={T.ink} strokeWidth={2} />} onPress={() => router.push({ pathname: "/challenge/new", params: { from: myTeam, to: d.team.id } })} /> : null}
          </View>
        </View>
      )}

      <View style={{ padding: SP.page, gap: SP.xl }}>
        {chEdit && d.can_manage ? (
          <CricHeroesEditor kind="team" current={d.cricheroes_team_url} onClose={() => setChEdit(false)}
            save={async (u) => { try { await api(`/teams/${id}`, { method: "PUT", body: { cricheroes_team_url: u } }); } catch (e) { throw new Error(errorText(e)); } reload(); }} />
        ) : (
          <CricHeroesCard kind="team" url={d.cricheroes_team_url} onEdit={d.can_manage ? () => setChEdit(true) : undefined} />
        )}
        <DemoBanner show={d.includes_demo_data} />
        <Segmented value={tab} onChange={setTab} options={[{ v: "overview", l: "Overview" }, { v: "roster", l: `Roster (${d.roster.filter((r) => r.member_status === "active").length})` }, { v: "performance", l: "Performance" }]} />

        {tab === "overview" ? (
          <>
            {d.can_manage ? (
              <VersusCard photo="stadium"
                left={{ name: d.team.team_name, sub: d.team.rating ? rating(d.team.rating.rating) : "Unrated" }}
                right={rival.data?.[0] ? { name: rival.data[0].team.team_name, sub: rival.data[0].team.rating ? `${rating(rival.data[0].team.rating.rating)} · ~${rival.data[0].distance_km} km` : `~${rival.data[0].distance_km} km` } : null}
                top={<Txt v="label" color={T.accent}>{rival.data?.[0] ? "Suggested rival near you" : "Challenge a team"}</Txt>}
                cta={
                  <View style={{ gap: SP.sm }}>
                    <Button title={rival.data?.[0] ? `Challenge ${rival.data[0].team.team_name}` : "Challenge a team"} variant="secondary" icon={<Swords size={18} color={T.ink} strokeWidth={1.5} />}
                      onPress={() => router.push({ pathname: "/challenge/new", params: rival.data?.[0] ? { from: d.team.id, to: rival.data[0].team.id } : { from: d.team.id } })} />
                    <TextLink title="Browse all opponents" onPress={() => router.push({ pathname: "/challenge/new", params: { from: d.team.id } })} />
                  </View>
                } />
            ) : null}
            {d.awaiting_action.filter((f) => f.actions.length).length ? (
              <Section title="Needs action">{d.awaiting_action.filter((f) => f.actions.length).map((f) => <MatchCard key={f.id} f={f} />)}</Section>
            ) : null}
            {d.can_manage && d.join_requests.length ? (
              <Section title={`Join requests (${d.join_requests.length})`}>
                {d.join_requests.map((m) => (
                  <Card key={m.user.id}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <Avatar uri={m.user.profile_image} name={m.user.full_name} size={40} />
                      <View style={{ flex: 1 }}><Txt v="h3">{m.user.full_name}</Txt><Txt v="small" color={T.muted}>{roleLabel(m.primary_role)} · {m.rating ? `${rating(m.rating.rating)} rating` : "Unrated"}</Txt></View>
                    </View>
                    <View style={{ flexDirection: "row", gap: SP.sm }}>
                      <Button title="Approve" size="sm" onPress={() => void act(() => api(`/teams/${id}/join-requests/${m.user.id}/approve`, { method: "POST" }))} style={{ flex: 1 }} />
                      <Button title="Decline" size="sm" variant="secondary" onPress={() => void act(() => api(`/teams/${id}/join-requests/${m.user.id}/decline`, { method: "POST" }))} style={{ flex: 1 }} />
                    </View>
                  </Card>
                ))}
              </Section>
            ) : null}
            {d.can_manage ? (
              <Section title="Active challenges" action="New" onAction={() => router.push({ pathname: "/challenge/new", params: { from: d.team.id } })}>
                {d.challenges.length ? <View>{d.challenges.map((c, k) => <TeamChallengeCard key={c.id} c={c} last={k === d.challenges.length - 1} />)}</View>
                  : <EmptyState title="No active challenges" action="Challenge a team" onAction={() => router.push({ pathname: "/challenge/new", params: { from: d.team.id } })} />}
              </Section>
            ) : null}
            <Section title="Fixtures">
              {d.upcoming.length ? <View>{d.upcoming.map((f, k) => <MatchCard key={f.id} f={f} last={k === d.upcoming.length - 1} />)}</View> : <Txt v="small" color={T.muted}>No upcoming fixtures.</Txt>}
            </Section>
            {d.rating_history.length > 1 ? (
              <Section title="Team rating history"><Card><PlayerPerformanceChart values={d.rating_history} w={width - SP.lg * 4} /></Card></Section>
            ) : null}
            {d.description ? <Card><Txt v="label" color={T.muted}>About</Txt><Txt v="body" color={T.text2}>{d.description}</Txt></Card> : null}
            {d.can_manage ? <CricHeroesSection teamId={d.team.id} /> : null}
          </>
        ) : tab === "roster" ? (
          <>
            {d.can_manage ? <Button title="Invite a player" icon={<UserPlus size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => setInviteOpen(true)} /> : null}
            {/* TeamRoster */}
            {d.roster.map((m) => (
              <Card key={m.user.id} onPress={() => (d.can_manage && m.member_role !== "captain" ? (setFocus(m), sheet.current?.present()) : router.push({ pathname: "/player/[id]", params: { id: m.user.id } }))} label={m.user.full_name}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View>
                    <Avatar uri={m.user.profile_image} name={m.user.full_name} size={46} />
                    {m.available_next_7_days != null ? <View accessibilityLabel={m.available_next_7_days ? "Available this week" : "Unavailable this week"} style={{ position: "absolute", right: -1, bottom: -1, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: T.white, backgroundColor: m.available_next_7_days ? T.up : T.switchOff }} /> : null}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Txt v="h3" numberOfLines={1} style={{ flexShrink: 1 }}>{m.user.full_name}{m.user.id === user?.id ? " (you)" : ""}</Txt>
                      {m.member_role === "captain" ? <Crown size={14} color={T.accent} fill={T.accent} strokeWidth={1.5} /> : m.member_role === "admin" ? <Shield size={14} color={T.info} strokeWidth={1.5} /> : null}
                    </View>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <SkillBadge role={m.primary_role} />
                      <Txt v="small" color={T.muted}>{m.member_role === "captain" ? "Captain" : m.member_role === "admin" ? "Vice-captain" : "Member"}{m.member_status === "invited" ? " · invited" : ""}</Txt>
                    </View>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Txt v="number">{m.rating ? rating(m.rating.rating) : "—"}</Txt>
                    <Txt v="small" color={m.rating?.provisional ? T.warn : T.muted} style={{ fontSize: 11 }}>{m.rating ? (m.rating.provisional ? "Provisional" : `${Math.round(m.rating.confidence * 100)}%`) : "Unrated"}</Txt>
                  </View>
                </View>
              </Card>
            ))}
          </>
        ) : (
          <>
            {/* TeamPerformanceCard */}
            {rec ? (
              <Card style={{ gap: SP.lg }}>
                <View style={{ flexDirection: "row", gap: SP.md }}>
                  <Stat label="Played" value={rec.matches} /><Stat label="Won" value={rec.won} accent /><Stat label="Lost" value={rec.lost} /><Stat label="Tied" value={rec.tied} />
                </View>
                <Txt v="small" color={T.muted}>Rating {rating(rec.rating)} ±{Math.round(rec.rd)} · ranked by rating − 2×uncertainty, so match count alone never decides rank.</Txt>
              </Card>
            ) : <EmptyState title="No verified results yet" body="Performance appears once results are verified by the opposing captain." />}
            {d.contributions.length ? (
              <Section title="Player contributions">
                <Card style={{ gap: 0 }}>
                  <View style={{ flexDirection: "row", paddingBottom: 8 }}>
                    <Txt v="label" color={T.muted} style={{ flex: 1 }}>Player</Txt>
                    {["M", "Runs", "Wkts", "Ct"].map((h) => <Txt key={h} v="label" color={T.muted} style={{ width: 44, textAlign: "right" }}>{h}</Txt>)}
                  </View>
                  {d.contributions.map((c) => (
                    <View key={c.user.id} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 8, borderTopWidth: 1, borderTopColor: T.line }}>
                      <Txt v="smallSemi" style={{ flex: 1 }} numberOfLines={1} onPress={() => router.push({ pathname: "/player/[id]", params: { id: c.user.id } })}>{c.user.full_name}</Txt>
                      {[c.matches, c.runs, c.wickets, c.catches].map((v, i) => <Txt key={i} v="small" style={{ width: 44, textAlign: "right" }}>{v}</Txt>)}
                    </View>
                  ))}
                </Card>
              </Section>
            ) : null}
            {d.head_to_head.length ? <Section title="Rivalries">{d.head_to_head.map((h) => <HeadToHeadCard key={h.team_b.id} h={h} />)}</Section> : null}
            <Section title="Recent results">{d.recent.length ? d.recent.map((f) => <MatchCard key={f.id} f={f} />) : <Txt v="small" color={T.muted}>No results yet.</Txt>}</Section>
          </>
        )}
      </View>

      <PromptModal visible={inviteOpen} title="Invite a player" body="Enter their registered mobile number, e.g. +919812345678. You can also invite from the leaderboard." placeholder="+91…" confirm="Invite" minLength={10}
        onCancel={() => setInviteOpen(false)} onSubmit={(mobile) => { setInviteOpen(false); void act(() => api(`/teams/${id}/members`, { method: "POST", body: { mobile_number: mobile.replace(/\s/g, "") } }), "Invitation sent"); }} />
      <FilterBottomSheet ref={sheet} title={focus?.user.full_name ?? ""} snap={["45%"]}>
        {focus ? (
          <View style={{ gap: SP.sm }}>
            <Button title="View profile" variant="secondary" onPress={() => { sheet.current?.dismiss(); router.push({ pathname: "/player/[id]", params: { id: focus.user.id } }); }} />
            {d.is_captain && focus.member_status === "active" ? (
              focus.member_role === "admin"
                ? <Button title="Remove vice-captain role" variant="secondary" onPress={() => void act(() => api(`/teams/${id}/members/${focus.user.id}`, { method: "PUT", body: { member_role: "member" } }))} />
                : <Button title="Make vice-captain" variant="secondary" icon={<Shield size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => void act(() => api(`/teams/${id}/members/${focus.user.id}`, { method: "PUT", body: { member_role: "admin" } }), `${focus.user.full_name} is now vice-captain`)} />
            ) : null}
            <Button title={focus.member_status === "invited" ? "Cancel invitation" : "Remove from team"} variant="danger" onPress={() => void act(() => api(`/teams/${id}/members/${focus.user.id}`, { method: "DELETE" }))} />
          </View>
        ) : null}
      </FilterBottomSheet>
    </ScrollView>
  );
}
