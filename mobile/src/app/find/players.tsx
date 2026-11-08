/**
 * Find Players — premium redesign: back + title, search, location + filter button, 5/10/20 km, role chips,
 * virtualised compact player cards (photo/initials, rating only when verified matches exist, role, ~distance,
 * area, availability, save, invite with sending/sent/error states). Data: GET /players/nearby.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { S } from "@cm/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { CircleDot, Hand, Shuffle, Slash, UserPlus, Users } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { FlatList, View } from "react-native";

import { LocationOptions } from "@/components/cricket";
import { InviteToMatch } from "@/components/find";
import { DiscoveryTitle, type InviteState, LocationRow, Pill, PillRow, PlayerDiscoveryCard, SearchField } from "@/components/premium";
import { FilterBottomSheet } from "@/components/sheet";
import { Button, Chip, EmptyState, ErrorBox, LoadingSkeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { rating, roleLabel } from "@/lib/format";
import { useHome } from "@/lib/hooks";
import { type Radius, useLocation } from "@/lib/location";
import { useSaved } from "@/lib/saved";
import { ICON, SP, T } from "@/theme";

type Nearby = S<"NearbyPlayerOut">;
const ROLES = [
  { v: "", l: "All Roles" },
  { v: "batsman", l: "Batter", icon: Slash },
  { v: "bowler", l: "Bowler", icon: CircleDot },
  { v: "wicketkeeper", l: "WK", icon: Hand },
  { v: "all_rounder", l: "All-rounder", icon: Shuffle },
] as const;
const MIN_RATING = [{ v: "", l: "Any rating" }, { v: "1400", l: "1400+" }, { v: "1500", l: "1500+" }, { v: "1600", l: "1600+" }] as const;

export default function FindPlayersScreen() {
  const { lat, lng, radius, label, setRadius } = useLocation();
  const home = useHome();
  const myTeam = home.data?.managed_team_ids[0];
  const loadSaved = useSaved((s) => s.load);
  useEffect(() => { void loadSaved(); }, [loadSaved]);
  const [q, setQ] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]["v"]>("");
  const [minRating, setMinRating] = useState<(typeof MIN_RATING)[number]["v"]>("");
  const [available, setAvailable] = useState(false);
  const [sort, setSort] = useState<"distance" | "rating">("distance");
  const [focus, setFocus] = useState<Nearby | null>(null);
  const [pickMatch, setPickMatch] = useState(false);
  const [invites, setInvites] = useState<Record<string, InviteState>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const filters = useRef<BottomSheetModal>(null);
  const locSheet = useRef<BottomSheetModal>(null);
  const invite = useRef<BottomSheetModal>(null);
  const res = useQuery({
    queryKey: ["nearby-players", lat, lng, radius, q, role, minRating, available, sort],
    queryFn: () => api<Nearby[]>("/players/nearby", { query: { lat, lng, radius_km: radius, q: q || undefined, role: role || undefined, min_rating: minRating || undefined, available: available || undefined, sort } }),
  });
  const mark = (id: string, st: InviteState) => setInvites((m) => ({ ...m, [id]: st }));
  const toTeam = useMutation({
    mutationFn: (p: Nearby) => api(`/teams/${myTeam}/members`, { method: "POST", body: { user_id: p.user.id } }),
    onMutate: (p) => mark(p.user.id, "sending"),
    onSuccess: (_r, p) => { mark(p.user.id, "sent"); invite.current?.dismiss(); setNotice(`${p.user.full_name} has been invited to your team.`); },
    onError: (e, p) => { mark(p.user.id, "error"); setNotice(`Couldn't invite ${p.user.full_name}: ${errorText(e)}`); },
  });
  const active = (minRating ? 1 : 0) + (available ? 1 : 0) + (sort !== "distance" ? 1 : 0);
  const data = res.data ?? [];
  const open = useCallback((id: string) => router.push({ pathname: "/player/[id]", params: { id } }), []);

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <FlatList
        data={res.isPending || res.isError ? [] : data}
        keyExtractor={(p) => p.user.id}
        contentContainerStyle={{ paddingHorizontal: SP.page, paddingBottom: 48, gap: 12 }}
        keyboardShouldPersistTaps="handled"
        initialNumToRender={8}
        windowSize={7}
        refreshing={res.isRefetching}
        onRefresh={() => void res.refetch()}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 2 }}>
            <DiscoveryTitle title="Find Players" />
            <SearchField value={q} onChange={setQ} placeholder="Search by name, role or team" />
            <LocationRow label={label} radius={radius} onLocation={() => locSheet.current?.present()} onFilters={() => filters.current?.present()} activeFilters={active} />
            <View style={{ flexDirection: "row", gap: 8 }}>
              {(["5", "10", "20"] as Radius[]).map((r) => <Pill key={r} label={`${r} km`} active={radius === r} onPress={() => setRadius(r)} />)}
            </View>
            <PillRow>{ROLES.map((r) => <Pill key={r.v} label={r.l} icon={"icon" in r ? r.icon : undefined} active={role === r.v} onPress={() => setRole(r.v)} />)}</PillRow>
            {notice ? <View style={{ padding: 12, borderRadius: 14, backgroundColor: T.primarySoft }} accessibilityRole="alert"><Txt v="smallSemi" color={T.primaryDark}>{notice}</Txt></View> : null}
            {res.isPending ? <LoadingSkeleton rows={4} /> : res.isError ? <ErrorBox error={res.error} onRetry={() => void res.refetch()} /> : (
              <Txt v="small" color={T.muted} style={{ fontSize: 14 }}>{data.length} player{data.length === 1 ? "" : "s"} within {radius} km · {sort === "rating" ? "Top rated first" : "Nearest first"}</Txt>
            )}
          </View>
        }
        ListEmptyComponent={res.isPending || res.isError ? undefined : (
          <EmptyState icon={<Users size={22} color={T.primaryDark} strokeWidth={ICON.stroke} />} title="No players found" body={`Try a wider radius${active || role ? " or clear filters" : ""}.`} action="Show 20 km" onAction={() => setRadius("20")} />
        )}
        renderItem={({ item: p }) => (
          <PlayerDiscoveryCard
            id={p.user.id}
            name={p.user.full_name}
            photo={p.user.profile_image}
            role={roleLabel(p.primary_role)}
            ratingText={p.rating && p.verified_matches ? `${rating(p.rating.rating)} (${p.verified_matches})` : null}
            meta={`~${p.distance_km} km${p.locality ? ` · ${p.locality}` : ""}`}
            available={p.available_this_week}
            canInvite={!!myTeam}
            invite={invites[p.user.id] ?? "idle"}
            onOpen={() => open(p.user.id)}
            onInvite={() => { setFocus(p); setPickMatch(false); setNotice(null); invite.current?.present(); }}
          />
        )}
      />
      <FilterBottomSheet ref={filters} title="Filter players" snap={["60%"]}>
        <Group label="Player rating">{MIN_RATING.map((r) => <Chip key={r.v} label={r.l} active={minRating === r.v} onPress={() => setMinRating(r.v)} />)}</Group>
        <Group label="Availability">
          <Chip label="Anyone" active={!available} onPress={() => setAvailable(false)} />
          <Chip label="Available this week" active={available} onPress={() => setAvailable(true)} />
        </Group>
        <Group label="Sort by">
          <Chip label="Nearest" active={sort === "distance"} onPress={() => setSort("distance")} />
          <Chip label="Top rated" active={sort === "rating"} onPress={() => setSort("rating")} />
        </Group>
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title="Clear" variant="secondary" onPress={() => { setMinRating(""); setAvailable(false); setSort("distance"); }} style={{ flex: 1 }} />
          <Button title={res.data ? `Show ${data.length} players` : "Show players"} onPress={() => filters.current?.dismiss()} style={{ flex: 2 }} />
        </View>
      </FilterBottomSheet>
      <FilterBottomSheet ref={invite} title={focus ? `Invite ${focus.user.full_name}` : ""} snap={pickMatch ? ["78%"] : ["40%"]}>
        {!pickMatch ? (
          <>
            <Button title="Invite to my team" icon={<UserPlus size={16} color={T.onPrimary} strokeWidth={ICON.stroke} />} loading={toTeam.isPending} onPress={() => focus && toTeam.mutate(focus)} />
            <Button title="Invite to one of my matches" variant="secondary" onPress={() => setPickMatch(true)} />
            <Txt v="small" color={T.muted}>They'll get a notification and can accept or decline.</Txt>
          </>
        ) : focus ? (
          <InviteToMatch player={focus} onSent={() => mark(focus.user.id, "sent")} onDone={() => { setPickMatch(false); invite.current?.dismiss(); }} onBack={() => setPickMatch(false)} />
        ) : undefined}
      </FilterBottomSheet>
      <FilterBottomSheet ref={locSheet} title="Search near" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </View>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return <View style={{ gap: 8 }}><Txt v="label" color={T.muted}>{label}</Txt><View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{children}</View></View>;
}
