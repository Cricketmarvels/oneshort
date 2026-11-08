import { formatDay, formatPaise, MATCH_LIFECYCLE, MATCH_STATUS_LABELS, timeRange, type Match, type S } from "@cm/shared";
import { CalendarClock, CircleDollarSign, Flag, Lock, MapPin, MessageCircle, Share2, Star, UserPlus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { SquadComposition } from "@/components/matches/SquadComposition";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { QueryState, Spinner } from "@/components/ui/states";
import { matches, useMatch, useRoster } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";
import { cn } from "@/utils/cn";

const NEXT_LABEL: Partial<Record<string, string>> = {
  published: "Publish", recruiting: "Open recruitment", squad_confirmed: "Confirm squad", scheduled: "Mark scheduled", in_progress: "Start match",
};

export function MatchDetailPage() {
  const { id = "" } = useParams();
  const q = useMatch(id);
  return <QueryState query={q} skeleton={<Spinner />}>{(m) => <MatchDetail m={m} />}</QueryState>;
}

function MatchDetail({ m }: { m: Match }) {
  const manager = m.viewer_relation === "manager";
  const inSquad = m.viewer_relation === "roster" || manager;
  const roster = useRoster(m.id, inSquad);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const inv = [["matches"], ["roster"], ["dashboard"]];
  const transition = useAction((b: S<"TransitionIn">) => matches.transition(m.id, b), { invalidate: inv, success: (r) => `Match is now ${MATCH_STATUS_LABELS[r.match_status].toLowerCase()}` });
  const withdraw = useAction(() => matches.withdraw(m.id), { invalidate: inv, success: "You've withdrawn from the squad" });
  const terminal = m.match_status === "completed" || m.match_status === "cancelled";
  const forward = m.allowed_transitions.filter((t) => t !== "cancelled" && t !== "completed" && t !== "recruiting" || (t === "recruiting" && m.match_status === "published"));
  const stepIndex = MATCH_LIFECYCLE.indexOf(m.match_status);
  const share = `${m.title} · ${m.team_name}\n${formatDay(m.start_at, m.timezone)}, ${timeRange(m.start_at, m.end_at, m.timezone)}\n${m.venue.area}, ${m.venue.city}\nMatch ID ${m.match_code}`;

  return (
    <div className="space-y-5">
      <PageHeader back title={m.title} subtitle={<span className="flex flex-wrap items-center gap-2">
        <Link to={`/teams/${m.team_id}`} className="font-semibold text-brand-700">{m.team_name}</Link>
        <span className="font-mono text-xs text-ink-400">{m.match_code}</span>
      </span>} action={<StatusBadge status={m.match_status} label={MATCH_STATUS_LABELS[m.match_status]} />} />

      {m.match_status !== "cancelled" && (
        <ol className="no-scrollbar flex gap-1 overflow-x-auto" aria-label="Match lifecycle">
          {MATCH_LIFECYCLE.map((s, i) => (
            <li key={s} className="min-w-20 flex-1">
              <div className={cn("h-1.5 rounded-full", i <= stepIndex ? "bg-brand-600" : "bg-sand-300")} />
              <span className={cn("mt-1 block text-[11px]", i === stepIndex ? "font-bold text-brand-800" : "text-ink-400")} aria-current={i === stepIndex ? "step" : undefined}>{MATCH_STATUS_LABELS[s]}</span>
            </li>
          ))}
        </ol>
      )}
      {m.match_status === "cancelled" && <Card className="bg-ball-50 p-4 text-sm text-ball-600 ring-ball-500/20"><strong>Cancelled.</strong> {m.cancelled_reason}</Card>}

      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <div className="space-y-5">
          <Card className="space-y-3 p-5">
            <Row icon={<CalendarClock />} title={formatDay(m.start_at, m.timezone)} sub={`${timeRange(m.start_at, m.end_at, m.timezone)}${m.reschedule_count ? ` · rescheduled ${m.reschedule_count}×` : ""}`} />
            <Row icon={m.venue.restricted ? <Lock /> : <MapPin />} title={m.venue.name ?? `${m.venue.area}, ${m.venue.city}`}
              sub={m.venue.restricted ? "Exact venue is shared once you're in the squad" : `${m.venue.address ?? ""} ${m.venue.area}, ${m.venue.city}`} />
            {!m.venue.restricted && m.venue.lat && <a className="ml-12 text-sm font-semibold text-brand-700" target="_blank" rel="noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${m.venue.lat},${m.venue.lng}`}>Open in Maps →</a>}
            <Row icon={<CircleDollarSign />} title={m.per_head_fee_paise ? `~${formatPaise(m.per_head_fee_paise)} per player` : "No fee estimate"}
              sub={m.my_contribution_type ? `You're a ${m.my_contribution_type === "payee" ? "payee" : "non-payee"}` : `Default: ${m.default_contribution_type === "payee" ? "payee" : "non-payee"}`} />
            <div className="flex flex-wrap gap-1.5 pl-12"><Badge tone="brand">{m.format}</Badge><Badge>{m.category}</Badge></div>
            {m.description && <p className="rounded-2xl bg-sand-100 p-3 text-sm text-ink-700">{m.description}</p>}
          </Card>

          <Card className="p-5">
            <SectionHeader title="Squad" action={inSquad && <Link to={`/matches/${m.id}/squad`} className="text-sm font-semibold text-brand-700">{manager ? "Manage" : "View all"}</Link>} />
            <SquadComposition comp={m.composition} />
            {inSquad && roster.data && (
              <ul className="mt-4 flex flex-wrap gap-2">
                {roster.data.active.map((e) => (
                  <li key={e.player.id}><Link to={`/players/${e.player.id}`} className="flex items-center gap-2 rounded-full bg-sand-100 py-1 pl-1 pr-3 text-sm">
                    <Avatar name={e.player.full_name} src={e.player.profile_image} size="sm" />{e.player.full_name.split(" ")[0]}{e.is_captain && " (C)"}
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-3">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Avatar name={m.captain.full_name} src={m.captain.profile_image} />
              <div className="flex-1"><p className="text-xs text-ink-500">Captain</p><Link to={`/users/${m.captain.id}/reputation?type=captain`} className="font-semibold hover:underline">{m.captain.full_name}</Link></div>
            </div>
          </Card>
          {manager && !terminal && (
            <Card className="space-y-2 p-4">
              <p className="text-sm font-semibold text-ink-700">Captain actions</p>
              <Link to={`/matches/${m.id}/build`}><Button block icon={<UserPlus className="size-4" />}>Invite players</Button></Link>
              {forward.map((t) => NEXT_LABEL[t] && (
                <Button key={t} block variant="soft" loading={transition.isPending && transition.variables?.to === t}
                  onClick={() => transition.mutate({ to: t as S<"TransitionIn">["to"], allow_short_squad: t === "squad_confirmed" && m.composition.vacancies > 0 })}>
                  {NEXT_LABEL[t]}{t === "squad_confirmed" && m.composition.vacancies > 0 ? ` (${m.composition.confirmed_total}/${m.composition.capacity})` : ""}
                </Button>
              ))}
              {["scheduled", "in_progress"].includes(m.match_status) && <Button block variant="soft" icon={<Flag className="size-4" />} onClick={() => setCompleteOpen(true)}>Complete & mark attendance</Button>}
              <Button block variant="secondary" onClick={() => setRescheduleOpen(true)}>Reschedule</Button>
              <Button block variant="ghost" className="text-ball-600" onClick={() => setCancelOpen(true)}>Cancel match</Button>
            </Card>
          )}
          {inSquad && (
            <Link to={`/matches/${m.id}/fees`}><Button block variant="secondary" icon={<CircleDollarSign className="size-4" />}>{manager ? "Split a fee" : "Fees & payment"}</Button></Link>
          )}
          {m.match_status === "completed" && inSquad && <Link to={`/matches/${m.id}/rate`}><Button block variant="accent" icon={<Star className="size-4" />}>Rate players & captain</Button></Link>}
          {m.viewer_relation === "roster" && !terminal && <Button block variant="ghost" loading={withdraw.isPending} onClick={() => confirm("Withdraw from this match? The captain will be notified.") && withdraw.mutate(undefined)}>Withdraw from squad</Button>}
          {m.viewer_relation === "public" && ["published", "recruiting"].includes(m.match_status) && (
            <Link to="/discover/teams"><Button block icon={<Users className="size-4" />}>Request to join via Find a Team</Button></Link>
          )}
          <a href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer"><Button block variant="secondary" icon={<Share2 className="size-4" />}>Share on WhatsApp</Button></a>
          <Link to={`/report?user=${m.captain.id}&match=${m.id}`} className="flex items-center justify-center gap-1.5 pt-1 text-xs text-ink-400 hover:text-ball-600"><MessageCircle className="size-3.5" />Report a problem</Link>
        </div>
      </div>

      <CancelSheet open={cancelOpen} onClose={() => setCancelOpen(false)} id={m.id} />
      <RescheduleSheet open={rescheduleOpen} onClose={() => setRescheduleOpen(false)} m={m} />
      {completeOpen && roster.data && <CompleteSheet onClose={() => setCompleteOpen(false)} id={m.id} roster={roster.data} />}
    </div>
  );
}

function Row({ icon, title, sub }: { icon: React.ReactNode; title: string; sub?: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 [&>svg]:size-5">{icon}</span>
      <div><p className="font-semibold">{title}</p>{sub && <p className="text-sm text-ink-500">{sub}</p>}</div>
    </div>
  );
}

function CancelSheet({ open, onClose, id }: { open: boolean; onClose: () => void; id: string }) {
  const [reason, setReason] = useState("");
  const cancel = useAction(() => matches.cancel(id, reason), { invalidate: [["matches"], ["dashboard"]], success: "Match cancelled. Everyone has been notified.", onSuccess: onClose });
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title="Cancel match" description="All invited and confirmed players will be notified."
      footer={<Button block variant="danger" size="lg" disabled={reason.trim().length < 3} loading={cancel.isPending} onClick={() => cancel.mutate(undefined)}>Cancel match</Button>}>
      <Field label="Reason">{(fid) => <Input id={fid} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Ground waterlogged" />}</Field>
    </Sheet>
  );
}

function RescheduleSheet({ open, onClose, m }: { open: boolean; onClose: () => void; m: Match }) {
  const local = (iso: string) => { const d = new Date(iso); return { date: d.toLocaleDateString("en-CA"), time: d.toTimeString().slice(0, 5) }; };
  const [f, setF] = useState({ date: local(m.start_at).date, start: local(m.start_at).time, end: local(m.end_at).time, reason: "" });
  const save = useAction(() => matches.update(m.id, { start_at: new Date(`${f.date}T${f.start}`).toISOString(), end_at: new Date(`${f.date}T${f.end}`).toISOString(), reschedule_reason: f.reason || null }),
    { invalidate: [["matches"]], success: "Rescheduled. The squad has been notified.", onSuccess: onClose });
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()} title="Reschedule match"
      footer={<Button block size="lg" loading={save.isPending} disabled={f.end <= f.start} onClick={() => save.mutate(undefined)}>Save new time</Button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Date">{(id) => <Input id={id} type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />}</Field>
          <Field label="Start">{(id) => <Input id={id} type="time" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} />}</Field>
          <Field label="End">{(id) => <Input id={id} type="time" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} />}</Field>
        </div>
        <Field label="Reason" optional>{(id) => <Input id={id} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}</Field>
      </div>
    </Sheet>
  );
}

function CompleteSheet({ onClose, id, roster }: { onClose: () => void; id: string; roster: S<"RosterOut"> }) {
  const [att, setAtt] = useState<Record<string, S<"Attendance">>>(Object.fromEntries(roster.active.map((e) => [e.player.id, "present" as const])));
  const done = useAction(() => matches.complete(id, { attendance: Object.entries(att).map(([player_id, attendance]) => ({ player_id, attendance })) }),
    { invalidate: [["matches"], ["roster"], ["dashboard"]], success: "Match completed. Players can now rate each other.", onSuccess: onClose });
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title="Complete match" description="Attendance feeds each player's reliability score."
      footer={<Button block size="lg" loading={done.isPending} onClick={() => done.mutate(undefined)}>Complete match</Button>}>
      <ul className="divide-y divide-sand-200">
        {roster.active.map((e) => (
          <li key={e.player.id} className="flex items-center justify-between gap-3 py-2.5">
            <span className="flex items-center gap-2"><Avatar name={e.player.full_name} src={e.player.profile_image} size="sm" /><span className="text-sm font-medium">{e.player.full_name}</span></span>
            <Select aria-label={`Attendance for ${e.player.full_name}`} className="h-10 w-36" value={att[e.player.id]} onChange={(ev) => setAtt({ ...att, [e.player.id]: ev.target.value as S<"Attendance"> })}>
              <option value="present">Present</option><option value="late">Late</option><option value="no_show">No-show</option>
            </Select>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
