import { DEFAULT_CITY, formatPaise, MATCH_CATEGORIES, MATCH_FORMATS, PLAYING_ROLES, ROLE_LABELS, rupeesToPaise, type S } from "@cm/shared";
import { Minus, Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { type VenueValue, VenuePicker } from "@/components/maps/VenuePicker";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { EmptyState, Spinner } from "@/components/ui/states";
import { ApiError } from "@/services/api/client";
import { matches, useTeams } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";

export function CreateMatchPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const teams = useTeams("mine");
  const [f, setF] = useState({
    team_id: params.get("team") ?? "", title: "Sunday Morning T20", description: "", date: "", start: "07:00", end: "10:00",
    format: "T20" as S<"MatchFormat">, category: "friendly" as S<"MatchCategory">, capacity: 11,
    roles: { batsman: 4, bowler: 3, wicketkeeper: 1, all_rounder: 3 } as Record<string, number>,
    expenses: "", payee: "payee" as S<"ContributionType">, captain_plays: true,
  });
  const [venue, setVenue] = useState<VenueValue>({ name: "", address: "", area: "", city: DEFAULT_CITY, location: null });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const roleTotal = Object.values(f.roles).reduce((a, b) => a + b, 0);
  const expensesPaise = f.expenses ? rupeesToPaise(f.expenses) : 0;

  const create = useAction(() => matches.create({
    team_id: f.team_id, title: f.title, description: f.description || null,
    venue: { name: venue.name, address: venue.address || null, area: venue.area, city: venue.city },
    location: venue.location!, start_at: new Date(`${f.date}T${f.start}`).toISOString(), end_at: new Date(`${f.date}T${f.end}`).toISOString(),
    timezone: TZ, format: f.format, category: f.category, squad_capacity: f.capacity,
    required_roles: f.roles as S<"RequiredRoles">, estimated_expenses_paise: expensesPaise, default_contribution_type: f.payee,
    captain_plays: f.captain_plays, publish: true,
  }), { invalidate: [["matches"], ["dashboard"], ["teams"]], success: "Match created", silent: true,
    onSuccess: (m) => nav(`/matches/${m.id}/build`, { replace: true }) });

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.team_id) e.team = "Choose a team";
    if (!f.date) e.date = "Pick a date";
    if (f.end <= f.start) e.end = "End must be after start";
    if (!venue.location || !venue.name || !venue.area) e.venue = "Choose a venue and fill name and area";
    if (roleTotal > f.capacity) e.roles = `Composition (${roleTotal}) exceeds squad size (${f.capacity})`;
    if (Number.isNaN(expensesPaise)) e.expenses = "Enter a valid amount";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  if (teams.isPending) return <Spinner />;
  const myTeams = teams.data?.data ?? [];
  if (!myTeams.length) {
    return <EmptyState icon={<Users />} title="Create a team first" body="Matches belong to a team you captain." action={<Link to="/teams/new"><Button>Create a team</Button></Link>} />;
  }
  const stepRole = (r: string, d: number) => setF({ ...f, roles: { ...f.roles, [r]: Math.max(0, (f.roles[r] ?? 0) + d) } });

  return (
    <div className="space-y-5 pb-8">
      <PageHeader title="Build a Team" back subtitle="Create a match, then invite players." />
      <Card className="space-y-4 p-5">
        <SectionHeader title="Match details" />
        <Field label="Team" error={errors.team}>{(id) => (
          <Select id={id} value={f.team_id} onChange={(e) => setF({ ...f, team_id: e.target.value })}>
            <option value="">Choose a team</option>{myTeams.map((t) => <option key={t.id} value={t.id}>{t.team_name}</option>)}
          </Select>)}
        </Field>
        <Field label="Title">{(id) => <Input id={id} maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}</Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date" error={errors.date}>{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Start">{(id) => <Input id={id} type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}</Field>
          <Field label="End" error={errors.end}>{(id) => <Input id={id} type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />}</Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Format">{(id) => <Select id={id} value={f.format} onChange={(e) => setF({ ...f, format: e.target.value as S<"MatchFormat"> })}>{MATCH_FORMATS.map((x) => <option key={x}>{x}</option>)}</Select>}</Field>
          <Field label="Category">{(id) => <Select id={id} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value as S<"MatchCategory"> })}>{MATCH_CATEGORIES.map((x) => <option key={x} value={x}>{x[0]!.toUpperCase() + x.slice(1)}</option>)}</Select>}</Field>
        </div>
        <Field label="Description" optional>{(id) => <Textarea id={id} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Tennis ball, 16 overs a side…" />}</Field>
      </Card>

      <Card className="space-y-3 p-5">
        <SectionHeader title="Venue" subtitle="The exact address is only shared with your squad." />
        <VenuePicker value={venue} onChange={setVenue} />
        {errors.venue && <p role="alert" className="text-sm text-ball-600">{errors.venue}</p>}
      </Card>

      <Card className="space-y-4 p-5">
        <SectionHeader title="Squad" />
        <Field label="Players needed (incl. you if playing)">{(id) => <Input id={id} type="number" min={2} max={22} value={f.capacity} onChange={(e) => setF({ ...f, capacity: Math.min(22, Math.max(2, Number(e.target.value) || 2)) })} />}</Field>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {PLAYING_ROLES.map((r) => (
            <div key={r} className="rounded-2xl bg-sand-100 p-3">
              <p className="text-xs font-semibold text-ink-500">{ROLE_LABELS[r]}</p>
              <div className="mt-1 flex items-center justify-between">
                <button type="button" aria-label={`Fewer ${ROLE_LABELS[r]}`} onClick={() => stepRole(r, -1)} className="rounded-lg bg-white p-1.5 ring-1 ring-sand-300"><Minus className="size-4" /></button>
                <span className="tabular text-xl font-bold">{f.roles[r]}</span>
                <button type="button" aria-label={`More ${ROLE_LABELS[r]}`} onClick={() => stepRole(r, 1)} className="rounded-lg bg-white p-1.5 ring-1 ring-sand-300"><Plus className="size-4" /></button>
              </div>
            </div>
          ))}
        </div>
        <p className={`text-sm ${errors.roles ? "text-ball-600" : "text-ink-500"}`}>{errors.roles ?? `Composition: ${roleTotal} of ${f.capacity}`}</p>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5 accent-brand-700" checked={f.captain_plays} onChange={(e) => setF({ ...f, captain_plays: e.target.checked })} /> I'm playing in this match</label>
      </Card>

      <Card className="space-y-4 p-5">
        <SectionHeader title="Fees" subtitle="Estimate only. You'll record actual expenses in Split a Fee." />
        <Field label="Estimated total expenses (₹)" error={errors.expenses} hint={expensesPaise > 0 ? `≈ ${formatPaise(Math.ceil(expensesPaise / f.capacity / 100) * 100)} per player` : undefined}>
          {(id) => <Input id={id} inputMode="decimal" placeholder="4000" value={f.expenses} onChange={(e) => setF({ ...f, expenses: e.target.value })} />}
        </Field>
        <div><p className="mb-2 text-sm font-medium text-ink-700">Default for invited players</p>
          <Segmented label="Default contribution" value={f.payee} onChange={(payee) => setF({ ...f, payee })} options={[{ value: "payee", label: "Payee (shares cost)" }, { value: "non_payee", label: "Non-payee (free)" }]} />
        </div>
      </Card>
      {create.error instanceof ApiError && <p role="alert" className="rounded-2xl bg-ball-50 p-3 text-sm text-ball-600">{create.error.message}</p>}
      <Button block size="lg" loading={create.isPending} onClick={() => validate() && create.mutate(undefined)}>Create match & invite players</Button>
    </div>
  );
}
