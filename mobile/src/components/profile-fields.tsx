/** Sign-up profile inputs shared by email sign-up and complete-profile: date of birth (three selects, works in
 *  Expo Go and on web) and the cricket playing roles (several allowed; the first is the main one). */
import { useState } from "react";
import { View } from "react-native";

import { SelectField } from "@/components/pickers";
import { Chip, Txt } from "@/components/ui";
import { T } from "@/theme";

export const PLAYING_ROLES = [
  ["batsman", "Batter"],
  ["all_rounder", "All-rounder"],
  ["bowler", "Bowler"],
  ["wicketkeeper", "Wicketkeeper-batter"],
] as const;
export type PlayingRoleId = (typeof PLAYING_ROLES)[number][0];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");

/** value: ISO yyyy-mm-dd or null. Years offered: 18 to 100 years ago. */
export function DobField({ value, onChange, error, label = "Date of birth" }: { value: string | null; onChange: (iso: string | null) => void; error?: string | null; label?: string }) {
  // Partial picks live here (day without a year yet, etc.); the parent only ever sees a complete date or null.
  const [part, setPart] = useState<[string, string, string]>(() => (value ? (value.split("-") as [string, string, string]) : ["", "", ""]));
  const [y, m, d] = part;
  const thisYear = new Date().getFullYear(); // eslint-disable-line react-hooks/purity -- the year list only needs to be right today
  const years = Array.from({ length: 83 }, (_, i) => String(thisYear - 18 - i));
  const days = Array.from({ length: 31 }, (_, i) => pad(i + 1));
  const set = (ny: string, nm: string, nd: string) => { setPart([ny, nm, nd]); onChange(ny && nm && nd ? `${ny}-${nm}-${nd}` : null); };
  return (
    <View style={{ gap: 6 }}>
      <Txt v="smallSemi" color={T.ink}>{label}</Txt>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}><SelectField value={d || null} onChange={(v) => set(y, m, v)} options={days.map((v) => ({ v, l: String(Number(v)) }))} placeholder="Day" icon="time" /></View>
        <View style={{ flex: 1.3 }}><SelectField value={m || null} onChange={(v) => set(y, v, d)} options={MONTHS.map((l, i) => ({ v: pad(i + 1), l }))} placeholder="Month" icon="time" /></View>
        <View style={{ flex: 1.1 }}><SelectField value={y || null} onChange={(v) => set(v, m, d)} options={years.map((v) => ({ v, l: v }))} placeholder="Year" icon="time" /></View>
      </View>
      {error ? <Txt v="small" color={T.down} accessibilityRole="alert">{error}</Txt> : <Txt v="small" color={T.muted}>You must be 18 or older. Never shown to other players.</Txt>}
    </View>
  );
}

export function RolesField({ value, onChange, error, label = "Playing roles" }: { value: PlayingRoleId[]; onChange: (v: PlayingRoleId[]) => void; error?: string | null; label?: string }) {
  const toggle = (r: PlayingRoleId) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r]);
  return (
    <View style={{ gap: 8 }}>
      <Txt v="smallSemi" color={T.ink}>{label}</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="list">
        {PLAYING_ROLES.map(([v, l]) => <Chip key={v} label={value[0] === v ? `${l} · main` : l} active={value.includes(v)} onPress={() => toggle(v)} />)}
      </View>
      {error ? <Txt v="small" color={T.down} accessibilityRole="alert">{error}</Txt> : <Txt v="small" color={T.muted}>Pick all that apply. The first one you pick is your main role.</Txt>}
    </View>
  );
}
