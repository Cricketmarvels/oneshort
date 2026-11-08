import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Info, SlidersHorizontal, Swords, Trophy, UserPlus } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { DemoBanner, LocationOptions, PlayerLeaderboardCard, Podium, TeamLeaderboardCard } from "@/components/cricket";
import { HeroScreen } from "@/components/layout";
import { FilterBottomSheet } from "@/components/sheet";
import { Button, Chip, ChipRow, EmptyState, ErrorBox, IconButton, List, LoadingSkeleton, Segmented, TextLink, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useManagedTeam } from "@/lib/hooks";
import { CATEGORIES, FORMATS, formatLabel, SCOPES } from "@/lib/format";
import { useLocation } from "@/lib/location";
import type { Category, FixtureFormat, PlayerBoard, PlayerEntry, Scope, TeamBoard } from "@/lib/types";
import { ICON, SP, T } from "@/theme";

export default function Leaderboard() {
  const [kind, setKind] = useState<"players" | "teams">("players");
  const [scope, setScope] = useState<Scope>("10km");
  const [category, setCategory] = useState<Category>("overall");
  const [fmt, setFmt] = useState<FixtureFormat | null>(null);
  const [page, setPage] = useState(1);
  const [focus, setFocus] = useState<PlayerEntry | null>(null);
  const loc = useLocation();
  const { user } = useAuth();
  const locSheet = useRef<BottomSheetModal>(null);
  const filterSheet = useRef<BottomSheetModal>(null);
  const actionSheet = useRef<BottomSheetModal>(null);
  const geo = { lat: loc.lat, lng: loc.lng, city: loc.city };

  const players = useQuery({
    queryKey: ["lb", "players", scope, category, fmt, page, geo],
    enabled: kind === "players",
    queryFn: () => api<PlayerBoard>("/players/leaderboard", { query: { scope, category, format: fmt ?? undefined, page, page_size: 25, ...geo } }),
  });
  const teams = useQuery({
    queryKey: ["lb", "teams", scope, geo],
    enabled: kind === "teams",
    queryFn: () => api<TeamBoard>("/teams/leaderboard", { query: { scope, page_size: 50, ...geo } }),
  });
  const myTeam = useManagedTeam();

  const board = players.data;
  const rows = board?.data ?? [];
  const openPlayer = (e: PlayerEntry) => router.push({ pathname: "/player/[id]", params: { id: e.user.id } });
  const invite = async (e: PlayerEntry) => {
    if (!myTeam) return Alert.alert("Create a team first", "You can invite players once you captain a team.");
    try {
      await api(`/teams/${myTeam}/members`, { method: "POST", body: { user_id: e.user.id } });
      Alert.alert("Invitation sent", `${e.user.full_name} has been invited to your team.`);
    } catch (err) { Alert.alert("Couldn't invite", errorText(err)); }
  };
  const showTop = page === 1 && rows.length >= 3 && !board?.meta.insufficient_data;
  const list = showTop ? rows.slice(3) : rows;
  const scopeLabel = SCOPES.find((x) => x.v === scope)?.l ?? scope;
  const context = scope.endsWith("km") ? `${loc.label} · ${scopeLabel}` : `${kind === "players" ? board?.meta.scope_label ?? scopeLabel : teams.data?.meta.scope_label ?? scopeLabel}`;

  return (
    <>
      <HeroScreen title="Leaderboard" subtitle={context} onSubtitle={() => locSheet.current?.present()} dense
        right={<IconButton filled label="How rankings work" icon={<Info size={20} color={T.ink} strokeWidth={ICON.stroke} />} onPress={() => router.push("/about-ratings")} />}
        refreshing={players.isRefetching || teams.isRefetching} onRefresh={() => void (kind === "players" ? players.refetch() : teams.refetch())}>
        <View style={{ gap: SP.md }}>
          <Segmented value={kind} onChange={(v) => { setKind(v); setPage(1); }} options={[{ v: "players", l: "Players" }, { v: "teams", l: "Teams" }]} />
          <ChipRow value={scope} onChange={(v) => { setScope(v); setPage(1); }} options={SCOPES} />
          {kind === "players" ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0 }} contentContainerStyle={{ gap: 8, paddingHorizontal: SP.page }}>
              <Chip label={fmt ? formatLabel(fmt) : "Format"} active={!!fmt} icon={<SlidersHorizontal size={14} color={fmt ? T.primaryDark : T.ink} strokeWidth={2} />} onPress={() => filterSheet.current?.present()} />
              {CATEGORIES.map((c) => <Chip key={c.v} label={c.l} active={category === c.v} onPress={() => { setCategory(c.v); setPage(1); if (c.v !== "overall") setFmt(null); }} />)}
            </ScrollView>
          ) : null}
        </View>
        {kind === "players" ? (
          <View style={{ gap: SP.md }}>
            <Integrity method={board?.meta.method} category={category} />
            <DemoBanner show={board?.meta.includes_demo_data} />
            {board?.me && !rows.some((e) => e.user.id === board.me!.user.id) ? (
              <View style={{ gap: 8 }}>
                <Txt v="label" color={T.muted}>Your position</Txt>
                <List><PlayerLeaderboardCard e={board.me} me last onPress={() => openPlayer(board.me!)} /></List>
              </View>
            ) : !players.isPending && board && !board.me && user ? (
              <Txt v="small" color={T.muted}>You're not ranked in this view yet. Play a verified match{fmt ? ` in ${formatLabel(fmt)} (3+ needed)` : ""} to appear.</Txt>
            ) : null}
            {players.isPending ? <LoadingSkeleton rows={6} /> : players.isError ? (
              <ErrorBox error={players.error} onRetry={() => void players.refetch()} />
            ) : rows.length === 0 || board?.meta.insufficient_data ? (
              <EmptyState icon={<Trophy size={22} color={T.primaryDark} strokeWidth={ICON.stroke} />} title="Not enough verified matches here yet" body="Rankings need at least 3 players with verified matches. Try a wider area." action="Widen to National" onAction={() => setScope("national")} />
            ) : (
              <View style={{ gap: SP.md }}>
                {showTop ? <Podium top={rows.slice(0, 3)} onPress={openPlayer} /> : null}
                {list.length ? <List>{list.map((e, i) => <PlayerLeaderboardCard key={e.user.id} e={e} me={e.user.id === user?.id} last={i === list.length - 1} onPress={() => openPlayer(e)} onMore={() => { setFocus(e); actionSheet.current?.present(); }} />)}</List> : null}
                {board?.meta.has_next || page > 1 ? (
                  <View style={{ flexDirection: "row", justifyContent: "space-between", paddingTop: SP.sm }}>
                    {page > 1 ? <TextLink title="← Previous" onPress={() => setPage(page - 1)} /> : <View />}
                    {board?.meta.has_next ? <TextLink title="Next →" onPress={() => setPage(page + 1)} /> : null}
                  </View>
                ) : null}
              </View>
            )}
          </View>
        ) : (
          <View style={{ gap: SP.md }}>
            <Integrity method={teams.data?.meta.method} team />
            <DemoBanner show={teams.data?.meta.includes_demo_data} />
            {teams.isPending ? <LoadingSkeleton rows={6} /> : teams.isError ? <ErrorBox error={teams.error} onRetry={() => void teams.refetch()} />
              : !teams.data.data.length ? <EmptyState icon={<Trophy size={22} color={T.primaryDark} strokeWidth={ICON.stroke} />} title="No ranked teams here yet" body="Teams are ranked after their first verified result." action="Widen to National" onAction={() => setScope("national")} />
              : <List>{teams.data.data.map((e, i) => (
                <TeamLeaderboardCard key={e.team.id} e={e} last={i === teams.data.data.length - 1} onPress={() => router.push({ pathname: "/team/[id]", params: { id: e.team.id } })}
                  onChallenge={myTeam && myTeam !== e.team.id ? () => router.push({ pathname: "/challenge/new", params: { from: myTeam, to: e.team.id } }) : undefined} />
              ))}</List>}
          </View>
        )}
      </HeroScreen>

      <FilterBottomSheet ref={locSheet} title="Rankings area" snap={["85%"]}>
        <View style={{ gap: 8 }}>
          <Txt v="label" color={T.muted}>Area</Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{SCOPES.map((x) => <Chip key={x.v} label={x.l} active={scope === x.v} onPress={() => { setScope(x.v); setPage(1); }} />)}</View>
        </View>
        <LocationOptions onDone={() => locSheet.current?.dismiss()} />
      </FilterBottomSheet>
      <FilterBottomSheet ref={filterSheet} title="Cricket format" snap={["50%"]}>
        <Txt v="small" color={T.muted}>Format rankings use the overall rating and need at least 3 verified matches in that format.</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Chip label="All formats" active={!fmt} onPress={() => { setFmt(null); filterSheet.current?.dismiss(); }} />
          {FORMATS.map((f) => <Chip key={f.v} label={f.l} active={fmt === f.v} onPress={() => { setFmt(f.v); setCategory("overall"); setPage(1); filterSheet.current?.dismiss(); }} />)}
        </View>
      </FilterBottomSheet>
      <FilterBottomSheet ref={actionSheet} title={focus?.user.full_name ?? ""} snap={["42%"]}>
        {focus ? (
          <View style={{ gap: SP.sm }}>
            <Button title="View profile" onPress={() => { actionSheet.current?.dismiss(); openPlayer(focus); }} />
            <Button title="Compare with me" variant="secondary" icon={<Swords size={16} color={T.ink} strokeWidth={ICON.stroke} />} disabled={!user || user.id === focus.user.id}
              onPress={() => { actionSheet.current?.dismiss(); router.push({ pathname: "/compare", params: { a: user!.id, b: focus.user.id } }); }} />
            <Button title="Invite to my team" variant="secondary" icon={<UserPlus size={16} color={T.ink} strokeWidth={ICON.stroke} />} disabled={!myTeam || user?.id === focus.user.id}
              onPress={() => { actionSheet.current?.dismiss(); void invite(focus); }} />
          </View>
        ) : null}
      </FilterBottomSheet>
    </>
  );
}

const CATEGORY_RULE: Record<string, string> = {
  overall: "Overall skill rating, blended by playing role.",
  batting: "Batting rating: runs, strike rate and share of the team total against the format's par.",
  bowling: "Bowling rating: wickets and economy against the format's par.",
  all_rounder: "Combined batting and bowling ratings — only players rated in both.",
  fielding: "Catches, run-outs and stumpings from verified scorecards.",
  consistency: "How steady your match-to-match impact is — rewards showing up and performing reliably, not one big game.",
  rising: "Biggest verified rating gains in recent weeks — rewards improvement and regular play.",
};

/** Expandable "How rankings work" explainer (refined spec §5.17): method, who is and isn't ranked, what's rewarded. */
function Integrity({ method, category, team }: { method?: string; category?: string; team?: boolean }) {
  const [open, setOpen] = useState(false);
  const rules: [string, string][] = [
    ["What counts", "Only captain-verified results. Self-reported or imported stats are never ranked, and disputed results don't count until resolved."],
    ["How the order is set", team ? "Team rating from verified results (win 1, tie ½, loss 0), adjusted for opponent strength. Ranked by proven rating = rating − 2 × uncertainty." : `${CATEGORY_RULE[category ?? "overall"] ?? ""} Ranked by proven rating = rating − 2 × uncertainty, so a few lucky games can't outrank a long record.`],
    ["Who isn't ranked yet", team ? "Teams without a verified result." : "Players without a verified match, and anyone with fewer than 3 verified matches in a format view. Provisional ratings (under 5 matches) are marked."],
    ["Participation counts too", "Most Consistent and Rising Stars reward turning up and improving — not just top scores."],
  ];
  return (
    <View style={{ borderRadius: 18, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line, overflow: "hidden" }}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel="How rankings work" onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 14 }}>
        <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: T.primarySoft, alignItems: "center", justifyContent: "center" }}><Info size={17} color={T.primaryDark} strokeWidth={2} /></View>
        <View style={{ flex: 1 }}>
          <Txt v="h3" style={{ fontSize: 14.5 }}>How rankings work</Txt>
          <Txt v="small" color={T.muted} numberOfLines={open ? undefined : 1}>{team ? "Verified results only · proven rating" : CATEGORY_RULE[category ?? "overall"]}</Txt>
        </View>
        <Txt v="smallSemi" color={T.primaryDark}>{open ? "Hide" : "Show"}</Txt>
      </Pressable>
      {open ? (
        <View style={{ paddingHorizontal: 14, paddingBottom: 14, gap: 10 }}>
          {rules.map(([h, b]) => <View key={h} style={{ gap: 2 }}><Txt v="smallSemi">{h}</Txt><Txt v="small" color={T.muted}>{b}</Txt></View>)}
          {method ? <Txt v="small" color={T.faint} style={{ fontSize: 11.5 }}>{method}</Txt> : null}
          <View style={{ alignSelf: "flex-start" }}><TextLink title="Full methodology" onPress={() => router.push("/about-ratings")} /></View>
        </View>
      ) : null}
    </View>
  );
}
