/**
 * Find Teams — premium redesign: same header language as Find Players; All Teams / Looking for players /
 * Open matches; cover cards with overlapping team identity, rating only with verified matches, format · area ·
 * ~distance, required positions, and the right action per state (Request to join / Request Pending /
 * Manage Team / View Team). Data: GET /teams/discover (purpose=join).
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Users } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { FlatList, Pressable, View } from "react-native";

import { LocationOptions } from "@/components/cricket";
import { DiscoveryTitle, LocationRow, Pill, PillRow, SearchField, TeamDiscoveryCard, type TeamState } from "@/components/premium";
import { FilterBottomSheet } from "@/components/sheet";
import { Button, Chip, EmptyState, ErrorBox, LoadingSkeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { FORMATS, rating, roleLabel, when } from "@/lib/format";
import { useHome } from "@/lib/hooks";
import { type Radius, useLocation } from "@/lib/location";
import { useSaved } from "@/lib/saved";
import type { DiscoverTeam, FixtureFormat } from "@/lib/types";
import { ICON, SP, T } from "@/theme";

type Mode = "all" | "recruiting" | "open";
const BANDS = [{ v: "", l: "Any rating" }, { v: "0-1450", l: "Up to 1450" }, { v: "1450-1650", l: "1450–1650" }, { v: "1650-4000", l: "1650+" }] as const;

function stateOf(t: DiscoverTeam): TeamState {
  const m = t.my_membership;
  if (m === "captain" || m === "admin") return "mine";
  if (m === "requested") return "pending";
  if (m === "invited") return "invited";
  if (m) return "member";
  return t.open_spots > 0 ? "recruiting" : "full";
}

export default function FindTeamsScreen() {
  const { lat, lng, radius, label, setRadius } = useLocation();
  const home = useHome();
  const myTeam = home.data?.managed_team_ids[0];
  const loadSaved = useSaved((s) => s.load);
  useEffect(() => { void loadSaved(); }, [loadSaved]);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("all");
  const [band, setBand] = useState<(typeof BANDS)[number]["v"]>("");
  const [fmt, setFmt] = useState<FixtureFormat | "">("");
  const [notice, setNotice] = useState<string | null>(null);
  const filters = useRef<BottomSheetModal>(null);
  const locSheet = useRef<BottomSheetModal>(null);
  const [lo, hi] = band ? band.split("-") : [undefined, undefined];
  const res = useQuery({
    queryKey: ["find-teams", lat, lng, radius, q, mode, band, fmt, myTeam],
    queryFn: () => api<DiscoverTeam[]>("/teams/discover", { query: {
      lat, lng, radius_km: radius, purpose: "join", recruiting: mode !== "all" || undefined, q: q || undefined,
      min_rating: lo && lo !== "0" ? lo : undefined, max_rating: hi && hi !== "4000" ? hi : undefined, format: fmt || undefined, from_team_id: myTeam,
    } }),
  });
  const join = useMutation({
    mutationFn: (t: DiscoverTeam) => api(`/teams/${t.team.id}/join-requests`, { method: "POST" }),
    onSuccess: (_d, t) => { void res.refetch(); setNotice(`Request sent — ${t.team.team_name}'s captain will review it.`); },
    onError: (e, t) => setNotice(`Couldn't send a request to ${t.team.team_name}: ${errorText(e)}`),
  });
  const rows = (res.data ?? []).filter((t) => (mode === "open" ? !!t.next_open_match_id : true));
  const active = (band ? 1 : 0) + (fmt ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <FlatList
        data={res.isPending || res.isError ? [] : rows}
        keyExtractor={(t) => t.team.id}
        contentContainerStyle={{ paddingHorizontal: SP.page, paddingBottom: 48, gap: 14 }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={5}
        refreshing={res.isRefetching}
        onRefresh={() => void res.refetch()}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 2 }}>
            <DiscoveryTitle title="Find Teams" />
            <SearchField value={q} onChange={setQ} placeholder="Search team name, format or area" />
            <LocationRow label={label} radius={radius} onLocation={() => locSheet.current?.present()} onFilters={() => filters.current?.present()} activeFilters={active} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["5", "10", "20"] as Radius[]).map((r) => <Pill key={r} label={`${r} km`} active={radius === r} onPress={() => setRadius(r)} />)}
            </View>
            <PillRow>
              {([["all", "All Teams"], ["recruiting", "Looking for players"], ["open", "Open matches"]] as const).map(([v, l]) => <Pill key={v} label={l} active={mode === v} onPress={() => setMode(v)} />)}
            </PillRow>
            {notice ? <View style={{ padding: 12, borderRadius: 14, backgroundColor: T.primarySoft }} accessibilityRole="alert"><Txt v="smallSemi" color={T.primaryDark}>{notice}</Txt></View> : null}
            {res.isPending ? <LoadingSkeleton rows={3} /> : res.isError ? <ErrorBox error={res.error} onRetry={() => void res.refetch()} /> : (
              <Txt v="small" color={T.muted} style={{ fontSize: 14 }}>{rows.length} team{rows.length === 1 ? "" : "s"} within {radius} km · Nearest first</Txt>
            )}
          </View>
        }
        ListEmptyComponent={res.isPending || res.isError ? undefined : (
          <EmptyState icon={<Users size={22} color={T.primaryDark} strokeWidth={ICON.stroke} />} title={mode === "all" ? "No teams found" : "No teams need players right now"} body="Try a wider radius, or add your availability so captains can find you." action="Add my availability" onAction={() => router.push("/availability")} />
        )}
        ListFooterComponent={rows.length ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Create a player request" onPress={() => router.push("/availability")}
            style={({ pressed }) => ({ marginTop: 4, padding: 16, gap: 4, borderRadius: 20, borderWidth: 1.5, borderStyle: "dashed", borderColor: T.primary, backgroundColor: pressed ? T.primarySoft : "transparent" })}>
            <Txt v="h3" color={T.primaryDark}>Create a player request</Txt>
            <Txt v="small" color={T.muted}>Add when you're free — captains searching at that time will find you.</Txt>
          </Pressable>
        ) : undefined}
        renderItem={({ item: t }) => {
          const st = stateOf(t);
          const roles = Object.entries(t.open_roles ?? {});
          const need = roles.length ? `Need ${roles.map(([r, n]) => `${n} ${roleLabel(r).toLowerCase()}${n === 1 ? "" : "s"}`).join(", ")}`
            : t.open_spots ? `Looking for ${t.open_spots} player${t.open_spots === 1 ? "" : "s"}` : st === "full" ? "Squad full" : null;
          const format = t.next_open_match_format ? (t.next_open_match_format === "OTHER" ? "Practice" : t.next_open_match_format) : null;
          return (
            <TeamDiscoveryCard
              id={t.team.id}
              name={t.team.team_name}
              ratingText={t.team.rating && t.team.matches ? `${rating(t.team.rating.rating)} (${t.team.matches})` : null}
              meta={[format, t.team.area ?? t.team.city, `~${t.distance_km} km`].filter(Boolean).join(" · ") + (t.next_open_match_at ? ` · ${when(t.next_open_match_at, { weekday: "short", hour: "numeric" })}` : "")}
              need={need}
              state={st}
              joining={join.isPending && join.variables?.team.id === t.team.id}
              onOpen={() => router.push({ pathname: "/team/[id]", params: { id: t.team.id } })}
              onJoin={st === "recruiting" ? () => { setNotice(null); join.mutate(t); } : undefined}
            />
          );
        }}
      />
      <FilterBottomSheet ref={filters} title="Filter teams" snap={["55%"]}>
        <View style={{ gap: 8 }}><Txt v="label" color={T.muted}>Team rating</Txt><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{BANDS.map((b) => <Chip key={b.v} label={b.l} active={band === b.v} onPress={() => setBand(b.v)} />)}</View></View>
        <View style={{ gap: 8 }}><Txt v="label" color={T.muted}>Format they play</Txt><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}><Chip label="Any" active={!fmt} onPress={() => setFmt("")} />{FORMATS.map((f) => <Chip key={f.v} label={f.l} active={fmt === f.v} onPress={() => setFmt(f.v)} />)}</View></View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title="Clear" variant="secondary" onPress={() => { setBand(""); setFmt(""); }} style={{ flex: 1 }} />
          <Button title={res.data ? `Show ${rows.length} teams` : "Show teams"} onPress={() => filters.current?.dismiss()} style={{ flex: 2 }} />
        </View>
      </FilterBottomSheet>
      <FilterBottomSheet ref={locSheet} title="Search near" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </View>
  );
}
