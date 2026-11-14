/** Date & time pickers used by the guided flows (Create a match, Challenge a team). Dates are IST "YYYY-MM-DD". */
import { ChevronDown, ChevronLeft, ChevronRight, Clock, MapPin } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";

import { Segmented, Txt } from "@/components/ui";
import { FW, R, shadow, SP, T } from "@/theme";

export function istToday(offsetDays = 0): string {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  now.setUTCDate(now.getUTCDate() + offsetDays);
  return now.toISOString().slice(0, 10);
}
const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const label = (iso: string, o: Intl.DateTimeFormatOptions) => asDate(iso).toLocaleDateString("en-IN", { ...o, timeZone: "UTC" });
export const TIMES = ["06:00", "07:00", "08:00", "09:00", "10:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];
export const timeLabel = (t: string) => { const [h, m] = t.split(":").map(Number); return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`; };

/** Month calendar; days before today and beyond `maxDays` are disabled. */
export function CalendarPicker({ value, onChange, maxDays = 60 }: { value: string; onChange: (d: string) => void; maxDays?: number }) {
  const today = istToday(), last = istToday(maxDays);
  const [month, setMonth] = useState(value.slice(0, 7));
  const cells = useMemo(() => {
    const first = asDate(`${month}-01`);
    const lead = first.getUTCDay();
    const days = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`)];
  }, [month]);
  const shift = (n: number) => { const d = asDate(`${month}-01`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  return (
    <View style={[{ backgroundColor: T.surface, borderRadius: R.card, borderWidth: 1, borderColor: T.line, padding: SP.lg, gap: SP.md }, shadow(1)]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous month" disabled={month <= today.slice(0, 7)} onPress={() => shift(-1)} hitSlop={10}><ChevronLeft size={20} color={month <= today.slice(0, 7) ? T.line : T.ink} strokeWidth={2} /></Pressable>
        <Txt v="h3">{label(`${month}-01`, { month: "long", year: "numeric" })}</Txt>
        <Pressable accessibilityRole="button" accessibilityLabel="Next month" disabled={month >= last.slice(0, 7)} onPress={() => shift(1)} hitSlop={10}><ChevronRight size={20} color={month >= last.slice(0, 7) ? T.line : T.ink} strokeWidth={2} /></Pressable>
      </View>
      <View style={{ flexDirection: "row" }}>{["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => <Txt key={d} v="small" color={T.muted} style={{ flex: 1, textAlign: "center" }}>{d}</Txt>)}</View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", rowGap: 6 }}>
        {cells.map((c, i) => {
          if (!c) return <View key={`e${i}`} style={{ width: `${100 / 7}%` }} />;
          const off = c < today || c > last, on = c === value;
          return (
            <View key={c} style={{ width: `${100 / 7}%`, alignItems: "center" }}>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: on, disabled: off }} accessibilityLabel={label(c, { weekday: "long", day: "numeric", month: "long" })} disabled={off} onPress={() => onChange(c)}
                style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: on ? T.primary : "transparent" }}>
                <Txt v={on ? "smallSemi" : "bodyMed"} color={on ? T.surface : off ? T.line : T.ink} style={{ fontSize: 15 }}>{Number(c.slice(8))}</Txt>
              </Pressable>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Horizontal day chips ("Sat / 16 Nov") for the next N days. */
export function DateChips({ value, onChange, days = 14 }: { value: string; onChange: (d: string) => void; days?: number }) {
  const list = useMemo(() => Array.from({ length: days }, (_, i) => istToday(i + 1)), [days]);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 8 }}>
      {list.map((d) => {
        const on = d === value;
        return (
          <Pressable key={d} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={label(d, { weekday: "long", day: "numeric", month: "long" })} onPress={() => onChange(d)}
            style={{ width: 74, paddingVertical: 10, alignItems: "center", borderRadius: 16, borderWidth: on ? 1.5 : 1, borderColor: on ? T.primary : T.line, backgroundColor: on ? T.tint : T.surface }}>
            <Txt v="smallSemi" color={on ? T.primaryDark : T.ink}>{label(d, { weekday: "short" })}</Txt>
            <Txt v="small" color={on ? T.primaryDark : T.muted}>{label(d, { day: "numeric", month: "short" })}</Txt>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Select-style field that expands into a list (time, venue, …). */
export function SelectField<V extends string>({ value, options, onChange, icon = "time", placeholder = "Select" }: { value: V | null; options: { v: V; l: string; sub?: string }[]; onChange: (v: V) => void; icon?: "time" | "place" | "none"; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const cur = options.find((o) => o.v === value);
  const Icon = icon === "time" ? Clock : MapPin;
  return (
    <View style={[{ backgroundColor: T.surface, borderRadius: R.field, borderWidth: 1, borderColor: open ? T.primary : T.line, overflow: "hidden" }, shadow(1)]}>
      <Pressable accessibilityRole="button" accessibilityLabel={cur ? `${cur.l}. Change` : placeholder} accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: icon === "none" ? 12 : 16 }}>
        {icon === "none" ? null : <Icon size={20} color={T.ink} strokeWidth={1.8} />}
        <Txt v="bodyMed" color={cur ? T.ink : T.faint} style={{ flex: 1 }} numberOfLines={1}>{cur?.l ?? placeholder}</Txt>
        <ChevronDown size={18} color={T.ink} strokeWidth={2} style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }} />
      </Pressable>
      {open ? (
        <View style={{ borderTopWidth: 1, borderTopColor: T.line, maxHeight: 260 }}>
          <ScrollView nestedScrollEnabled>
            {options.map((o) => (
              <Pressable key={o.v} accessibilityRole="button" accessibilityState={{ selected: o.v === value }} onPress={() => { onChange(o.v); setOpen(false); }}
                style={({ pressed }) => ({ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: o.v === value ? T.tint : pressed ? T.surface2 : T.surface })}>
                <Txt v={o.v === value ? "smallSemi" : "bodyMed"} color={o.v === value ? T.primaryDark : T.ink} style={{ fontSize: 15 }}>{o.l}</Txt>
                {o.sub ? <Txt v="small" color={T.muted}>{o.sub}</Txt> : null}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}


/** 12-hour time: hour 1–12, minutes typed (0–59), AM/PM. value/onChange use 24-hour "HH:MM" so callers don't change. */
export function TimeField({ value, onChange, label = "Time" }: { value: string; onChange: (hhmm: string) => void; label?: string }) {
  const [h24, m] = value.split(":").map(Number) as [number, number];
  const pm = h24 >= 12;
  const h12 = ((h24 + 11) % 12) + 1;
  const [minText, setMinText] = useState(String(m).padStart(2, "0"));
  const emit = (hour12: number, minutes: number, isPm: boolean) => {
    const h = (hour12 % 12) + (isPm ? 12 : 0);
    onChange(`${String(h).padStart(2, "0")}:${String(Math.min(59, Math.max(0, minutes))).padStart(2, "0")}`);
  };
  const hours = Array.from({ length: 12 }, (_, i) => String(i + 1));
  return (
    <View style={{ gap: 6 }}>
      <Txt v="smallSemi" color={T.ink}>{label}</Txt>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1.1 }}>
          <SelectField value={String(h12)} onChange={(v) => emit(Number(v), m, pm)} options={hours.map((v) => ({ v, l: v }))} placeholder="Hour" icon="none" />
        </View>
        <Txt v="h2" color={T.muted}>:</Txt>
        <View style={{ flex: 1 }}>
          <TextInput accessibilityLabel="Minutes" value={minText} keyboardType="number-pad" maxLength={2} placeholder="00" placeholderTextColor={T.placeholder}
            onChangeText={(t) => { const d = t.replace(/\D/g, "").slice(0, 2); setMinText(d); if (d.length) emit(h12, Number(d), pm); }}
            onBlur={() => { const n = Math.min(59, Number(minText || "0")); setMinText(String(n).padStart(2, "0")); emit(h12, n, pm); }}
            style={{ height: 52, borderRadius: R.field, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, paddingHorizontal: 14, fontSize: 17, textAlign: "center", color: T.ink, ...FW.semibold }} />
        </View>
        <View style={{ flex: 1.5 }}>
          <Segmented value={pm ? "PM" : "AM"} onChange={(v) => emit(h12, m, v === "PM")} options={[{ v: "AM", l: "AM" }, { v: "PM", l: "PM" }]} />
        </View>
      </View>
      <Txt v="small" color={T.muted}>{timeLabel(value)} IST</Txt>
    </View>
  );
}
