/** Match proposal form: date, time, venue, format, overs and conditions. Used for challenges and counter-proposals. */
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { View } from "react-native";

import { Chip, Field, Section, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { FORMATS } from "@/lib/format";
import { useLocation } from "@/lib/location";
import type { FixtureFormat } from "@/lib/types";
import { SP, T } from "@/theme";

const TIMES = ["06:00", "07:00", "08:00", "09:00", "15:00", "16:00", "17:00", "19:00"];

function istDate(offsetDays: number): string {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}

export type ProposalState = { date: string; time: string; venue: { name: string; area?: string | null; city?: string | null; location?: { lat: number; lng: number } } | null; format: FixtureFormat; overs: string; conditions: string };

export function initialProposal(p?: S<"ProposalOut">): ProposalState {
  if (!p) return { date: istDate(3), time: "07:00", venue: null, format: "T20", overs: "", conditions: "" };
  const ist = new Date(new Date(p.start_at).getTime() + 5.5 * 3600_000).toISOString();
  return { date: ist.slice(0, 10), time: ist.slice(11, 16), venue: p.venue, format: p.format, overs: p.format === "CUSTOM" ? String(p.overs) : "", conditions: p.conditions ?? "" };
}

export function toProposalIn(s: ProposalState): S<"ProposalIn"> | null {
  if (!s.venue?.name) return null;
  return {
    start_at: `${s.date}T${s.time}:00+05:30`,
    venue: { name: s.venue.name, area: s.venue.area ?? null, city: s.venue.city ?? null, location: s.venue.location ?? null },
    format: s.format,
    overs: s.format === "CUSTOM" ? Number(s.overs) || null : null,
    conditions: s.conditions || null,
  };
}

export function ProposalForm({ value, onChange }: { value: ProposalState; onChange: (v: ProposalState) => void }) {
  const { lat, lng } = useLocation();
  const venues = useQuery({ queryKey: ["venues", lat, lng], queryFn: () => api<S<"VenueSearchOut">[]>("/venues", { query: { lat, lng } }) });
  const [custom, setCustom] = useState("");
  const days = useMemo(() => Array.from({ length: 21 }, (_, i) => istDate(i + 1)), []);
  const set = (patch: Partial<ProposalState>) => onChange({ ...value, ...patch });
  return (
    <View style={{ gap: SP.xl }}>
      <Section title="Date">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {days.map((d) => {
            const dt = new Date(`${d}T12:00:00+05:30`);
            return <Chip key={d} label={dt.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })} active={value.date === d} onPress={() => set({ date: d })} />;
          })}
        </View>
      </Section>
      <Section title="Start time (IST)">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{TIMES.map((t) => <Chip key={t} label={t} active={value.time === t} onPress={() => set({ time: t })} />)}</View>
      </Section>
      <Section title="Venue">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(venues.data ?? []).slice(0, 8).map((v) => (
            <Chip key={v.id} label={`${v.name}${v.distance_km != null ? ` · ${v.distance_km} km` : ""}`} active={value.venue?.name === v.name}
              onPress={() => set({ venue: { name: v.name, area: v.area, city: v.city, location: { lat: v.lat, lng: v.lng } } })} />
          ))}
        </View>
        <Field label="Or type a ground" value={custom} onChangeText={(t) => { setCustom(t); set({ venue: t ? { name: t } : null }); }} placeholder="e.g. DPS school ground, Sector 30" />
      </Section>
      <Section title="Format">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{FORMATS.map((f) => <Chip key={f.v} label={f.l} active={value.format === f.v} onPress={() => set({ format: f.v })} />)}</View>
        {value.format === "CUSTOM" ? <Field label="Overs per side" value={value.overs} onChangeText={(o) => set({ overs: o.replace(/\D/g, "") })} keyboardType="number-pad" placeholder="e.g. 12" /> : null}
      </Section>
      <Field label="Match conditions (optional)" value={value.conditions} onChangeText={(c) => set({ conditions: c })} multiline placeholder="Ball type, ground fee split, umpires, whites…" style={{ minHeight: 80, paddingTop: 12, textAlignVertical: "top" }} />
      <Txt v="small" color={T.muted}>Both teams must be free within 4 hours of this time. OneShort checks for clashes before confirming.</Txt>
    </View>
  );
}
