/**
 * Create a match — guided 4-step flow (Format → Venue → Date & time → Confirm). Posts the existing
 * MatchIn contract to POST /matches; entries are kept when moving back and forth between steps.
 */
import type { S } from "@cm/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Minus, Plus } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { Stepper } from "@/components/identity";
import { CalendarPicker, istToday, SelectField, TIMES, timeLabel } from "@/components/pickers";
import { Button, Card, Chip, EmptyState, Field, InlineNotice, LoadingSkeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useManagedTeam } from "@/lib/hooks";
import { useLocation } from "@/lib/location";
import { SP, T } from "@/theme";

type Venue = S<"VenueSearchOut">;
type Format = S<"MatchFormat">;
type Category = S<"MatchCategory">;
const STEPS = ["Format", "Venue", "Date & Time", "Confirm"];
const FORMATS: { v: Format; l: string; hours: number }[] = [{ v: "T10", l: "T10", hours: 2 }, { v: "T20", l: "T20", hours: 3.5 }, { v: "ODI", l: "ODI", hours: 8 }, { v: "OTHER", l: "Practice / other", hours: 2 }];
const CATS: { v: Category; l: string }[] = [{ v: "friendly", l: "Friendly" }, { v: "practice", l: "Practice" }, { v: "corporate", l: "Corporate" }, { v: "tournament", l: "Tournament" }];

function Counter({ value, onChange, min, max }: { value: number; onChange: (n: number) => void; min: number; max: number }) {
  const btn = (d: number, Icon: typeof Plus, l: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={l} disabled={value + d < min || value + d > max} onPress={() => onChange(value + d)}
      style={{ width: 44, height: 44, borderRadius: 22, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, alignItems: "center", justifyContent: "center", opacity: value + d < min || value + d > max ? 0.4 : 1 }}>
      <Icon size={18} color={T.ink} strokeWidth={2} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
      {btn(-1, Minus, "Fewer players")}<Txt v="metric" style={{ minWidth: 40, textAlign: "center" }}>{value}</Txt>{btn(1, Plus, "More players")}
    </View>
  );
}

export default function CreateMatch() {
  const params = useLocalSearchParams<{ team?: string }>();
  const managed = useManagedTeam();
  const teamId = params.team ?? managed;
  const { lat, lng } = useLocation();
  const [step, setStep] = useState(0);
  const [format, setFormat] = useState<Format>("T20");
  const [category, setCategory] = useState<Category>("friendly");
  const [squad, setSquad] = useState(11);
  const [venueId, setVenueId] = useState<string | null>(null);
  const [date, setDate] = useState(istToday(3));
  const [time, setTime] = useState("07:00");
  const [title, setTitle] = useState("");
  const venues = useQuery({ queryKey: ["grounds", lat, lng, ""], queryFn: () => api<Venue[]>("/venues", { query: { lat, lng } }) });
  const venue = venues.data?.find((v) => v.id === venueId) ?? null;
  const hours = FORMATS.find((f) => f.v === format)!.hours;
  const startIso = `${date}T${time}:00+05:30`;
  const create = useMutation({
    mutationFn: () => {
      const start = new Date(startIso);
      const body: S<"MatchIn"> = {
        team_id: teamId!, title: title.trim() || `${format === "OTHER" ? "Practice" : format} match at ${venue!.name}`, description: null,
        venue: { venue_id: venue!.id, name: venue!.name, address: venue!.address, area: venue!.area, city: venue!.city },
        location: { lat: venue!.lat, lng: venue!.lng }, start_at: start.toISOString(), end_at: new Date(start.getTime() + hours * 3600_000).toISOString(),
        timezone: "Asia/Kolkata", format, category, squad_capacity: squad, required_roles: { batsman: 0, bowler: 0, wicketkeeper: 0, all_rounder: 0 },
        estimated_expenses_paise: 0, default_contribution_type: "payee", captain_plays: true, captain_role: null, publish: true,
      };
      return api<S<"MatchOut">>("/matches", { method: "POST", body });
    },
    onSuccess: (m) => router.replace({ pathname: "/match/[id]", params: { id: m.id } }),
    onError: (e) => Alert.alert("Couldn't create the match", errorText(e)),
  });

  if (!teamId) return <View style={{ flex: 1, backgroundColor: T.bg, padding: SP.page }}><EmptyState title="Create a team first" body="Matches are organised by a team captain." action="Create a team" onAction={() => router.replace("/team/new")} /></View>;
  const canNext = step === 0 ? true : step === 1 ? !!venue : step === 2 ? !!date && !!time : true;
  const nextLabel = ["Next: Venue", "Next: Date & time", "Next: Review", "Create match"][step]!;

  return (
    <View style={{ flex: 1, backgroundColor: T.bg }}>
      <Stack.Screen options={{ title: "Create a match", headerTitleAlign: "center" }} />
      <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.xl, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <Stepper steps={STEPS} current={step} />
        {step === 0 ? (
          <View style={{ gap: SP.lg }}>
            <Txt v="h1">Choose a format</Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{FORMATS.map((f) => <Chip key={f.v} label={f.l} active={format === f.v} onPress={() => setFormat(f.v)} />)}</View>
            <Txt v="h3">Match type</Txt>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{CATS.map((c) => <Chip key={c.v} label={c.l} active={category === c.v} onPress={() => setCategory(c.v)} />)}</View>
            <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ gap: 2 }}><Txt v="h3">Player slots</Txt><Txt v="small" color={T.muted}>Including you</Txt></View>
              <Counter value={squad} onChange={setSquad} min={2} max={22} />
            </Card>
          </View>
        ) : step === 1 ? (
          <View style={{ gap: SP.lg }}>
            <Txt v="h1">Select a venue</Txt>
            {venues.isPending ? <LoadingSkeleton rows={3} /> : !venues.data?.length ? <EmptyState title="No grounds found nearby" body="Change your location from Home and try again." /> : (
              <SelectField icon="place" placeholder="Choose a ground" value={venueId} onChange={setVenueId}
                options={venues.data.map((v) => ({ v: v.id, l: v.name, sub: `${v.area}, ${v.city}${v.distance_km != null ? ` · ~${v.distance_km} km` : ""}` }))} />
            )}
            <InlineNotice>PlayR doesn't book grounds. Confirm the slot with the ground before inviting players.</InlineNotice>
          </View>
        ) : step === 2 ? (
          <View style={{ gap: SP.lg }}>
            <Txt v="h1">Select date & time</Txt>
            <CalendarPicker value={date} onChange={setDate} />
            <Txt v="h3">Select time</Txt>
            <SelectField value={time} onChange={setTime} options={TIMES.map((t) => ({ v: t, l: timeLabel(t) }))} />
          </View>
        ) : (
          <View style={{ gap: SP.lg }}>
            <Txt v="h1">Review & confirm</Txt>
            <Card style={{ gap: 12 }}>
              {([["Format", `${FORMATS.find((f) => f.v === format)!.l} · ${CATS.find((c) => c.v === category)!.l}`], ["Venue", venue ? `${venue.name}, ${venue.area}` : "—"], ["When", `${new Date(startIso).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} · ${timeLabel(time)} (about ${hours} h)`], ["Player slots", String(squad)]] as const).map(([k, v]) => (
                <View key={k} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}><Txt v="small" color={T.muted}>{k}</Txt><Txt v="smallSemi" style={{ flex: 1, textAlign: "right" }}>{v}</Txt></View>
              ))}
            </Card>
            <Field label="Match title (optional)" value={title} onChangeText={setTitle} placeholder={`${format === "OTHER" ? "Practice" : format} match at ${venue?.name ?? "the ground"}`} maxLength={80} />
            <Txt v="small" color={T.muted}>The match is published to nearby players with open spots. You can invite players and split the fee afterwards.</Txt>
          </View>
        )}
      </ScrollView>
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: SP.page, paddingBottom: SP.xl, backgroundColor: T.bg, flexDirection: "row", gap: 10 }}>
        {step > 0 ? <Button title="Back" variant="outline" size="lg" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
        <Button title={nextLabel} variant="highlight" size="lg" disabled={!canNext} loading={create.isPending} onPress={() => (step < 3 ? setStep(step + 1) : create.mutate())} style={{ flex: 2 }} />
      </View>
    </View>
  );
}
