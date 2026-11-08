import { formatTime, type Availability, type S } from "@cm/shared";
import { CalendarPlus, ChevronLeft, ChevronRight, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { type LatLng, LocationPicker } from "@/components/maps/LocationPicker";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/chip";
import { Field, Input, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { ApiError } from "@/services/api/client";
import { availability, useMyAvailability, usePlayerProfile } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";
import { cn } from "@/utils/cn";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
const STATUS_STYLES: Record<string, string> = {
  available: "bg-brand-100 text-brand-900 ring-brand-300",
  tentative: "bg-amber-50 text-amber-900 ring-amber-300",
  unavailable: "bg-ball-50 text-ball-600 ring-ball-500/30",
};

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const dayKey = (d: Date) => d.toLocaleDateString("en-CA");

export function AvailabilityPage() {
  const [week, setWeek] = useState(() => startOfWeek(new Date()));
  const end = useMemo(() => new Date(week.getTime() + 7 * 86400_000), [week]);
  const q = useMyAvailability(week.toISOString(), end.toISOString());
  const [editing, setEditing] = useState<{ date: string; slot?: Availability } | null>(null);
  const days = Array.from({ length: 7 }, (_, i) => new Date(week.getTime() + i * 86400_000));
  const byDay = useMemo(() => {
    const m: Record<string, Availability[]> = {};
    for (const s of q.data ?? []) (m[dayKey(new Date(s.start_at))] ??= []).push(s);
    return m;
  }, [q.data]);
  const isCurrentWeek = startOfWeek(new Date()).getTime() === week.getTime();

  return (
    <div>
      <PageHeader title="Availability" subtitle="Captains can only find you for times you've marked available. Times are shown in your timezone."
        action={<Button icon={<CalendarPlus className="size-4" />} onClick={() => setEditing({ date: dayKey(new Date()) })}>Add</Button>} />
      <div className="mb-4 flex items-center justify-between">
        <Button variant="ghost" size="icon" aria-label="Previous week" disabled={isCurrentWeek} onClick={() => setWeek(new Date(week.getTime() - 7 * 86400_000))}><ChevronLeft /></Button>
        <p className="font-display font-bold">{week.toLocaleDateString("en-IN", { day: "numeric", month: "short" })} – {new Date(end.getTime() - 1).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</p>
        <Button variant="ghost" size="icon" aria-label="Next week" onClick={() => setWeek(new Date(week.getTime() + 7 * 86400_000))}><ChevronRight /></Button>
      </div>
      {q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> : (
        <div className="grid gap-2 md:grid-cols-7">
          {days.map((d) => {
            const key = dayKey(d);
            const slots = byDay[key] ?? [];
            const past = d < new Date(new Date().setHours(0, 0, 0, 0));
            const today = key === dayKey(new Date());
            return (
              <Card key={key} className={cn("flex min-h-28 flex-col p-3 md:min-h-56", past && "opacity-50", today && "ring-2 ring-brand-500")}>
                <div className="mb-2 flex items-baseline justify-between md:block">
                  <p className="text-xs font-semibold uppercase text-ink-500">{d.toLocaleDateString("en-IN", { weekday: "short" })}</p>
                  <p className="font-display text-xl font-bold">{d.getDate()}</p>
                </div>
                <div className="flex-1 space-y-1.5">
                  {q.isPending ? <Skeleton className="h-10" /> : slots.map((s) => (
                    <button key={s.id} onClick={() => setEditing({ date: key, slot: s })} className={cn("block w-full rounded-xl px-2 py-1.5 text-left text-xs font-semibold ring-1", STATUS_STYLES[s.status])}>
                      {formatTime(s.start_at)}–{formatTime(s.end_at)}
                      <span className="block font-normal capitalize opacity-80">{s.status}</span>
                    </button>
                  ))}
                </div>
                {!past && <button onClick={() => setEditing({ date: key })} className="mt-2 rounded-xl border border-dashed border-sand-300 py-1.5 text-xs font-semibold text-ink-500 hover:border-brand-400 hover:text-brand-700">+ Add</button>}
              </Card>
            );
          })}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-ink-500">
        {["available", "tentative", "unavailable"].map((s) => <span key={s} className="flex items-center gap-1.5"><StatusBadge status={s} /></span>)}
      </div>
      {editing && <SlotSheet date={editing.date} slot={editing.slot} onClose={() => setEditing(null)} />}
    </div>
  );
}

function SlotSheet({ date, slot, onClose }: { date: string; slot?: Availability; onClose: () => void }) {
  const profile = usePlayerProfile();
  const toLocal = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
  const [form, setForm] = useState({
    date, start: slot ? toLocal(slot.start_at) : "06:30", end: slot ? toLocal(slot.end_at) : "11:00",
    status: (slot?.status ?? "available") as S<"AvailabilityStatus">, travel: slot?.max_travel_km ?? 10,
    label: slot?.location_label ?? "", repeat: 0,
    loc: (slot ? { lat: slot.lat, lng: slot.lng } : null) as LatLng | null,
  });
  const [error, setError] = useState<string | null>(null);
  const startIso = new Date(`${form.date}T${form.start}`).toISOString();
  const endIso = new Date(`${form.date}T${form.end}`).toISOString();
  const opts = { invalidate: [["availability"], ["dashboard"]], silent: true, onSuccess: onClose };
  const onErr = (e: unknown) => setError(e instanceof ApiError ? (e.code === "AVAILABILITY_CONFLICT" ? "This overlaps another slot you've already added." : e.message) : "Something went wrong");
  const save = useAction(async () => {
    const loc = form.loc ?? (profile.data?.home_location as LatLng | null) ?? null;
    if (slot) return availability.update(slot.id, { start_at: startIso, end_at: endIso, status: form.status, max_travel_km: form.travel, location_label: form.label || null, ...(form.loc ? { location: form.loc } : {}) });
    return availability.create({ start_at: startIso, end_at: endIso, timezone: TZ, status: form.status, max_travel_km: form.travel, location_label: form.label || null, location: loc, repeat_weeks: form.repeat });
  }, { ...opts, success: slot ? "Slot updated" : "Availability added" });
  const remove = useAction(() => availability.remove(slot!.id), { ...opts, success: "Slot removed" });
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={slot ? "Edit availability" : "Add availability"}
      footer={<div className="flex gap-2">{slot && <Button variant="danger" icon={<Trash2 className="size-4" />} loading={remove.isPending} onClick={() => remove.mutate(undefined)}>Delete</Button>}
        <Button className="flex-1" size="lg" loading={save.isPending} disabled={form.end <= form.start} onClick={() => { setError(null); save.mutate(undefined, { onError: onErr }); }}>Save</Button></div>}>
      <div className="space-y-4">
        <Segmented label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })} options={[{ value: "available", label: "Available" }, { value: "tentative", label: "Tentative" }, { value: "unavailable", label: "Busy" }]} />
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">{(id) => <Input id={id} type="date" value={form.date} min={dayKey(new Date())} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
          <Field label="From">{(id) => <Input id={id} type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />}</Field>
          <Field label="To" error={form.end <= form.start ? "After start" : undefined}>{(id) => <Input id={id} type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max travel">{(id) => <Select id={id} value={form.travel} onChange={(e) => setForm({ ...form, travel: Number(e.target.value) })}>{[5, 10, 15, 20, 30].map((k) => <option key={k} value={k}>{k} km</option>)}</Select>}</Field>
          {!slot && <Field label="Repeat weekly">{(id) => <Select id={id} value={form.repeat} onChange={(e) => setForm({ ...form, repeat: Number(e.target.value) })}><option value={0}>Just once</option>{[1, 2, 3, 4, 6, 8].map((w) => <option key={w} value={w}>+{w} weeks</option>)}</Select>}</Field>}
        </div>
        <Field label="Preferred area" optional hint="Leave the map empty to use your profile location">{(id) => <Input id={id} placeholder="e.g. Sector 62" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />}</Field>
        <LocationPicker value={form.loc} onChange={(loc) => setForm({ ...form, loc })} radiusKm={form.travel} height={200} />
        {error && <p role="alert" className="rounded-2xl bg-ball-50 p-3 text-sm text-ball-600">{error}</p>}
      </div>
    </Sheet>
  );
}
