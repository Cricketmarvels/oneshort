import { formatDateTime, formatPaise, MATCH_CATEGORIES, MATCH_FORMATS, PLAYING_ROLES, ROLE_LABELS, ROLE_SHORT, SEARCH_RADII_KM, timeRange, type PlayingRole, type S } from "@cm/shared";
import { Compass, MapPin, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

import { type LatLng, LocationPicker } from "@/components/maps/LocationPicker";
import { PageHeader } from "@/components/layout/PageHeader";
import { RatingPill } from "@/components/players/Rating";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented, ToggleChip } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, ErrorState, ListSkeleton } from "@/components/ui/states";
import { matches, usePlayerProfile, useFindTeams } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

export function FindTeamPage() {
  const profile = usePlayerProfile();
  const [radius, setRadius] = useState<(typeof SEARCH_RADII_KM)[number]>(10);
  const [role, setRole] = useState<PlayingRole | null>(null);
  const [format, setFormat] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [maxFee, setMaxFee] = useState<string>("");
  const [date, setDate] = useState("");
  const [mySlots, setMySlots] = useState(false);
  const [loc, setLoc] = useState<LatLng | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [page, setPage] = useState(1);
  const [joining, setJoining] = useState<S<"OpportunityOut"> | null>(null);

  const body = useMemo<S<"TeamSearchIn">>(() => ({
    radius_km: radius, role, page, page_size: 20, use_my_availability: mySlots,
    format: (format || null) as S<"MatchFormat"> | null, category: (category || null) as S<"MatchCategory"> | null,
    max_fee_paise: maxFee ? Number(maxFee) * 100 : null,
    location: loc, start_at: date ? new Date(`${date}T00:00`).toISOString() : null, end_at: date ? new Date(`${date}T23:59`).toISOString() : null,
  }), [radius, role, page, mySlots, format, category, maxFee, loc, date]);
  const hasLocation = !!loc || !!profile.data?.home_location;
  const results = useFindTeams(hasLocation ? body : null);

  return (
    <div>
      <PageHeader title="Find a Team" back subtitle="Open matches near you that need players." />
      <Card className="space-y-4 p-5">
        <Segmented label="Search radius" value={radius} onChange={(v) => { setRadius(v); setPage(1); }} options={SEARCH_RADII_KM.map((r) => ({ value: r, label: `${r} km` }))} />
        <div className="flex flex-wrap gap-2">
          {PLAYING_ROLES.map((r) => <ToggleChip key={r} selected={role === r} onClick={() => setRole(role === r ? null : r)}>{ROLE_LABELS[r]}</ToggleChip>)}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Format">{(id) => <Select id={id} value={format} onChange={(e) => setFormat(e.target.value)}><option value="">Any</option>{MATCH_FORMATS.map((f) => <option key={f}>{f}</option>)}</Select>}</Field>
          <Field label="Category">{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Any</option>{MATCH_CATEGORIES.map((c) => <option key={c} value={c}>{c[0]!.toUpperCase() + c.slice(1)}</option>)}</Select>}</Field>
          <Field label="Max fee (₹)">{(id) => <Input id={id} inputMode="numeric" placeholder="Any" value={maxFee} onChange={(e) => setMaxFee(e.target.value.replace(/\D/g, ""))} />}</Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-5 accent-brand-700" checked={mySlots} onChange={(e) => setMySlots(e.target.checked)} /> Only when I'm available</label>
          <button type="button" className="flex items-center gap-1 text-sm font-semibold text-brand-700" onClick={() => setShowMap(!showMap)}><MapPin className="size-4" />{loc ? "Searching a custom area" : "Search a different area"}</button>
        </div>
        {(showMap || !hasLocation) && <LocationPicker value={loc} onChange={setLoc} radiusKm={radius} height={220} />}
      </Card>

      <div className="mt-6">
        {!hasLocation ? <EmptyState icon={<MapPin />} title="Where do you play?" body="Share your location or drop a pin to see nearby matches." />
          : results.isPending ? <ListSkeleton rows={4} /> : results.isError ? <ErrorState error={results.error} onRetry={() => void results.refetch()} />
          : results.data.data.length === 0 ? <EmptyState icon={<Compass />} title="No open matches nearby" body="Widen the radius or try another date. You can also add availability so captains find you." action={<Link to="/availability"><Button variant="soft">Add availability</Button></Link>} />
          : (
            <div className="space-y-3">
              <p className="text-sm text-ink-500" aria-live="polite"><strong className="text-ink-900">{results.data.meta.total}</strong> match{results.data.meta.total === 1 ? "" : "es"} within {radius} km</p>
              {results.data.data.map((o) => <OpportunityCard key={o.match_id} o={o} onJoin={() => setJoining(o)} />)}
              <div className="flex justify-between pt-2">
                <Button variant="secondary" size="sm" disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="secondary" size="sm" disabled={!results.data.meta.has_next} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          )}
      </div>
      {joining && <JoinSheet o={joining} defaultRole={role ?? profile.data?.primary_role ?? null} onClose={() => setJoining(null)} />}
    </div>
  );
}

function OpportunityCard({ o, onJoin }: { o: S<"OpportunityOut">; onJoin: () => void }) {
  const needed = Object.entries(o.roles_needed).filter(([, n]) => n > 0) as [PlayingRole, number][];
  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Avatar name={o.team.team_name} src={o.team.logo} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Link to={`/teams/${o.team.id}`} className="block truncate font-semibold hover:underline">{o.team.team_name}</Link>
              <Link to={`/matches/${o.match_id}`} className="block truncate text-sm text-ink-700 hover:underline">{o.title}</Link>
            </div>
            <span className="shrink-0 text-sm font-semibold text-ink-700">~{o.approx_distance_km} km</span>
          </div>
          <p className="mt-1 text-sm text-ink-500">{formatDateTime(o.start_at, o.timezone, { hour: undefined, minute: undefined })} · {timeRange(o.start_at, o.end_at, o.timezone)} · {o.area}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{o.format}</Badge><Badge>{o.category}</Badge>
            <Badge tone="info"><Users className="size-3" />{o.vacancies} open</Badge>
            {o.per_head_fee_paise > 0 && <Badge>~{formatPaise(o.per_head_fee_paise)}/head</Badge>}
            {needed.map(([r, n]) => <Badge key={r} tone="warning">{n} {ROLE_SHORT[r]}</Badge>)}
          </div>
          <div className="mt-2 flex items-center gap-2 text-sm text-ink-500">
            Captain {o.team.captain.full_name} <RatingPill value={o.team.captain_rating} />
          </div>
        </div>
      </div>
      <div className="mt-3 flex justify-end border-t border-sand-200 pt-3">
        {o.my_status ? <StatusBadge status={o.my_status} label={o.my_status === "pending" ? "Request sent" : o.my_status} /> : <Button size="sm" onClick={onJoin}>Request to join</Button>}
      </div>
    </Card>
  );
}

function JoinSheet({ o, defaultRole, onClose }: { o: S<"OpportunityOut">; defaultRole: PlayingRole | null; onClose: () => void }) {
  const [role, setRole] = useState<PlayingRole | null>(defaultRole);
  const [msg, setMsg] = useState("");
  const join = useAction(() => matches.joinRequest(o.match_id, { commitment: "confirmed", proposed_role: role, message: msg || null }), {
    invalidate: [["discovery"], ["invitations"]], success: "Request sent! The captain has been notified.", onSuccess: onClose,
  });
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={`Join ${o.team.team_name}`} description={`${o.title} · ${formatDateTime(o.start_at, o.timezone)}`}
      footer={<Button block size="lg" icon={<Search className="hidden" />} loading={join.isPending} onClick={() => join.mutate(undefined)}>Send request</Button>}>
      <div className="space-y-4">
        <p className="rounded-2xl bg-sand-100 p-3 text-sm text-ink-700">
          {o.default_contribution_type === "payee" ? <>This is a <strong>payee</strong> spot: you'd share match expenses (about {formatPaise(o.per_head_fee_paise)}). Payments are made directly to the captain.</> : <>This is a <strong>non-payee</strong> spot: no contribution required.</>}
        </p>
        <div><p className="mb-2 text-sm font-medium text-ink-700">I'd play as</p>
          <div className="flex flex-wrap gap-2">{PLAYING_ROLES.map((r) => <ToggleChip key={r} selected={role === r} onClick={() => setRole(r)}>{ROLE_LABELS[r]}</ToggleChip>)}</div>
        </div>
        <Field label="Message to the captain" optional>{(id) => <Textarea id={id} maxLength={200} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Opening bat, can keep if needed." />}</Field>
      </div>
    </Sheet>
  );
}
