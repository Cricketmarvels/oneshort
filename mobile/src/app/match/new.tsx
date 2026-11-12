/**
 * Create a match — guided 4-step flow (Format → Venue → Date & time → Confirm). Posts the existing
 * MatchIn contract to POST /matches; entries are kept when moving back and forth between steps.
 */
import type { S } from "@cm/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Check, MapPin, Minus, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";

import { Stepper } from "@/components/identity";
import { CalendarPicker, istToday, SelectField, TIMES, timeLabel } from "@/components/pickers";
import { Button, Card, Chip, EmptyState, Field, InlineNotice, LoadingSkeleton, SearchBar, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useManagedTeam } from "@/lib/hooks";
import { useLocation } from "@/lib/location";
import { R, SP, T } from "@/theme";

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
  const [venue, setVenue] = useState<Venue | null>(null);
  const [q, setQ] = useState("");
  const [dq, setDq] = useState("");
  const [saving, setSaving] = useState(false);
  const [date, setDate] = useState(istToday(3));
  const [time, setTime] = useState("07:00");
  const [title, setTitle] = useState("");
  // Typing searches every ground by name, area or city, plus map suggestions; empty lists the nearest ones.
  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const venues = useQuery({
    queryKey: ["grounds", dq, lat, lng],
    queryFn: () => api<Venue[]>("/venues", { query: { lat, lng, q: dq || undefined } }),
    placeholderData: (prev) => prev,
  });
  // A map suggestion has no id until somebody uses it; picking one stores it as a GoFindr ground.
  const pick = async (v: Venue) => {
    setVenue(v);
    if (v.id) return;
    setSaving(true);
    try {
      setVenue(await api<Venue>("/venues/resolve", { method: "POST", body: { name: v.name, address: v.address, area: v.area, city: v.city, lat: v.lat, lng: v.lng, source: v.source, place_id: v.place_id } }));
    } catch (e) {
      setVenue(null);
      Alert.alert("Couldn't use that ground", errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const isPicked = (v: Venue) => !!venue && (v.place_id ? venue.place_id === v.place_id : !!v.id && venue.id === v.id);
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
  const canNext = step === 0 ? true : step === 1 ? !!venue?.id : step === 2 ? !!date && !!time : true;
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
          <View style={{ gap: SP.md }}>
            <Txt v="h1">Select a venue</Txt>
            <SearchBar value={q} onChange={setQ} placeholder="Search grounds by name or area" />
            {venues.isPending ? <LoadingSkeleton rows={4} /> : !venues.data?.length ? (
              <EmptyState title={dq ? `No ground matches "${dq}"` : "No grounds found nearby"}
                body={dq ? "Try the area name, or clear the search to see grounds near you." : "Change your location from Home and try again."} />
            ) : (
              <View style={{ borderRadius: R.card, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, overflow: "hidden" }}>
                {venues.data.map((v, i) => {
                  const on = isPicked(v);
                  const fromMap = v.source !== "gofindr";
                  const first = fromMap && (i === 0 || venues.data![i - 1]?.source === "gofindr");
                  return (
                    <View key={v.place_id ?? v.id ?? v.name}>
                      {first ? (
                        <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, borderTopWidth: 1, borderTopColor: T.line, backgroundColor: T.surface2 }}>
                          <Txt v="small" color={T.muted}>From the map</Txt>
                        </View>
                      ) : null}
                      <Pressable accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => void pick(v)}
                        style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12, minHeight: 56, borderTopWidth: i && !first ? 1 : 0, borderTopColor: T.line, backgroundColor: on ? T.primarySoft : T.surface }}>
                        <MapPin size={18} color={on ? T.primaryDark : fromMap ? T.faint : T.muted} strokeWidth={1.8} />
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Txt v="h3" color={on ? T.primaryDark : T.ink} numberOfLines={1}>{v.name}</Txt>
                          <Txt v="small" color={T.muted} numberOfLines={1}>{v.area}, {v.city}{v.distance_km != null ? ` · ~${v.distance_km} km` : ""}</Txt>
                        </View>
                        {on && saving ? <ActivityIndicator size="small" color={T.primary} /> : on ? <Check size={20} color={T.primary} strokeWidth={2.4} /> : null}
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
            <InlineNotice>GoFindr doesn't book grounds — confirm the slot with the ground first.</InlineNotice>
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
