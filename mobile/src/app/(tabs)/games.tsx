/**
 * My Games — modelled on the "Your games" reference: compact title, locality + radius subtitle,
 * Upcoming / Past tabs, compact white game cards (date block, title, meta, people, status chip, overflow).
 * Challenges, invitations and contributions sit under Upcoming as short sections.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { MATCH_STATUS_LABELS, type S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CalendarClock, ChevronRight, Plus, ReceiptIndianRupee, Swords, Trophy } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";

import { GameCard, LocationOptions, MatchCard, TeamChallengeCard } from "@/components/cricket";
import { HeroScreen } from "@/components/layout";
import { FilterBottomSheet } from "@/components/sheet";
import { Button, EmptyState, ErrorBox, IconButton, List, LoadingSkeleton, Row, Section, Txt, UnderlineTabs } from "@/components/ui";
import { api } from "@/lib/api";
import { when } from "@/lib/format";
import { useManagedTeam } from "@/lib/hooks";
import { useIsCaptain } from "@/lib/roles";
import { useLocation } from "@/lib/location";
import type { Challenge, Fixture } from "@/lib/types";
import { ICON, SP, T } from "@/theme";

type Tab = "upcoming" | "past";
type Pickup = S<"MatchOut">;
const TONE: Record<string, "success" | "warning" | "danger" | "info" | "neutral"> = {
  draft: "neutral", published: "info", recruiting: "success", squad_confirmed: "success", scheduled: "success", in_progress: "warning", completed: "success", cancelled: "neutral",
};

export default function Games() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === "results" || params.tab === "past" ? "past" : "upcoming");
  useEffect(() => { if (params.tab) setTab(params.tab === "results" || params.tab === "past" ? "past" : "upcoming"); }, [params.tab]);
  const { label, radius } = useLocation();
  const myTeam = useManagedTeam();
  const locSheet = useRef<BottomSheetModal>(null);
  const menu = useRef<BottomSheetModal>(null);
  const [focus, setFocus] = useState<Fixture | null>(null);
  const canCaptain = useIsCaptain();
  const challenge = () => (myTeam ? router.push({ pathname: "/challenge/new", params: { from: myTeam } }) : canCaptain ? router.push("/team/new") : router.push("/find/teams"));
  const more = (f: Fixture) => { setFocus(f); menu.current?.present(); };
  return (
    <>
      <HeroScreen title="Your games" subtitle={`${label} · ${radius} km`} onSubtitle={() => locSheet.current?.present()} dense
        right={<IconButton filled label={myTeam ? "Challenge a team" : "Create a team"} icon={<Plus size={22} color={T.ink} strokeWidth={ICON.stroke} />} onPress={challenge} />}
        hero={<UnderlineTabs value={tab} onChange={setTab} options={[{ v: "upcoming", l: "Upcoming" }, { v: "past", l: "Past" }]} />}>
        {tab === "upcoming" ? <Upcoming onChallenge={challenge} onMore={more} /> : <Past onMore={more} />}
      </HeroScreen>
      <FilterBottomSheet ref={locSheet} title="Where are you playing?" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
      <FilterBottomSheet ref={menu} title={focus ? `${focus.home_team.team_name} vs ${focus.away_team.team_name}` : ""} snap={["46%"]}>
        {focus ? (
          <View style={{ gap: SP.sm }}>
            <Button title="View match details" onPress={() => { menu.current?.dismiss(); router.push({ pathname: "/fixture/[id]", params: { id: focus.id } }); }} />
            {focus.actions.includes("submit_result") ? <Button title="Submit result" variant="secondary" icon={<Trophy size={17} color={T.ink} strokeWidth={ICON.stroke} />} onPress={() => { menu.current?.dismiss(); router.push({ pathname: "/fixture/[id]", params: { id: focus.id } }); }} /> : null}
            {focus.actions.includes("verify") ? <Button title="Verify result" variant="secondary" icon={<Trophy size={17} color={T.ink} strokeWidth={ICON.stroke} />} onPress={() => { menu.current?.dismiss(); router.push({ pathname: "/fixture/[id]", params: { id: focus.id } }); }} /> : null}
            {focus.my_team_id ? <Button title="Match fee · split & track" variant="secondary" icon={<ReceiptIndianRupee size={17} color={T.ink} strokeWidth={ICON.stroke} />} onPress={() => { menu.current?.dismiss(); router.push({ pathname: "/fee", params: { fixture: focus.id, team: focus.my_team_id!, title: `${focus.home_team.team_name} vs ${focus.away_team.team_name}` } }); }} /> : null}
          </View>
        ) : null}
      </FilterBottomSheet>
    </>
  );
}

function PickupCard({ m, highlight }: { m: Pickup; highlight?: boolean }) {
  const c = m.composition;
  const open = c.capacity - c.confirmed_total;
  const status = m.match_status === "recruiting" && open > 0 ? { label: `${open} spot${open === 1 ? "" : "s"} open`, tone: "success" as const } : { label: MATCH_STATUS_LABELS[m.match_status], tone: TONE[m.match_status] ?? "neutral" };
  return (
    <GameCard iso={m.start_at} title={m.title} highlight={highlight} meta={`${m.format === "OTHER" ? "Practice" : m.format} · ${when(m.start_at, { hour: "numeric", minute: "2-digit" })} · ${m.venue.name ?? m.venue.area}`}
      crests={[m.team_name]} extra={c.confirmed_total} extraLabel={`${c.confirmed_total} of ${c.capacity} players confirmed`} status={status}
      onPress={() => router.push({ pathname: "/match/[id]", params: { id: m.id } })} />
  );
}

function Upcoming({ onChallenge, onMore }: { onChallenge: () => void; onMore: (f: Fixture) => void }) {
  const up = useQuery({ queryKey: ["fixtures", "upcoming"], queryFn: () => api<Fixture[]>("/fixtures", { query: { when: "upcoming" } }) });
  const aw = useQuery({ queryKey: ["fixtures", "awaiting"], queryFn: () => api<Fixture[]>("/fixtures", { query: { when: "awaiting" } }) });
  const pickup = useQuery({ queryKey: ["matches", "upcoming"], queryFn: () => api<{ data: Pickup[] }>("/matches", { query: { when: "upcoming", role: "all" } }) });
  const ch = useQuery({ queryKey: ["challenges", "all", "active"], queryFn: () => api<Challenge[]>("/challenges", { query: { box: "all", status: "active" } }) });
  if (up.isPending || aw.isPending) return <LoadingSkeleton rows={3} />;
  if (up.isError) return <ErrorBox error={up.error} onRetry={() => void up.refetch()} />;
  const awaiting = (aw.data ?? []).filter((f) => f.actions.length);
  const games = [...awaiting, ...up.data];
  const pick = pickup.data?.data ?? [];
  const challenges = ch.data ?? [];
  return (
    <View style={{ gap: SP.section }}>
      {games.length || pick.length ? (
        <View style={{ gap: 14 }}>
          {awaiting.length ? <Txt v="small" color={T.muted}>Results count for rankings only after the opposing captain verifies them.</Txt> : null}
          {games.map((f, i) => <MatchCard key={f.id} f={f} highlight={i === 0} onMore={() => onMore(f)} />)}
          {pick.map((m, i) => <PickupCard key={m.id} m={m} highlight={!games.length && i === 0} />)}
        </View>
      ) : (
        <EmptyState icon={<CalendarClock size={22} color={T.primaryDark} strokeWidth={ICON.stroke} />} title="No upcoming games" body="Find a game to get started, or challenge a nearby team." action="Find a game" onAction={() => router.push({ pathname: "/discover", params: { tab: "matches" } })} />
      )}
      {challenges.length ? (
        <Section title="Team challenges" action="New challenge" onAction={onChallenge}>
          <List>{challenges.map((c, i) => <TeamChallengeCard key={c.id} c={c} last={i === challenges.length - 1} />)}</List>
        </Section>
      ) : null}
      <Section title="Contributions">
        <List>
          <Row onPress={() => router.push("/payments")} label="My match fees" last>
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: T.tint, alignItems: "center", justifyContent: "center" }}><ReceiptIndianRupee size={18} color={T.primaryDark} strokeWidth={ICON.stroke} /></View>
            <View style={{ flex: 1, gap: 2 }}><Txt v="h3" style={{ fontSize: 14.5 }}>My match fees</Txt><Txt v="small" color={T.muted}>Shares captains have split with you</Txt></View>
            <ChevronRight size={18} color={T.faint} strokeWidth={2} />
          </Row>
        </List>
      </Section>
      {!challenges.length ? (
        <Button title="Challenge a team" variant="secondary" icon={<Swords size={17} color={T.ink} strokeWidth={ICON.stroke} />} onPress={onChallenge} />
      ) : null}
    </View>
  );
}

function Past({ onMore }: { onMore: (f: Fixture) => void }) {
  const q = useQuery({ queryKey: ["fixtures", "past"], queryFn: () => api<Fixture[]>("/fixtures", { query: { when: "past" } }) });
  const pickup = useQuery({ queryKey: ["matches", "past"], queryFn: () => api<{ data: Pickup[] }>("/matches", { query: { when: "past", role: "all" } }) });
  if (q.isPending) return <LoadingSkeleton rows={4} />;
  if (q.isError) return <ErrorBox error={q.error} onRetry={() => void q.refetch()} />;
  const pick = pickup.data?.data ?? [];
  if (!q.data.length && !pick.length) return <EmptyState icon={<Trophy size={22} color={T.primaryDark} strokeWidth={ICON.stroke} />} title="No past games yet" body="Verified results appear here and update everyone's ratings." />;
  return (
    <View style={{ gap: 10 }}>
      {q.data.map((f) => <MatchCard key={f.id} f={f} onMore={() => onMore(f)} />)}
      {pick.map((m) => <PickupCard key={m.id} m={m} />)}
    </View>
  );
}
