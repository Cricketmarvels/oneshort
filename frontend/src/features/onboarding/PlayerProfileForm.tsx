import { PLAYING_ROLES, ROLE_LABELS, type PlayerSelf, type PlayingRole, type S } from "@cm/shared";
import { useState } from "react";

import { type LatLng, LocationPicker } from "@/components/maps/LocationPicker";
import { ToggleChip } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export type PlayerForm = S<"PlayerProfileIn">;

const BOWLING: Array<[S<"BowlingStyle">, string]> = [
  ["none", "Doesn't bowl"], ["right_arm_fast", "Right-arm fast"], ["right_arm_medium", "Right-arm medium"],
  ["left_arm_fast", "Left-arm fast"], ["left_arm_medium", "Left-arm medium"], ["off_spin", "Off spin"],
  ["leg_spin", "Leg spin"], ["left_arm_orthodox", "Left-arm orthodox"], ["left_arm_wrist_spin", "Left-arm wrist spin"],
];
const DAYS: S<"Weekday">[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const TIMES: S<"TimeOfDay">[] = ["morning", "afternoon", "evening", "night"];
const FORMATS: S<"MatchFormat">[] = ["T10", "T20", "ODI", "OTHER"];

export function initialPlayerForm(p?: PlayerSelf | null): PlayerForm {
  return {
    primary_role: p?.primary_role ?? "batsman",
    secondary_roles: p?.secondary_roles ?? [],
    batting_style: p?.batting_style ?? "right_hand",
    bowling_style: p?.bowling_style ?? "none",
    experience_years: p?.experience_years ?? null,
    preferred_formats: p?.preferred_formats ?? ["T20"],
    preferred_days: p?.preferred_days ?? ["sat", "sun"],
    preferred_timing: p?.preferred_timing ?? ["morning"],
    cricheroes_url: p?.cricheroes_url ?? null,
    previous_teams: p?.previous_teams ?? [],
    bio: p?.bio ?? null,
    home_location: p?.home_location ?? null,
    availability_visibility: p?.availability_visibility ?? "discoverable",
  };
}

function toggle<T>(list: T[] | undefined, v: T): T[] {
  const l = list ?? [];
  return l.includes(v) ? l.filter((x) => x !== v) : [...l, v];
}

export function RoleSection({ form, set }: { form: PlayerForm; set: (p: Partial<PlayerForm>) => void }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-sm font-medium text-ink-700">Primary role</p>
        <div className="grid grid-cols-2 gap-2">
          {PLAYING_ROLES.map((r) => (
            <button key={r} type="button" aria-pressed={form.primary_role === r}
              onClick={() => set({ primary_role: r, secondary_roles: (form.secondary_roles ?? []).filter((x) => x !== r) })}
              className={`rounded-2xl p-4 text-left ring-1 transition ${form.primary_role === r ? "bg-brand-800 text-white ring-brand-800" : "bg-white ring-sand-300 hover:ring-brand-300"}`}>
              <span className="font-display font-bold">{ROLE_LABELS[r]}</span>
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium text-ink-700">Secondary skills <span className="text-ink-400">(optional)</span></p>
        <div className="flex flex-wrap gap-2">
          {PLAYING_ROLES.filter((r) => r !== form.primary_role).map((r: PlayingRole) => (
            <ToggleChip key={r} selected={(form.secondary_roles ?? []).includes(r)} onClick={() => set({ secondary_roles: toggle(form.secondary_roles, r) })}>{ROLE_LABELS[r]}</ToggleChip>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Batting">{(id) => (
          <Select id={id} value={form.batting_style ?? ""} onChange={(e) => set({ batting_style: e.target.value as S<"BattingStyle"> })}>
            <option value="right_hand">Right-hand bat</option><option value="left_hand">Left-hand bat</option>
          </Select>)}
        </Field>
        <Field label="Bowling">{(id) => (
          <Select id={id} value={form.bowling_style ?? "none"} onChange={(e) => set({ bowling_style: e.target.value as S<"BowlingStyle"> })}>
            {BOWLING.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>)}
        </Field>
        <Field label="Years playing" optional>{(id) => (
          <Input id={id} type="number" min={0} max={60} value={form.experience_years ?? ""} onChange={(e) => set({ experience_years: e.target.value === "" ? null : Number(e.target.value) })} />)}
        </Field>
      </div>
    </div>
  );
}

export function PreferencesSection({ form, set }: { form: PlayerForm; set: (p: Partial<PlayerForm>) => void }) {
  const [teams, setTeams] = useState((form.previous_teams ?? []).join(", "));
  return (
    <div className="space-y-5">
      <div><p className="mb-2 text-sm font-medium text-ink-700">Formats</p>
        <div className="flex flex-wrap gap-2">{FORMATS.map((f) => <ToggleChip key={f} selected={(form.preferred_formats ?? []).includes(f)} onClick={() => set({ preferred_formats: toggle(form.preferred_formats, f) })}>{f === "OTHER" ? "Other" : f}</ToggleChip>)}</div>
      </div>
      <div><p className="mb-2 text-sm font-medium text-ink-700">Days</p>
        <div className="flex flex-wrap gap-2">{DAYS.map((d) => <ToggleChip key={d} className="w-14 justify-center px-0" selected={(form.preferred_days ?? []).includes(d)} onClick={() => set({ preferred_days: toggle(form.preferred_days, d) })}>{d[0]!.toUpperCase() + d.slice(1)}</ToggleChip>)}</div>
      </div>
      <div><p className="mb-2 text-sm font-medium text-ink-700">Timing</p>
        <div className="flex flex-wrap gap-2">{TIMES.map((t) => <ToggleChip key={t} selected={(form.preferred_timing ?? []).includes(t)} onClick={() => set({ preferred_timing: toggle(form.preferred_timing, t) })}>{t[0]!.toUpperCase() + t.slice(1)}</ToggleChip>)}</div>
      </div>
      <Field label="CricHeroes profile" optional>{(id) => <Input id={id} type="url" placeholder="https://cricheroes.com/player-profile/…" value={form.cricheroes_url ?? ""} onChange={(e) => set({ cricheroes_url: e.target.value || null })} />}</Field>
      <Field label="Previous teams" optional hint="Comma separated">{(id) => <Input id={id} value={teams} onChange={(e) => { setTeams(e.target.value); set({ previous_teams: e.target.value.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10) }); }} />}</Field>
      <Field label="Bio" optional>{(id) => <Textarea id={id} maxLength={2000} placeholder="Opening bat, loves the short ball…" value={form.bio ?? ""} onChange={(e) => set({ bio: e.target.value || null })} />}</Field>
    </div>
  );
}

export function LocationSection({ form, set }: { form: PlayerForm; set: (p: Partial<PlayerForm>) => void }) {
  return (
    <div className="space-y-4">
      <p className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-900">
        <strong>Your exact location is never shown to anyone.</strong> We only use it to tell captains you're "about 3 km away" and to show you nearby matches.
      </p>
      <LocationPicker value={form.home_location as LatLng | null} onChange={(p) => set({ home_location: p })} />
      <label className="flex items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-sand-300">
        <input type="checkbox" className="mt-1 size-5 accent-brand-700" checked={form.availability_visibility === "discoverable"}
          onChange={(e) => set({ availability_visibility: e.target.checked ? "discoverable" : "private" })} />
        <span className="text-sm text-ink-700"><strong className="text-ink-900">Let nearby captains find me</strong><br />Turn off to keep your availability private.</span>
      </label>
    </div>
  );
}
