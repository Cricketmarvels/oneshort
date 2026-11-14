import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { S } from "@cm/shared";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { ShieldCrest, Stepper } from "@/components/identity";
import { DateChips, SelectField, TimeField } from "@/components/pickers";
import { initialProposal, toProposalIn } from "@/components/proposal";
import { Button, Card, Chip, ChipRow, EmptyState, ErrorBox, Field, LoadingSkeleton, SearchBar, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { FORMATS, rating } from "@/lib/format";
import { useLocation } from "@/lib/location";
import type { Challenge, Dashboard, DiscoverTeam, FixtureFormat } from "@/lib/types";
import { R, SP, T } from "@/theme";

const RANGE = [{ v: "any", l: "Any rating" }, { v: "similar", l: "Similar ±150" }, { v: "stronger", l: "Stronger" }, { v: "weaker", l: "Weaker" }] as const;
type Range = (typeof RANGE)[number]["v"];

export default function NewChallenge() {
  const { from, to: preset } = useLocalSearchParams<{ from: string; to?: string }>();
  const [to, setTo] = useState<string | null>(preset ?? null);
  const [proposal, setProposal] = useState(initialProposal());
  const [message, setMessage] = useState("");
  const qc = useQueryClient();
  const { lat, lng } = useLocation();
  const mine = useQuery({ queryKey: ["team", from, "dashboard"], queryFn: () => api<Dashboard>(`/teams/${from}/dashboard`) });
  const target = useQuery({ queryKey: ["team", to, "dashboard"], enabled: !!to, queryFn: () => api<Dashboard>(`/teams/${to}/dashboard`) });
  const send = useMutation({
    mutationFn: (asDraft: boolean) => api<Challenge>("/challenges", { method: "POST", body: { from_team_id: from, to_team_id: to, proposal: toProposalIn(proposal), message: message || null, send: !asDraft } }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: ["challenges"] }); void qc.invalidateQueries({ queryKey: ["home"] }); router.replace({ pathname: "/challenge/[id]", params: { id: c.id } }); },
    onError: (e) => Alert.alert("Couldn't send challenge", errorText(e)),
  });
  if (!to) return <PickOpponent from={from} myRating={mine.data?.team.rating?.rating ?? null} onPick={setTo} />;
  const body = toProposalIn(proposal);
  const venues = useQuery({ queryKey: ["venues", lat, lng], queryFn: () => api<S<"VenueSearchOut">[]>("/venues", { query: { lat, lng } }) });
  const set = (patch: Partial<typeof proposal>) => setProposal({ ...proposal, ...patch });
  const step = !proposal.venue ? 2 : 3;
  // A ground OneShort knows has an id; a map suggestion only has a provider key. Either identifies the row.
  const venueKey = (v: S<"VenueSearchOut">) => v.id ?? v.place_id ?? v.name;
  const chosen = venues.data?.find((v) => v.name === proposal.venue?.name);
  const venueId = chosen ? venueKey(chosen) : null;
  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <Stack.Screen options={{ title: "Challenge a team", headerTitleAlign: "center" }} />
      <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.xl, paddingBottom: 130 }} keyboardShouldPersistTaps="handled">
        <Stepper steps={["Team", "Date", "Details", "Confirm"]} current={step} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 6 }}>
          <View style={{ alignItems: "center", gap: 6, flex: 1 }}>
            {mine.data ? <ShieldCrest name={mine.data.team.team_name} size={92} /> : null}
            <Txt v="smallSemi" numberOfLines={1}>{mine.data?.team.team_name}</Txt>
            {mine.data?.team.rating ? <Txt v="small" color={T.muted}>{rating(mine.data.team.rating.rating)}</Txt> : null}
          </View>
          <Txt v="display" color={T.ink} style={{ fontSize: 26 }}>VS</Txt>
          <Pressable accessibilityRole="button" accessibilityLabel="Change opponent" disabled={!!preset} onPress={() => setTo(null)} style={{ alignItems: "center", gap: 6, flex: 1 }}>
            {target.data ? <ShieldCrest name={target.data.team.team_name} size={92} /> : null}
            <Txt v="smallSemi" numberOfLines={1}>{target.data?.team.team_name ?? "…"}</Txt>
            {target.data?.team.rating ? <Txt v="small" color={T.muted}>{rating(target.data.team.rating.rating)}{target.data.head_to_head.length ? "" : " · first meeting"}</Txt> : null}
            {!preset ? <Txt v="small" color={T.primaryDark}>Change</Txt> : null}
          </Pressable>
        </View>
        <View style={{ gap: SP.md }}>
          <Txt v="h2">Select date</Txt>
          <DateChips value={proposal.date} onChange={(d) => set({ date: d })} days={21} />
        </View>
        <View style={{ gap: SP.md }}>
          <Txt v="h2">Select time</Txt>
          <TimeField label="Start time" value={proposal.time} onChange={(t) => set({ time: t })} />
        </View>
        <View style={{ gap: SP.md }}>
          <Txt v="h2">Match format</Txt>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{FORMATS.map((f) => <Chip key={f.v} label={f.l} active={proposal.format === f.v} onPress={() => set({ format: f.v })} />)}</View>
          {proposal.format === "CUSTOM" ? <Field label="Overs per side" value={proposal.overs} onChangeText={(o) => set({ overs: o.replace(/\D/g, "") })} keyboardType="number-pad" placeholder="e.g. 12" /> : null}
        </View>
        <View style={{ gap: SP.md }}>
          <Txt v="h2">Venue</Txt>
          <SelectField icon="place" placeholder="Choose a ground" value={venueId} onChange={(vid) => { const v = venues.data!.find((x) => venueKey(x) === vid)!; set({ venue: { name: v.name, area: v.area, city: v.city, location: { lat: v.lat, lng: v.lng } } }); }}
            options={(venues.data ?? []).map((v) => ({ v: venueKey(v), l: v.name, sub: `${v.area}${v.distance_km != null ? ` · ~${v.distance_km} km` : ""}` }))} />
        </View>
        <Field label="Match conditions (optional)" value={proposal.conditions} onChangeText={(c) => set({ conditions: c })} placeholder="Ball type, ground fee split, umpires…" />
        <Field label="Message to their captain (optional)" value={message} onChangeText={setMessage} placeholder="Fancy a game?" maxLength={200} />
        <Txt v="small" color={T.muted}>Both teams must be free within 4 hours of this time. OneShort checks for clashes before confirming.</Txt>
        <Button title="Save as draft" variant="ghost" disabled={!body} loading={send.isPending && send.variables === true} onPress={() => send.mutate(true)} />
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: SP.page, paddingBottom: SP.xl, backgroundColor: T.bg }}>
        <Button title="Send challenge" size="lg" variant="highlight" disabled={!body} loading={send.isPending && send.variables === false} onPress={() => send.mutate(false)} />
      </View>
    </View>
  );
}

function PickOpponent({ from, myRating, onPick }: { from: string; myRating: number | null; onPick: (id: string) => void }) {
  const { lat, lng, label } = useLocation();
  const [radius, setRadius] = useState("20");
  const [range, setRange] = useState<Range>("any");
  const [fmt, setFmt] = useState<"any" | FixtureFormat>("any");
  const [q, setQ] = useState("");
  const bounds = myRating == null ? {} : range === "similar" ? { min_rating: myRating - 150, max_rating: myRating + 150 } : range === "stronger" ? { min_rating: myRating } : range === "weaker" ? { max_rating: myRating } : {};
  const res = useQuery({
    queryKey: ["challenge-discover", from, radius, range, fmt, q, lat, lng],
    queryFn: () => api<DiscoverTeam[]>("/teams/discover", { query: { lat, lng, radius_km: Number(radius), from_team_id: from, format: fmt === "any" ? undefined : fmt, q: q || undefined, ...bounds } }),
  });
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.md, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <Stepper steps={["Team", "Date", "Details", "Confirm"]} current={0} />
      <Txt v="h2">Who do you want to play?</Txt>
      <Txt v="small" color={T.muted}>Teams near {label}, closest in rating first.</Txt>
      <SearchBar value={q} onChange={setQ} placeholder="Search by team name" />
      <ChipRow value={radius} onChange={setRadius} options={["5", "10", "20", "50"].map((r) => ({ v: r, l: `${r} km` }))} />
      <ChipRow value={range} onChange={setRange} options={RANGE.map((r) => ({ v: r.v, l: r.l }))} />
      <ChipRow value={fmt} onChange={setFmt} options={[{ v: "any" as const, l: "Any format" }, ...FORMATS]} />
      {res.isPending ? <LoadingSkeleton rows={4} /> : res.isError ? <ErrorBox error={res.error} /> : !res.data.length ? (
        <EmptyState title="No teams match" body="Widen the distance or rating range." />
      ) : res.data.map((t) => (
        <Card key={t.team.id} onPress={() => (t.open_challenge_id ? router.push({ pathname: "/challenge/[id]", params: { id: t.open_challenge_id } }) : onPick(t.team.id))} label={`Challenge ${t.team.team_name}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <ShieldCrest name={t.team.team_name} size={48} />
            <View style={{ flex: 1, gap: 2 }}>
              <Txt v="h3">{t.team.team_name}</Txt>
              <Txt v="small" color={T.muted}>~{t.distance_km} km · {t.member_count} players · {t.team.matches} verified</Txt>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Txt v="number">{t.team.rating ? rating(t.team.rating.rating) : "—"}</Txt>
              {t.rating_gap != null ? <Txt v="small" color={T.muted} style={{ fontSize: 11 }}>{t.rating_gap >= 0 ? "+" : ""}{Math.round(t.rating_gap)}</Txt> : null}
            </View>
          </View>
          {t.open_challenge_id ? <View style={{ padding: 8, borderRadius: R.sm, backgroundColor: T.warnSoft }}><Txt v="small" color={T.warnText}>You already have an active challenge with this team. Tap to open it.</Txt></View> : null}
        </Card>
      ))}
    </ScrollView>
  );
}
