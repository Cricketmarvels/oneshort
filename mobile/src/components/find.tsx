/**
 * The two core GoFindr journeys: Find players and Find teams. Search field, location selector,
 * horizontal filter chips (sheet with Clear/Apply + selected count), compact player rows in a
 * white list; team cards with vacancies and one primary action.
 * Used full-screen (/find/players, /find/teams) and inside the Discover tab.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { SlidersHorizontal, UserPlus, Users } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { ShieldCrest } from "@/components/identity";
import { LocationOptions } from "@/components/cricket";
import { ContextLine } from "@/components/layout";
import { FilterBottomSheet } from "@/components/sheet";
import { Avatar, Badge, Button, Chip, EmptyState, ErrorBox, Field, InlineNotice, LoadingSkeleton, SearchBar, Txt } from "@/components/ui";
import { WHATSAPP_STATUS } from "@/components/invites";
import { api, errorText } from "@/lib/api";
import { FORMATS, rating, roleLabel, when } from "@/lib/format";
import { useHome } from "@/lib/hooks";
import { type Radius, useLocation } from "@/lib/location";
import { PillAction, RadiusSelector } from "@/components/refined";
import type { DiscoverTeam, FixtureFormat } from "@/lib/types";
import { ICON, R, SP, T } from "@/theme";

type Nearby = S<"NearbyPlayerOut">;
const ROLES = [{ v: "", l: "All" }, { v: "batsman", l: "Batters" }, { v: "bowler", l: "Bowlers" }, { v: "all_rounder", l: "All-rounders" }, { v: "wicketkeeper", l: "Keepers" }] as const;
const MIN_RATING = [{ v: "", l: "Any rating" }, { v: "1400", l: "1400+" }, { v: "1500", l: "1500+" }, { v: "1600", l: "1600+" }] as const;
const BANDS = [{ v: "", l: "Any rating" }, { v: "0-1450", l: "Up to 1450" }, { v: "1450-1650", l: "1450–1650" }, { v: "1650-4000", l: "1650+" }] as const;
const NUM = { fontVariant: ["tabular-nums" as const] };

/** Location + distance as one context line that opens the sheet: "Noida (centre) · 10 km ⌄". */
export function SearchArea({ onLocation }: { onLocation: () => void; tone?: "lime" | "brand" }) {
  const { label, radius } = useLocation();
  return <ContextLine text={`${label} · ${radius} km`} onPress={onLocation} />;
}

function Chips({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 8 }}>
      {children}
    </ScrollView>
  );
}

function CountLine({ text }: { text: string }) {
  return <Txt v="small" color={T.muted}>{text}</Txt>;
}

function FilterChip({ count, onPress }: { count: number; onPress: () => void }) {
  return <Chip label="Filters" active={count > 0} count={count} icon={<SlidersHorizontal size={14} color={count ? T.primaryDark : T.ink} strokeWidth={2} />} onPress={onPress} />;
}

function SheetActions({ onClear, onApply, title }: { onClear: () => void; onApply: () => void; title: string }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, paddingTop: 4 }}>
      <Button title="Clear" variant="secondary" onPress={onClear} style={{ flex: 1 }} />
      <Button title={title} onPress={onApply} style={{ flex: 2 }} />
    </View>
  );
}

function SheetGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <Txt v="label" color={T.muted}>{label}</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{children}</View>
    </View>
  );
}


/** Pick one of my upcoming recruiting matches, add a note, send the invitation (in-app card + WhatsApp if the player opted in). */
export function InviteToMatch({ player, onDone, onBack, onSent }: { player: { user: { id: string; full_name: string } }; onDone: () => void; onBack: () => void; onSent?: () => void }) {
  const qc = useQueryClient();
  const mine = useQuery({ queryKey: ["my-matches", "captain"], queryFn: () => api<{ data: S<"MatchOut">[] }>("/matches", { query: { role: "captain", when: "upcoming" } }) });
  const [matchId, setMatchId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; wa?: string | null } | null>(null);
  const list = (mine.data?.data ?? []).filter((m) => ["published", "recruiting", "squad_confirmed", "scheduled"].includes(m.match_status));
  const send = useMutation({
    mutationFn: () => api<S<"InvitationResultItem">[]>(`/matches/${matchId}/invitations`, { method: "POST", body: { invites: [{ player_id: player.user.id }], message: note.trim() || null } }),
    onSuccess: (r) => {
      const it = r[0];
      void qc.invalidateQueries({ queryKey: ["invitations"] });
      if (!it?.ok) return setResult({ ok: false, text: it?.message ?? "Try another match." });
      setResult({ ok: true, text: `${player.user.full_name} will see an invitation card on their dashboard.`, wa: it.whatsapp_status });
      onSent?.();
    },
    onError: (e) => setResult({ ok: false, text: errorText(e) }),
  });
  if (result?.ok) {
    return (
      <View style={{ gap: SP.md }}>
        <View style={{ alignItems: "center", gap: 8, padding: SP.lg, borderRadius: R.card, backgroundColor: T.successBackground }}>
          <Txt v="h2" color={T.successText}>Invitation sent</Txt>
          <Txt v="body" color={T.successText} style={{ textAlign: "center" }}>{result.text}</Txt>
        </View>
        <InlineNotice tone={result.wa === "sent" ? "info" : "warning"}>{WHATSAPP_STATUS[result.wa ?? ""] ?? "In-app invitation sent."}</InlineNotice>
        <Button title="Done" onPress={() => { setResult(null); onDone(); }} />
      </View>
    );
  }
  return (
    <View style={{ gap: SP.md }}>
      <Txt v="label" color={T.muted}>Choose a match</Txt>
      {mine.isPending ? <LoadingSkeleton rows={2} /> : !list.length ? (
        <EmptyState title="No upcoming matches" body="Create a match first, then invite players to it." action="Create a match" onAction={() => { onDone(); router.push("/match/new"); }} />
      ) : (
        <View style={{ gap: 8 }}>
          {list.map((m) => {
            const on = matchId === m.id;
            const open = m.composition.capacity - m.composition.confirmed_total;
            return (
              <Pressable key={m.id} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={m.title} onPress={() => { setMatchId(m.id); setResult(null); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 12, borderRadius: R.lg, borderWidth: on ? 2 : 1, borderColor: on ? T.primary : T.line, backgroundColor: on ? T.tint : T.surface }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="h3" numberOfLines={1}>{m.title}</Txt>
                  <Txt v="small" color={T.muted} numberOfLines={1}>{when(m.start_at, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · {m.venue.name ?? m.venue.area}</Txt>
                </View>
                <Badge status={open > 0 ? "success" : "neutral"} label={open > 0 ? `${open} open` : "Full"} />
              </Pressable>
            );
          })}
        </View>
      )}
      {result && !result.ok ? <View style={{ padding: 12, borderRadius: R.lg, backgroundColor: T.dangerBackground }} accessibilityRole="alert"><Txt v="smallSemi" color={T.dangerText}>Couldn't invite: {result.text}</Txt></View> : null}
      {list.length ? <Field label="Note for the player (optional)" value={note} onChangeText={setNote} placeholder="e.g. We need an opening bowler" maxLength={200} /> : null}
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Button title="Back" variant="secondary" onPress={onBack} style={{ flex: 1 }} />
        <Button title="Send invitation" disabled={!matchId} loading={send.isPending} onPress={() => send.mutate()} style={{ flex: 2 }} />
      </View>
      <Txt v="small" color={T.muted}>They get an invitation card on their dashboard, plus a WhatsApp message with the details if they've switched on WhatsApp updates.</Txt>
    </View>
  );
}

// ---------------------------------------------------------------- players
export function FindPlayers() {
  const { lat, lng, radius, setRadius } = useLocation();
  const home = useHome();
  const myTeam = home.data?.managed_team_ids[0];
  const [q, setQ] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]["v"]>("");
  const [minRating, setMinRating] = useState<(typeof MIN_RATING)[number]["v"]>("");
  const [available, setAvailable] = useState(false);
  const [sort, setSort] = useState<"distance" | "rating">("distance");
  const [focus, setFocus] = useState<Nearby | null>(null);
  const filters = useRef<BottomSheetModal>(null);
  const locSheet = useRef<BottomSheetModal>(null);
  const invite = useRef<BottomSheetModal>(null);
  const [pickMatch, setPickMatch] = useState(false);
  const res = useQuery({
    queryKey: ["nearby-players", lat, lng, radius, q, role, minRating, available, sort],
    queryFn: () => api<Nearby[]>("/players/nearby", { query: { lat, lng, radius_km: radius, q: q || undefined, role: role || undefined, min_rating: minRating || undefined, available: available || undefined, sort } }),
  });
  const toTeam = useMutation({
    mutationFn: (uid: string) => api(`/teams/${myTeam}/members`, { method: "POST", body: { user_id: uid } }),
    onSuccess: () => { invite.current?.dismiss(); Alert.alert("Invitation sent", `${focus?.user.full_name} has been invited to your team.`); },
    onError: (e) => Alert.alert("Couldn't invite", errorText(e)),
  });
  const active = (minRating ? 1 : 0) + (sort !== "distance" ? 1 : 0);
  const n = res.data?.length ?? 0;
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: SP.md }}>
        <SearchBar value={q} onChange={setQ} placeholder="Search by name or role" />
        <SearchArea onLocation={() => locSheet.current?.present()} />
        <RadiusSelector value={radius} options={["5", "10", "20"] as Radius[]} onChange={setRadius} />
        <Chips>
          <Chip label="All roles" active={!role} onPress={() => setRole("")} />
          <Chip label="Available" active={available} onPress={() => setAvailable(!available)} />
          <FilterChip count={active + (role ? 1 : 0)} onPress={() => filters.current?.present()} />
        </Chips>
      </View>
      {res.data ? <CountLine text={`${n} player${n === 1 ? "" : "s"} within ${radius} km · ${sort === "rating" ? "top rated first" : "nearest first"}`} /> : null}
      {res.isPending ? <LoadingSkeleton rows={5} /> : res.isError ? <ErrorBox error={res.error} onRetry={() => void res.refetch()} /> : !n ? (
        <EmptyState icon={<Users size={22} color={T.primaryDark} strokeWidth={ICON.stroke} />} title="No players found" body={`Try widening your search radius${active ? " or clearing filters" : ""}.`} action="Change distance" onAction={() => locSheet.current?.present()} />
      ) : (
        <View style={{ gap: 12 }}>
          {res.data.map((p) => (
            <Pressable key={p.user.id} accessibilityRole="button" accessibilityLabel={`${p.user.full_name}, ${roleLabel(p.primary_role)}, about ${p.distance_km} kilometres away`}
              onPress={() => router.push({ pathname: "/player/[id]", params: { id: p.user.id } })}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 13, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface })}>
              <Avatar name={p.user.full_name} uri={p.user.profile_image} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Txt v="h3" numberOfLines={1}>{p.user.full_name}{p.rating && p.verified_matches ? <Txt v="small" color={T.muted}>{"  "}{rating(p.rating.rating)}</Txt> : null}</Txt>
                <Txt v="small" color={T.muted} style={{ marginTop: 5, fontSize: 14 }} numberOfLines={1}>{roleLabel(p.primary_role)} · {p.verified_matches ? `${p.verified_matches} verified match${p.verified_matches === 1 ? "" : "es"}` : "New player"}</Txt>
                <Txt v="small" color={T.primary} style={{ marginTop: 5, fontSize: 12 }} numberOfLines={1}>~{p.distance_km} km{p.locality ? ` · ${p.locality}` : ""}{p.available_this_week ? " · Available this week" : ""}</Txt>
              </View>
              <View style={{ alignItems: "flex-end", gap: 8 }}>
                <Txt v="h3" color={T.primary} style={{ fontSize: 14 }}>View →</Txt>
                {myTeam ? <PillAction label="INVITE" active onPress={() => { setFocus(p); setPickMatch(false); invite.current?.present(); }} /> : null}
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <FilterBottomSheet ref={filters} title="Filter players" snap={["70%"]}>
        <SheetGroup label="Role">{ROLES.map((r) => <Chip key={r.v} label={r.l} active={role === r.v} onPress={() => setRole(r.v)} />)}</SheetGroup>
        <SheetGroup label="Player rating">{MIN_RATING.map((r) => <Chip key={r.v} label={r.l} active={minRating === r.v} onPress={() => setMinRating(r.v)} />)}</SheetGroup>
        <SheetGroup label="Availability">
          <Chip label="Anyone" active={!available} onPress={() => setAvailable(false)} />
          <Chip label="Available this week" active={available} onPress={() => setAvailable(true)} />
        </SheetGroup>
        <SheetGroup label="Sort by">
          <Chip label="Nearest" active={sort === "distance"} onPress={() => setSort("distance")} />
          <Chip label="Top rated" active={sort === "rating"} onPress={() => setSort("rating")} />
        </SheetGroup>
        <SheetActions title={res.data ? `Show ${n} players` : "Show players"} onClear={() => { setRole(""); setMinRating(""); setAvailable(false); setSort("distance"); }} onApply={() => filters.current?.dismiss()} />
      </FilterBottomSheet>
      <FilterBottomSheet ref={invite} title={focus ? `Invite ${focus.user.full_name}` : ""} snap={pickMatch ? ["78%"] : ["40%"]}>
        {!pickMatch ? (
          <>
            <Button title="Invite to my team" icon={<UserPlus size={16} color={T.onPrimary} strokeWidth={ICON.stroke} />} loading={toTeam.isPending} onPress={() => focus && toTeam.mutate(focus.user.id)} />
            <Button title="Invite to one of my matches" variant="secondary" onPress={() => setPickMatch(true)} />
            <Txt v="small" color={T.muted}>They'll get a notification and can accept or decline.</Txt>
          </>
        ) : focus ? <InviteToMatch player={focus} onDone={() => { setPickMatch(false); invite.current?.dismiss(); }} onBack={() => setPickMatch(false)} /> : null}
      </FilterBottomSheet>
      <FilterBottomSheet ref={locSheet} title="Search near" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </View>
  );
}

// ---------------------------------------------------------------- teams
export function FindTeams() {
  const { lat, lng, radius, setRadius } = useLocation();
  const home = useHome();
  const myTeam = home.data?.managed_team_ids[0];
  const [q, setQ] = useState("");
  const [recruiting, setRecruiting] = useState(false);
  const [band, setBand] = useState<(typeof BANDS)[number]["v"]>("");
  const [fmt, setFmt] = useState<FixtureFormat | "">("");
  const filters = useRef<BottomSheetModal>(null);
  const locSheet = useRef<BottomSheetModal>(null);
  const [lo, hi] = band ? band.split("-") : [undefined, undefined];
  const res = useQuery({
    queryKey: ["find-teams", lat, lng, radius, q, recruiting, band, fmt, myTeam],
    queryFn: () => api<DiscoverTeam[]>("/teams/discover", { query: {
      lat, lng, radius_km: radius, purpose: "join", recruiting: recruiting || undefined, q: q || undefined,
      min_rating: lo && lo !== "0" ? lo : undefined, max_rating: hi && hi !== "4000" ? hi : undefined, format: fmt || undefined, from_team_id: myTeam,
    } }),
  });
  const join = useMutation({
    mutationFn: (t: DiscoverTeam) => api(`/teams/${t.team.id}/join-requests`, { method: "POST" }),
    onSuccess: (_d, t) => { void res.refetch(); Alert.alert("Request sent", `${t.team.team_name}'s captain will review it.`); },
    onError: (e) => Alert.alert("Couldn't send request", errorText(e)),
  });
  const active = (band ? 1 : 0) + (fmt ? 1 : 0);
  const n = res.data?.length ?? 0;
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: SP.md }}>
        <SearchBar value={q} onChange={setQ} placeholder="Team name or playing area" />
        <SearchArea onLocation={() => locSheet.current?.present()} />
        <RadiusSelector value={radius} options={["5", "10", "20"] as Radius[]} onChange={setRadius} />
        <Chips>
          <Chip label="Nearby" active={!recruiting} onPress={() => setRecruiting(false)} />
          <Chip label="Looking for players" active={recruiting} onPress={() => setRecruiting(true)} />
          <FilterChip count={active} onPress={() => filters.current?.present()} />
        </Chips>
      </View>
      {res.data ? <CountLine text={`${n} team${n === 1 ? "" : "s"} within ${radius} km · nearest first`} /> : null}
      {res.isPending ? <LoadingSkeleton rows={4} /> : res.isError ? <ErrorBox error={res.error} onRetry={() => void res.refetch()} /> : !n ? (
        <EmptyState icon={<Users size={22} color={T.primaryDark} strokeWidth={ICON.stroke} />} title={recruiting ? "No teams need players right now" : "No teams found"} body="Explore teams in nearby areas by widening your radius." action="Change distance" onAction={() => locSheet.current?.present()} />
      ) : (
        <View style={{ gap: 10 }}>
          {res.data.map((t) => {
            const mine = !!t.my_membership && !["invited", "requested"].includes(t.my_membership);
            const status = mine ? "Your team" : t.my_membership === "requested" ? "Request sent" : t.my_membership === "invited" ? "You're invited" : null;
            const open = () => router.push({ pathname: "/team/[id]", params: { id: t.team.id } });
            const roles = Object.entries(t.open_roles ?? {});
            const lead = roles.length ? roles.map(([r, k]) => `${k} ${roleLabel(r).toLowerCase()}${k === 1 ? "" : "s"}`).join(", ") + " needed"
              : t.open_spots ? `${t.open_spots} spot${t.open_spots === 1 ? "" : "s"} open` : `${t.member_count} players · not recruiting`;
            const next = t.next_open_match_at ? `${when(t.next_open_match_at, { weekday: "short", hour: "numeric", minute: "2-digit" })}${t.next_open_match_format ? ` · ${t.next_open_match_format === "OTHER" ? "Practice" : t.next_open_match_format}` : ""}` : null;
            return (
              <Pressable key={t.team.id} accessibilityRole="button" accessibilityLabel={`${t.team.team_name}. ${lead}. About ${t.distance_km} kilometres away`} onPress={open}
                style={({ pressed }) => ({ gap: 12, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface })}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                  <Avatar name={t.team.team_name} size={48} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Txt v="h3" numberOfLines={1} style={{ fontSize: 17 }}>{t.team.team_name}</Txt>
                    <Txt v="small" color={T.muted} style={{ marginTop: 5, fontSize: 14 }} numberOfLines={1}>{[next, t.team.area ?? t.team.city].filter(Boolean).join(" · ") || `${t.member_count} players`}</Txt>
                    <Txt v="small" color={T.primary} style={{ marginTop: 5, fontSize: 12 }} numberOfLines={2}>~{t.distance_km} km · {status ?? lead}</Txt>
                  </View>
                  <Txt v="h3" color={T.primary}>→</Txt>
                </View>
                {!t.my_membership && t.open_spots ? (
                  <Button title={join.isPending && join.variables?.team.id === t.team.id ? "Sending…" : "Request to join"} size="sm" onPress={() => join.mutate(t)} />
                ) : myTeam && !mine && myTeam !== t.team.id ? (
                  <Button title="Challenge" size="sm" variant="highlight" onPress={() => router.push({ pathname: "/challenge/new", params: { from: myTeam, to: t.team.id } })} />
                ) : null}
              </Pressable>
            );
          })}
          <Pressable accessibilityRole="button" accessibilityLabel="Create a player request: add when you're free so captains can invite you" onPress={() => router.push("/availability")}
            style={({ pressed }) => ({ padding: 16, gap: 4, borderRadius: R.card, borderWidth: 1, borderStyle: "dashed", borderColor: T.primary, backgroundColor: pressed ? T.primarySoft : T.surface })}>
            <Txt v="h3" color={T.primaryDark}>Create a player request</Txt>
            <Txt v="small" color={T.muted}>Add when you're free — captains searching for players at that time will find you.</Txt>
          </Pressable>
        </View>
      )}
      <FilterBottomSheet ref={filters} title="Filter teams" snap={["55%"]}>
        <SheetGroup label="Team rating">{BANDS.map((b) => <Chip key={b.v} label={b.l} active={band === b.v} onPress={() => setBand(b.v)} />)}</SheetGroup>
        <SheetGroup label="Format they play">
          <Chip label="Any" active={!fmt} onPress={() => setFmt("")} />
          {FORMATS.map((f) => <Chip key={f.v} label={f.l} active={fmt === f.v} onPress={() => setFmt(f.v)} />)}
        </SheetGroup>
        <SheetActions title={res.data ? `Show ${n} teams` : "Show teams"} onClear={() => { setBand(""); setFmt(""); }} onApply={() => filters.current?.dismiss()} />
      </FilterBottomSheet>
      <FilterBottomSheet ref={locSheet} title="Search near" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </View>
  );
}
