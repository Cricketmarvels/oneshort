/**
 * Badminton & Pickleball features (shared, parameterised by sport): home, find a player,
 * play requests and find a court. Data: /racket/* (sport-isolated; distances only, never coordinates).
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { CalendarCheck, ChevronRight, Clock, Inbox, LandPlot, MapPin, MapPinned, Send, SlidersHorizontal, Star, UserRoundSearch, Users } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";

import { LocationOptions } from "@/components/cricket";
import { ContextLine, HeroScreen } from "@/components/layout";
import { FilterBottomSheet } from "@/components/sheet";
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorBox, Field, InlineNotice, LoadingSkeleton, Section, SearchBar, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { when } from "@/lib/format";
import { RADII, useLocation } from "@/lib/location";
import { type RacketSport, SPORTS } from "@/lib/sports";
import { R, shadow, SP, T } from "@/theme";

export type Profile = S<"RacketProfileOut">;
export type Nearby = S<"NearbyRacketPlayerOut">;
export type PlayRequest = S<"PlayRequestOut">;
export type Court = S<"CourtOut">;

export const LEVELS = [{ v: "beginner", l: "Beginner" }, { v: "intermediate", l: "Intermediate" }, { v: "advanced", l: "Advanced" }, { v: "professional", l: "Professional" }] as const;
export const TIMES = [{ v: "morning", l: "Morning" }, { v: "afternoon", l: "Afternoon" }, { v: "evening", l: "Evening" }, { v: "night", l: "Night" }] as const;
export const AVAIL = [{ v: "today", l: "Available today" }, { v: "weekdays", l: "Weekdays" }, { v: "weekends", l: "Weekends" }] as const;
export const FORMATS = [{ v: "singles", l: "Singles" }, { v: "doubles", l: "Doubles" }, { v: "mixed", l: "Mixed doubles" }] as const;
export const GENDERS = [{ v: "female", l: "Women" }, { v: "male", l: "Men" }] as const;
const label = <T extends { v: string; l: string }>(list: readonly T[], v: string) => list.find((x) => x.v === v)?.l ?? v;

export function useRacketProfile(sport: RacketSport) {
  return useQuery({ queryKey: ["racket", sport, "profile"], queryFn: () => api<Profile | null>(`/racket/${sport}/profile/me`) });
}

/** Nudge shown until the user has a profile for this sport (they're invisible to others until then). */
function ProfilePrompt({ sport }: { sport: RacketSport }) {
  return (
    <Card onPress={() => router.push({ pathname: "/racket/profile", params: { sport } })} label={`Set up your ${SPORTS[sport].name} profile`} style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: T.tint, borderColor: "#C9EAE1" }}>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt v="h3">Set up your {SPORTS[sport].name} profile</Txt>
        <Txt v="small" color={T.muted}>Add your level and when you play so nearby players can find you.</Txt>
      </View>
      <ChevronRight size={20} color={T.primaryDark} strokeWidth={2.2} />
    </Card>
  );
}

function Tile({ icon: Icon, title, hint, onPress }: { icon: typeof Users; title: string; hint: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${hint}`} onPress={onPress}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, padding: 16, borderRadius: R.card, backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: T.line }, TILE_SHADOW]}>
      <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: T.tint, alignItems: "center", justifyContent: "center" }}><Icon size={24} color={T.primary} strokeWidth={2.1} /></View>
      <View style={{ flex: 1, gap: 2 }}><Txt v="h3" style={{ fontSize: 16 }}>{title}</Txt><Txt v="small" color={T.muted}>{hint}</Txt></View>
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.surface2, alignItems: "center", justifyContent: "center" }}><ChevronRight size={16} color={T.ink} strokeWidth={2.2} /></View>
    </Pressable>
  );
}
const TILE_SHADOW = { shadowColor: "#172B2B", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2 } as const;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

// ---------------------------------------------------------------- home
export function RacketHome({ sport }: { sport: RacketSport }) {
  const { user } = useAuth();
  const { lat, lng, label: place, radius } = useLocation();
  const locSheet = useRef<BottomSheetModal>(null);
  const profile = useRacketProfile(sport);
  const nearby = useQuery({ queryKey: ["racket", sport, "nearby", lat, lng, radius, "count"], queryFn: () => api<Nearby[]>(`/racket/${sport}/players/nearby`, { query: { lat, lng, radius_km: radius } }) });
  const courts = useQuery({ queryKey: ["racket", sport, "courts", lat, lng, "count"], queryFn: () => api<Court[]>(`/racket/${sport}/courts`, { query: { lat, lng, radius_km: 20 } }) });
  const pending = useQuery({ queryKey: ["racket", "requests", sport, "received-pending"], queryFn: () => api<PlayRequest[]>("/racket/requests", { query: { sport, box: "received", status: "pending" } }) });
  const refresh = () => { for (const q of [profile, nearby, courts, pending]) void q.refetch(); };
  return (
    <>
      <HeroScreen title={`${greeting()}, ${user?.full_name.split(" ")[0] ?? ""}`} kicker={`Ready for some ${SPORTS[sport].name.toLowerCase()}?`} subtitle={`${place} · ${radius} km`} onSubtitle={() => locSheet.current?.present()}
        refreshing={profile.isRefetching} onRefresh={refresh}>
        {profile.data === null ? <ProfilePrompt sport={sport} /> : null}
        <View style={{ gap: 12 }}>
          <Tile icon={UserRoundSearch} title="Find a Player" hint={nearby.data ? `${nearby.data.length} ${SPORTS[sport].name.toLowerCase()} players within ${radius} km` : "Players near you"} onPress={() => router.push("/players")} />
          <Tile icon={LandPlot} title="Find a Court" hint={courts.data ? `${courts.data.length} courts within 20 km` : "Courts near you"} onPress={() => router.push("/courts")} />
          <Tile icon={CalendarCheck} title="Book a Court" hint="Pick a court, then contact the venue" onPress={() => router.push({ pathname: "/courts", params: { book: "1" } })} />
        </View>
        {pending.data?.length ? (
          <Section title="Play requests for you" action="See all" onAction={() => router.push("/requests")}>
            <View style={{ gap: 10 }}>{pending.data.slice(0, 2).map((r) => <RequestCard key={r.id} r={r} />)}</View>
          </Section>
        ) : null}
      </HeroScreen>
      <FilterBottomSheet ref={locSheet} title="Where do you play?" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </>
  );
}

// ---------------------------------------------------------------- find a player
export function FindRacketPlayers({ sport }: { sport: RacketSport }) {
  const { lat, lng, label: place, radius } = useLocation();
  const qc = useQueryClient();
  const profile = useRacketProfile(sport);
  const [q, setQ] = useState("");
  const [level, setLevel] = useState<string>("");
  const [time, setTime] = useState<string>("");
  const [avail, setAvail] = useState<string>("");
  const [format, setFormat] = useState<string>("");
  const [gender, setGender] = useState<string>("");
  const filters = useRef<BottomSheetModal>(null);
  const locSheet = useRef<BottomSheetModal>(null);
  const active = [time, avail, format, gender].filter(Boolean).length;
  const res = useQuery({
    queryKey: ["racket", sport, "nearby", lat, lng, radius, q, level, time, avail, format, gender],
    queryFn: () => api<Nearby[]>(`/racket/${sport}/players/nearby`, { query: { lat, lng, radius_km: radius, q: q || undefined, level: level || undefined, time: time || undefined, availability: avail || undefined, format: format || undefined, gender: gender || undefined } }),
  });
  const send = useMutation({
    mutationFn: (p: Nearby) => api<PlayRequest>(`/racket/${sport}/requests`, { method: "POST", body: { to_user_id: p.user.id } }),
    onSuccess: (_r, p) => { void qc.invalidateQueries({ queryKey: ["racket"] }); Alert.alert("Play request sent", `${p.user.full_name} will be notified and can accept or decline.`); },
    onError: (e) => Alert.alert("Couldn't send request", errorText(e)),
  });
  const n = res.data?.length ?? 0;
  return (
    <View style={{ gap: SP.lg }}>
      {profile.data === null ? <ProfilePrompt sport={sport} /> : null}
      <SearchBar value={q} onChange={setQ} placeholder={`Search ${SPORTS[sport].name.toLowerCase()} players…`} />
      <View style={{ gap: SP.md }}>
        <ContextLine text={`${place} · ${radius} km`} onPress={() => locSheet.current?.present()} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 8 }}>
          <Chip label="Filters" active={active > 0} count={active} icon={<SlidersHorizontal size={14} color={active ? T.primaryDark : T.ink} strokeWidth={2} />} onPress={() => filters.current?.present()} />
          <Chip label="All levels" active={!level} onPress={() => setLevel("")} />
          {LEVELS.map((l) => <Chip key={l.v} label={l.l} active={level === l.v} onPress={() => setLevel(l.v)} />)}
        </ScrollView>
      </View>
      {res.data ? <Txt v="small" color={T.muted}>{n} {SPORTS[sport].name.toLowerCase()} player{n === 1 ? "" : "s"} within {radius} km · nearest first</Txt> : null}
      {res.isPending ? <LoadingSkeleton rows={4} /> : res.isError ? <ErrorBox error={res.error} onRetry={() => void res.refetch()} /> : !n ? (
        <EmptyState icon={<Users size={22} color={T.primaryDark} strokeWidth={2} />} title="No players found" body="Try widening your search radius or clearing filters." action="Change distance" onAction={() => locSheet.current?.present()} />
      ) : (
        <View style={{ gap: 12 }}>{res.data.map((p) => <PlayerCard key={p.user.id} p={p} sport={sport} sending={send.isPending && send.variables?.user.id === p.user.id} onSend={() => send.mutate(p)} />)}</View>
      )}
      <FilterBottomSheet ref={filters} title="Filter players" snap={["70%"]}>
        {([["Preferred time", TIMES, time, setTime], ["Availability", AVAIL, avail, setAvail], ["Format", FORMATS, format, setFormat], ["Gender (optional)", GENDERS, gender, setGender]] as const).map(([t, list, v, set]) => (
          <View key={t} style={{ gap: 8 }}>
            <Txt v="label" color={T.muted}>{t}</Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Chip label="Any" active={!v} onPress={() => set("")} />
              {list.map((o) => <Chip key={o.v} label={o.l} active={v === o.v} onPress={() => set(o.v)} />)}
            </View>
          </View>
        ))}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title="Clear" variant="secondary" onPress={() => { setTime(""); setAvail(""); setFormat(""); setGender(""); }} style={{ flex: 1 }} />
          <Button title={res.data ? `Show ${n} players` : "Show players"} onPress={() => filters.current?.dismiss()} style={{ flex: 2 }} />
        </View>
      </FilterBottomSheet>
      <FilterBottomSheet ref={locSheet} title="Search near" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </View>
  );
}

export function PlayerCard({ p, sport, onSend, sending }: { p: Nearby; sport: RacketSport; onSend: () => void; sending?: boolean }) {
  const st = p.request_status;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${p.user.full_name}, ${label(LEVELS, p.level)}, about ${p.distance_km} kilometres away`}
      onPress={() => router.push({ pathname: "/racket/player/[id]", params: { id: p.user.id, sport } })}
      style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 14, padding: 14, borderRadius: R.card, backgroundColor: pressed ? T.surface2 : T.surface }, shadow(2)]}>
      <Avatar name={p.user.full_name} uri={p.user.profile_image} size={60} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Txt v="h3" numberOfLines={1} style={{ fontSize: 16 }}>{p.user.full_name}</Txt>
        <Txt v="small" color={T.muted} numberOfLines={1}>{label(LEVELS, p.level)} • {p.distance_km} km{p.locality ? ` • ${p.locality}` : ""}</Txt>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><Star size={13} color="#E2B93B" fill="#E2B93B" strokeWidth={1.5} /><Txt v="smallSemi">{p.rating != null ? p.rating.toFixed(1) : "New"}</Txt></View>
          {p.available_today ? <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: T.successText }} /><Txt v="small" color={T.successText}>Available today</Txt></View> : null}
          <Txt v="small" color={T.faint}>{p.matches_played} played</Txt>
        </View>
      </View>
      {st === "pending" ? <Badge status="warning" label="Requested" /> : st === "accepted" ? <Badge status="success" label="Connected" /> : (
        <Pressable accessibilityRole="button" accessibilityLabel={`Send ${p.user.full_name} a play request`} onPress={onSend} hitSlop={6}
          style={({ pressed }) => ({ height: 34, paddingHorizontal: 14, borderRadius: R.pill, backgroundColor: pressed ? T.primarySoft : T.tint, alignItems: "center", justifyContent: "center" })}>
          <Txt v="smallSemi" color={T.primaryDark}>{sending ? "Sending…" : "Play"}</Txt>
        </Pressable>
      )}
    </Pressable>
  );
}

// ---------------------------------------------------------------- requests
export function RequestCard({ r }: { r: PlayRequest }) {
  const qc = useQueryClient();
  const act = useMutation({
    mutationFn: (a: "accept" | "reject" | "cancel") => api<PlayRequest>(`/racket/requests/${r.id}/${a}`, { method: "POST" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["racket"] }),
    onError: (e) => Alert.alert("Couldn't update request", errorText(e)),
  });
  const tone = r.status === "accepted" ? "success" : r.status === "pending" ? "warning" : "neutral";
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar name={r.other.full_name} uri={r.other.profile_image} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="h3">{r.direction === "received" ? `${r.other.full_name} wants to play` : `You asked ${r.other.full_name}`}</Txt>
          <Txt v="small" color={T.muted}>{SPORTS[r.sport].name}{r.proposed_at ? ` · ${when(r.proposed_at)}` : ""}{r.court ? ` · ${r.court.name}` : ""} · {when(r.created_at, { day: "numeric", month: "short" })}</Txt>
        </View>
        <Badge status={tone} label={r.status.charAt(0).toUpperCase() + r.status.slice(1)} />
      </View>
      {r.message ? <Txt v="body" color={T.muted}>“{r.message}”</Txt> : null}
      {r.status === "pending" && r.direction === "received" ? (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button title="Decline" variant="outline" size="sm" loading={act.isPending && act.variables === "reject"} onPress={() => act.mutate("reject")} style={{ flex: 1 }} />
          <Button title="Accept" variant="highlight" size="sm" loading={act.isPending && act.variables === "accept"} onPress={() => act.mutate("accept")} style={{ flex: 1 }} />
        </View>
      ) : r.status === "pending" ? (
        <Button title="Cancel request" variant="ghost" size="sm" onPress={() => act.mutate("cancel")} />
      ) : r.status === "accepted" ? (
        <Txt v="small" color={T.successText}>Connected — agree the time and court together. OneShort doesn't share phone numbers.</Txt>
      ) : null}
    </Card>
  );
}

export function RacketRequests({ sport }: { sport: RacketSport }) {
  const [box, setBox] = useState<"received" | "sent">("received");
  const q = useQuery({ queryKey: ["racket", "requests", sport, box], queryFn: () => api<PlayRequest[]>("/racket/requests", { query: { sport, box } }) });
  return (
    <View style={{ gap: SP.lg }}>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Chip label="Received" active={box === "received"} onPress={() => setBox("received")} />
        <Chip label="Sent" active={box === "sent"} onPress={() => setBox("sent")} />
      </View>
      {q.isPending ? <LoadingSkeleton rows={3} /> : q.isError ? <ErrorBox error={q.error} onRetry={() => void q.refetch()} /> : !q.data.length ? (
        <EmptyState icon={<Inbox size={22} color={T.primaryDark} strokeWidth={2} />} title={box === "received" ? "No play requests yet" : "You haven't sent any requests"} body="Find a player nearby and send a play request." action="Find a player" onAction={() => router.push("/players")} />
      ) : <View style={{ gap: 10 }}>{q.data.map((r) => <RequestCard key={r.id} r={r} />)}</View>}
    </View>
  );
}

// ---------------------------------------------------------------- courts
export function FindCourts({ sport, booking }: { sport: RacketSport; booking?: boolean }) {
  const { lat, lng, label: place } = useLocation();
  const [q, setQ] = useState("");
  const [indoor, setIndoor] = useState<"" | "true" | "false">("");
  const [radius, setRadius] = useState("20");
  const [focus, setFocus] = useState<Court | null>(null);
  const sheet = useRef<BottomSheetModal>(null);
  const locSheet = useRef<BottomSheetModal>(null);
  const res = useQuery({ queryKey: ["racket", sport, "courts", lat, lng, radius, q, indoor], queryFn: () => api<Court[]>(`/racket/${sport}/courts`, { query: { lat, lng, radius_km: radius, q: q || undefined, indoor: indoor || undefined } }) });
  const n = res.data?.length ?? 0;
  const maps = (c: Court) => void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${c.name}, ${c.address}`)}`);
  return (
    <View style={{ gap: SP.lg }}>
      {booking ? <InlineNotice>Pick a court to book. Online booking isn't live yet — you'll contact the venue directly to confirm a slot.</InlineNotice> : null}
      <SearchBar value={q} onChange={setQ} placeholder="Search courts by name or area" />
      <View style={{ gap: SP.md }}>
        <ContextLine text={`${place} · ${radius} km`} onPress={() => locSheet.current?.present()} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 8 }}>
          {RADII.map((r) => <Chip key={r} label={`${r} km`} active={radius === r} onPress={() => setRadius(r)} />)}
          <Chip label="Indoor" active={indoor === "true"} onPress={() => setIndoor(indoor === "true" ? "" : "true")} />
          <Chip label="Outdoor" active={indoor === "false"} onPress={() => setIndoor(indoor === "false" ? "" : "false")} />
        </ScrollView>
      </View>
      {res.data ? <Txt v="small" color={T.muted}>{n} {SPORTS[sport].name.toLowerCase()} court{n === 1 ? "" : "s"} · nearest first</Txt> : null}
      {res.isPending ? <LoadingSkeleton rows={3} /> : res.isError ? <ErrorBox error={res.error} onRetry={() => void res.refetch()} /> : !n ? (
        <EmptyState icon={<LandPlot size={22} color={T.primaryDark} strokeWidth={2} />} title="No courts found" body="Try a wider radius or another area." />
      ) : (
        <View style={{ gap: 12 }}>
          {res.data.map((c) => (
            <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.area}${c.distance_km != null ? `, about ${c.distance_km} kilometres` : ""}`} onPress={() => { setFocus(c); sheet.current?.present(); }}
              style={({ pressed }) => [{ flexDirection: "row", gap: 14, padding: 14, borderRadius: R.card, backgroundColor: pressed ? T.surface2 : T.surface }, shadow(2)]}>
              <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: T.tint, alignItems: "center", justifyContent: "center" }}><LandPlot size={28} color={T.primary} strokeWidth={1.9} /></View>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Txt v="h3" numberOfLines={1} style={{ fontSize: 16 }}>{c.name}</Txt>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}><MapPin size={13} color={T.muted} strokeWidth={2} /><Txt v="small" color={T.muted} numberOfLines={1}>{c.area}{c.distance_km != null ? ` · ~${c.distance_km} km` : ""}</Txt></View>
                <Txt v="small" color={T.muted}>{c.courts[sport] ?? 0} court{(c.courts[sport] ?? 0) === 1 ? "" : "s"} · {c.indoor ? "Indoor" : "Outdoor"}{c.amenities.length ? ` · ${c.amenities.slice(0, 2).join(", ")}` : ""}</Txt>
                {c.is_demo ? <View style={{ alignSelf: "flex-start", marginTop: 2 }}><Badge status="neutral" label="Sample listing" /></View> : null}
              </View>
              <ChevronRight size={18} color={T.muted} strokeWidth={2} style={{ alignSelf: "center" }} />
            </Pressable>
          ))}
        </View>
      )}
      <FilterBottomSheet ref={sheet} title={focus?.name ?? ""} snap={["62%"]}>
        {focus ? (
          <View style={{ gap: SP.md }}>
            <View style={{ gap: 4 }}>
              <Txt v="body">{focus.address}</Txt>
              <Txt v="small" color={T.muted}>{focus.area}, {focus.city}{focus.distance_km != null ? ` · ~${focus.distance_km} km away` : ""}</Txt>
              <Txt v="small" color={T.muted}>{focus.courts[sport] ?? 0} {SPORTS[sport].name.toLowerCase()} court{(focus.courts[sport] ?? 0) === 1 ? "" : "s"} · {focus.indoor ? "Indoor" : "Outdoor"}{focus.amenities.length ? ` · ${focus.amenities.join(", ")}` : ""}</Txt>
            </View>
            <InlineNotice>{focus.is_demo ? "Sample listing: details aren't verified with the venue. " : ""}Online booking isn't available yet — slots and prices aren't listed. Contact the venue to book.</InlineNotice>
            {focus.phone ? <Button title={`Call ${focus.phone}`} icon={<Clock size={17} color={T.onPrimary} strokeWidth={2} />} onPress={() => void Linking.openURL(`tel:${focus.phone}`)} /> : null}
            <Button title="Open in Maps" variant={focus.phone ? "secondary" : "primary"} icon={<MapPinned size={17} color={focus.phone ? T.ink : T.onPrimary} strokeWidth={2} />} onPress={() => maps(focus)} />
            <Button title="Find a partner to play here" variant="outline" icon={<Send size={16} color={T.ink} strokeWidth={2} />} onPress={() => { sheet.current?.dismiss(); router.push("/players"); }} />
          </View>
        ) : null}
      </FilterBottomSheet>
      <FilterBottomSheet ref={locSheet} title="Search near" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </View>
  );
}

// ---------------------------------------------------------------- profile form
export function RacketProfileForm({ sport, initial, onSaved }: { sport: RacketSport; initial: Profile | null; onSaved: () => void }) {
  const { lat, lng, label: place } = useLocation();
  const qc = useQueryClient();
  const [level, setLevel] = useState<string>(initial?.level ?? "");
  const [times, setTimes] = useState<string[]>(initial?.preferred_times ?? []);
  const [avail, setAvail] = useState<string[]>(initial?.availability ?? []);
  const [formats, setFormats] = useState<string[]>(initial?.formats ?? []);
  const [gender, setGender] = useState<string>(initial?.gender ?? "undisclosed");
  const [bio, setBio] = useState(initial?.bio ?? "");
  const [visible, setVisible] = useState(initial?.discoverable ?? true);
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  const save = useMutation({
    mutationFn: () => api<Profile>(`/racket/${sport}/profile/me`, { method: "PUT", body: { level, preferred_times: times, availability: avail, formats, gender, bio: bio.trim() || null, discoverable: visible, home_location: { lat, lng }, locality: place } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["racket"] }); onSaved(); },
    onError: (e) => Alert.alert("Couldn't save profile", errorText(e)),
  });
  const group = (t: string, list: readonly { v: string; l: string }[], sel: (v: string) => boolean, on: (v: string) => void) => (
    <View style={{ gap: 8 }}>
      <Txt v="h3">{t}</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{list.map((o) => <Chip key={o.v} label={o.l} active={sel(o.v)} onPress={() => on(o.v)} />)}</View>
    </View>
  );
  return (
    <View style={{ gap: SP.xl }}>
      {group("Playing level", LEVELS, (v) => level === v, setLevel)}
      {group("Preferred time", TIMES, (v) => times.includes(v), (v) => toggle(times, setTimes, v))}
      {group("Availability", AVAIL, (v) => avail.includes(v), (v) => toggle(avail, setAvail, v))}
      {group("Formats you play", FORMATS, (v) => formats.includes(v), (v) => toggle(formats, setFormats, v))}
      {group("Gender (optional, used only for filters)", [...GENDERS, { v: "undisclosed", l: "Prefer not to say" }], (v) => gender === v, setGender)}
      <Field label="About you (optional)" value={bio} onChangeText={setBio} placeholder="e.g. Play doubles most evenings, happy to rally" maxLength={200} />
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 2 }}><Txt v="h3">Show me in Find a Player</Txt><Txt v="small" color={T.muted}>Others see your approximate distance from {place}, never your exact location.</Txt></View>
        <Chip label={visible ? "On" : "Off"} active={visible} onPress={() => setVisible(!visible)} />
      </Card>
      <Button title="Save profile" variant="highlight" size="lg" disabled={!level} loading={save.isPending} onPress={() => save.mutate()} />
    </View>
  );
}
