import { formatDateTime, PLAYING_ROLES, ROLE_LABELS, SEARCH_RADII_KM, type PlayingRole, type S } from "@cm/shared";
import { Search, Send, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { type LatLng, LocationPicker } from "@/components/maps/LocationPicker";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented, ToggleChip } from "@/components/ui/chip";
import { Field, Input, Select } from "@/components/ui/field";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/states";
import { matches as matchesApi, useFindPlayers, useMatches } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

import { PlayerResultCard } from "./PlayerResultCard";

type Selection = Record<string, S<"ContributionType">>;

export function FindPlayerPage() {
  const [params, setParams] = useSearchParams();
  const matchId = params.get("match") ?? "";
  const myMatches = useMatches({ role: "captain", when: "upcoming" });
  const recruitable = (myMatches.data?.data ?? []).filter((m) => ["published", "recruiting", "squad_confirmed", "scheduled"].includes(m.match_status));
  const match = recruitable.find((m) => m.id === matchId);

  const [radius, setRadius] = useState<(typeof SEARCH_RADII_KM)[number]>(10);
  const [roles, setRoles] = useState<PlayingRole[]>([]);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [partial, setPartial] = useState(false);
  const [adhoc, setAdhoc] = useState<{ date: string; start: string; end: string; loc: LatLng | null }>({ date: "", start: "07:00", end: "10:00", loc: null });
  const [page, setPage] = useState(1);
  const [submitted, setSubmitted] = useState(false);
  const [selected, setSelected] = useState<Selection>({});

  const body: S<"PlayerSearchIn"> | null = useMemo(() => {
    if (!submitted) return null;
    const common = { radius_km: radius, roles, min_rating: minRating, allow_partial: partial, include_tentative: true, page, page_size: 20 };
    if (matchId) return { match_id: matchId, ...common };
    if (!adhoc.date || !adhoc.loc) return null;
    return { ...common, start_at: new Date(`${adhoc.date}T${adhoc.start}`).toISOString(), end_at: new Date(`${adhoc.date}T${adhoc.end}`).toISOString(), location: adhoc.loc };
  }, [submitted, radius, roles, minRating, partial, page, matchId, adhoc]);
  const results = useFindPlayers(body);

  const invite = useAction(
    () => matchesApi.invite(matchId, { invites: Object.entries(selected).map(([player_id, contribution_type]) => ({ player_id, contribution_type })) }),
    { invalidate: [["discovery"], ["invitations"], ["matches"]],
      success: (r) => { const ok = r.filter((x) => x.ok).length; return `${ok} invitation${ok === 1 ? "" : "s"} sent${r.length > ok ? ` · ${r.length - ok} skipped` : ""}`; },
      onSuccess: () => setSelected({}) },
  );
  const toggle = (id: string) => setSelected((s) => { const n = { ...s }; if (n[id]) delete n[id]; else n[id] = match?.default_contribution_type ?? "payee"; return n; });
  const count = Object.keys(selected).length;

  return (
    <div className="pb-20">
      <PageHeader title="Find a Player" back subtitle="Available players near your venue, ranked by distance, availability, role fit and reputation." />
      <Card className="space-y-5 p-5">
        <Field label="Search for a match" hint={recruitable.length ? "Searching from a match uses its venue and timing." : "Create a match to invite players directly."}>
          {(id) => (
            <Select id={id} value={matchId} onChange={(e) => { setParams(e.target.value ? { match: e.target.value } : {}); setSubmitted(false); setSelected({}); }}>
              <option value="">Explore without a match</option>
              {recruitable.map((m) => <option key={m.id} value={m.id}>{m.title} · {formatDateTime(m.start_at, m.timezone)}</option>)}
            </Select>
          )}
        </Field>
        {!matchId && (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Date">{(id) => <Input id={id} type="date" value={adhoc.date} onChange={(e) => setAdhoc({ ...adhoc, date: e.target.value })} />}</Field>
              <Field label="Start">{(id) => <Input id={id} type="time" value={adhoc.start} onChange={(e) => setAdhoc({ ...adhoc, start: e.target.value })} />}</Field>
              <Field label="End">{(id) => <Input id={id} type="time" value={adhoc.end} onChange={(e) => setAdhoc({ ...adhoc, end: e.target.value })} />}</Field>
            </div>
            <p className="text-sm font-medium text-ink-700">Venue</p>
            <LocationPicker value={adhoc.loc} onChange={(loc) => setAdhoc({ ...adhoc, loc })} radiusKm={radius} height={220} />
          </div>
        )}
        <div>
          <p className="mb-2 text-sm font-medium text-ink-700">Search radius</p>
          <Segmented label="Search radius" value={radius} onChange={setRadius} options={SEARCH_RADII_KM.map((r) => ({ value: r, label: `${r} km` }))} />
        </div>
        <div>
          <p className="mb-2 text-sm font-medium text-ink-700">Roles needed</p>
          <div className="flex flex-wrap gap-2">
            {PLAYING_ROLES.map((r) => <ToggleChip key={r} selected={roles.includes(r)} onClick={() => setRoles(roles.includes(r) ? roles.filter((x) => x !== r) : [...roles, r])}>{ROLE_LABELS[r]}</ToggleChip>)}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Field label="Minimum rating" className="w-40">{(id) => (
            <Select id={id} value={minRating ?? ""} onChange={(e) => setMinRating(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Any</option><option value="3">3★+</option><option value="4">4★+</option><option value="4.5">4.5★+</option>
            </Select>)}
          </Field>
          <label className="mt-6 flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" className="size-5 accent-brand-700" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> Include partly available</label>
        </div>
        <Button block size="lg" icon={<Search className="size-5" />} disabled={!matchId && (!adhoc.date || !adhoc.loc)} onClick={() => { setPage(1); setSubmitted(true); }}>Search players</Button>
      </Card>

      <div className="mt-6">
        {!submitted ? null : results.isPending ? <ListSkeleton rows={4} /> : results.isError ? <ErrorState error={results.error} onRetry={() => void results.refetch()} /> : (
          <>
            <p className="mb-3 text-sm text-ink-500" aria-live="polite">
              <strong className="text-ink-900">{results.data.meta.total}</strong> available player{results.data.meta.total === 1 ? "" : "s"} within {results.data.meta.radius_km} km
              {match && <> · {match.composition.vacancies} spot{match.composition.vacancies === 1 ? "" : "s"} to fill</>}
            </p>
            {results.data.data.length === 0 ? (
              <EmptyState icon={<UserPlus />} title="No one available nearby yet" body="Try a wider radius, fewer role filters, or including partly available players." />
            ) : (
              <div className="space-y-3">
                {results.data.data.map((r) => <PlayerResultCard key={r.player.id} r={r} selectable={!!matchId} selected={!!selected[r.player.id]} onToggle={() => toggle(r.player.id)} />)}
                <div className="flex justify-between pt-2">
                  <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
                  <Button variant="secondary" size="sm" disabled={!results.data.meta.has_next} onClick={() => setPage(page + 1)}>Next</Button>
                </div>
              </div>
            )}
            {!matchId && results.data.data.length > 0 && (
              <p className="mt-4 text-center text-sm text-ink-500"><Link to="/matches/new" className="font-semibold text-brand-700">Create a match</Link> to invite these players.</p>
            )}
          </>
        )}
      </div>

      {count > 0 && (
        <div className="safe-bottom fixed inset-x-0 bottom-16 z-20 px-4 md:bottom-4 md:left-[17rem]">
          <Card className="mx-auto flex max-w-3xl flex-col gap-3 p-3 shadow-[var(--shadow-float)] sm:flex-row sm:items-center">
            <div className="flex-1 space-y-1.5">
              <p className="text-sm font-semibold">{count} selected</p>
              <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
                {Object.entries(selected).map(([id, ct]) => {
                  const name = results.data?.data.find((r) => r.player.id === id)?.player.full_name.split(" ")[0] ?? "Player";
                  return (
                    <button key={id} type="button" onClick={() => setSelected({ ...selected, [id]: ct === "payee" ? "non_payee" : "payee" })}
                      className="shrink-0 rounded-full bg-sand-100 px-2.5 py-1 text-xs font-medium ring-1 ring-sand-300" title="Tap to toggle payee / non-payee">
                      {name} · {ct === "payee" ? "Payee" : "Free"}
                    </button>
                  );
                })}
              </div>
            </div>
            <Button icon={<Send className="size-4" />} loading={invite.isPending} onClick={() => invite.mutate(undefined)}>Send {count} invite{count > 1 ? "s" : ""}</Button>
          </Card>
        </div>
      )}
    </div>
  );
}
