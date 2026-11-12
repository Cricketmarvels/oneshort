/**
 * Share availability (player). A player doesn't go looking for other players — they say when they
 * can play and whether they'll pay their share, and captains filling a squad find them.
 * One slot = day + time window + (available / tentative / not free) + (pays / plays free).
 */
import { formatDateTime, timeRange, type S } from "@cm/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CalendarCheck2, Trash2 } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Pressable, RefreshControl, ScrollView, View } from "react-native";

import { DateChips, SelectField, istToday, timeLabel } from "@/components/pickers";
import { KickerChip, SectionHeader } from "@/components/refined";
import { Badge, Button, EmptyState, ErrorBox, InlineNotice, LoadingSkeleton, Segmented, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { R, SP, T } from "@/theme";

type Slot = S<"AvailabilityOut">;
type Status = S<"AvailabilityStatus">;
type Pays = S<"ContributionType">;

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
const HOURS = Array.from({ length: 18 }, (_, i) => `${String(i + 5).padStart(2, "0")}:00`); // 05:00 … 22:00
const hourOf = (t: string) => Number(t.split(":")[0]);

export default function ShareAvailability() {
  const mine = useQuery({ queryKey: ["availability"], queryFn: () => api<Slot[]>("/availability/me") });
  const [date, setDate] = useState(istToday(1));
  const [start, setStart] = useState("07:00");
  const [end, setEnd] = useState("11:00");
  const [status, setStatus] = useState<Status>("available");
  const [pays, setPays] = useState<Pays>("payee");
  const [repeat, setRepeat] = useState<"once" | "weekly">("once");

  // The end list only offers times after the start, up to 8 hours later — the API caps a slot at 16 h anyway.
  const ends = useMemo(() => HOURS.filter((t) => hourOf(t) > hourOf(start) && hourOf(t) <= hourOf(start) + 8).concat(hourOf(start) + 8 >= 23 ? ["23:00"] : []), [start]);
  const pickStart = (t: string) => { setStart(t); if (hourOf(end) <= hourOf(t)) setEnd(`${String(Math.min(23, hourOf(t) + 4)).padStart(2, "0")}:00`); };

  const add = useMutation({
    mutationFn: () => api("/availability", {
      method: "POST",
      body: {
        start_at: new Date(`${date}T${start}:00`).toISOString(),
        end_at: new Date(`${date}T${end}:00`).toISOString(),
        status,
        contribution: status === "unavailable" ? "payee" : pays,
        timezone: TZ,
        repeat_weeks: repeat === "weekly" ? 3 : 0,
      },
    }),
    onSuccess: () => void mine.refetch(),
    onError: (e) => Alert.alert("Couldn't share that", errorText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/availability/${id}`, { method: "DELETE" }),
    onSuccess: () => void mine.refetch(),
    onError: (e) => Alert.alert("Couldn't remove it", errorText(e)),
  });

  const upcoming = [...(mine.data ?? [])].sort((a, b) => a.start_at.localeCompare(b.start_at)); // the API only returns slots that haven't ended
  const free = status !== "unavailable";

  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.section, paddingBottom: 60 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={mine.isRefetching} onRefresh={() => void mine.refetch()} tintColor={T.primary} />}>
      <View style={{ gap: 6 }}>
        <Txt v="hero">When can you play?</Txt>
        <Txt v="small" color={T.muted}>Captains filling a squad near you see this. Your exact location is never shown.</Txt>
      </View>

      <View style={{ gap: SP.md }}>
        <Txt v="h3">Day</Txt>
        <DateChips value={date} onChange={setDate} days={21} />
      </View>

      <View style={{ gap: SP.md }}>
        <Txt v="h3">Time</Txt>
        <View style={{ flexDirection: "row", gap: SP.sm }}>
          <View style={{ flex: 1 }}><SelectField value={start} onChange={pickStart} options={HOURS.map((t) => ({ v: t, l: timeLabel(t) }))} placeholder="From" /></View>
          <View style={{ flex: 1 }}><SelectField value={end} onChange={setEnd} options={ends.map((t) => ({ v: t, l: timeLabel(t) }))} placeholder="To" /></View>
        </View>
      </View>

      <View style={{ gap: SP.md }}>
        <Segmented value={status} onChange={setStatus} options={[{ v: "available", l: "Available" }, { v: "tentative", l: "Maybe" }, { v: "unavailable", l: "Not free" }]} />
        {free ? (
          <View style={{ gap: 6 }}>
            <Txt v="h3">Match fee</Txt>
            <Segmented value={pays} onChange={setPays} options={[{ v: "payee", l: "I'll pay my share" }, { v: "non_payee", l: "Playing free" }]} />
            {pays === "non_payee" ? <Txt v="small" color={T.muted}>Captains see "plays free" before they invite you, so the split is settled upfront.</Txt> : null}
          </View>
        ) : (
          <InlineNotice>Captains won't invite you for this window.</InlineNotice>
        )}
        <Segmented value={repeat} onChange={setRepeat} options={[{ v: "once", l: "Just this day" }, { v: "weekly", l: "Every week · 4 wks" }]} />
      </View>

      <Button title={free ? "Share availability" : "Mark as not free"} size="lg" loading={add.isPending} icon={<CalendarCheck2 size={18} color="#FFFFFF" />} onPress={() => add.mutate()} />

      <View style={{ gap: SP.md }}>
        <SectionHeader title={upcoming.length ? `Your slots · ${upcoming.length}` : "Your slots"} />
        {mine.isPending ? <LoadingSkeleton rows={3} /> : mine.isError ? <ErrorBox error={mine.error} onRetry={() => void mine.refetch()} />
          : !upcoming.length ? <EmptyState icon={<CalendarCheck2 size={22} color={T.ink} strokeWidth={1.5} />} title="Nothing shared yet" body="Pick a day and time above. Captains only see players who've shared a slot." />
          : upcoming.map((a) => <SlotRow key={a.id} slot={a} onRemove={() => remove.mutate(a.id)} removing={remove.isPending && remove.variables === a.id} />)}
      </View>
    </ScrollView>
  );
}

function SlotRow({ slot, onRemove, removing }: { slot: Slot; onRemove: () => void; removing: boolean }) {
  const busy = slot.status === "unavailable";
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: R.card, borderWidth: 1, borderColor: T.line, backgroundColor: T.surface, opacity: busy ? 0.75 : 1 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <Txt v="h3" numberOfLines={1}>{formatDateTime(slot.start_at, slot.timezone, { weekday: "short", day: "numeric", month: "short", hour: undefined, minute: undefined })}</Txt>
        <Txt v="small" color={T.muted}>{timeRange(slot.start_at, slot.end_at, slot.timezone)}</Txt>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Badge status={slot.status} label={busy ? "Not free" : slot.status === "tentative" ? "Maybe" : "Available"} />
          {busy ? null : <KickerChip label={slot.contribution === "non_payee" ? "PLAYS FREE" : "PAYS SHARE"} tone={slot.contribution === "non_payee" ? "orange" : "aqua"} />}
        </View>
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel="Remove this slot" hitSlop={10} disabled={removing} onPress={onRemove}
        style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: T.surface2 }}>
        <Trash2 size={18} color={T.muted} strokeWidth={1.8} />
      </Pressable>
    </View>
  );
}
