import { PLAYING_ROLES, ROLE_LABELS, type PlayingRole, type S } from "@cm/shared";
import { MoreVertical, RefreshCw, UserMinus } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { SquadComposition } from "@/components/matches/SquadComposition";
import { RatingPill, ReliabilityMeter } from "@/components/players/Rating";
import { RoleBadge } from "@/components/players/RoleBadge";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { QueryState, Spinner } from "@/components/ui/states";
import { matches, useRoster, useSuggestions } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

export function SquadPage() {
  const { id = "" } = useParams();
  const q = useRoster(id);
  const [editing, setEditing] = useState<S<"RosterEntryOut"> | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader back={`/matches/${id}`} title="Squad" />
      <QueryState query={q} skeleton={<Spinner />}>
        {(r) => (
          <>
            <Card className="p-5"><SquadComposition comp={r.composition} /></Card>
            <section>
              <SectionHeader title={`Confirmed (${r.active.length})`} action={r.can_manage && <Link to={`/matches/${id}/build`} className="text-sm font-semibold text-brand-700">Invite more</Link>} />
              <Card className="divide-y divide-sand-200">
                {r.active.map((e) => (
                  <div key={e.player.id} className="flex items-center gap-3 p-3.5">
                    <Avatar name={e.player.full_name} src={e.player.profile_image} />
                    <div className="min-w-0 flex-1">
                      <Link to={`/players/${e.player.id}`} className="font-semibold hover:underline">{e.player.full_name}{e.is_captain && <span className="ml-1 text-ball-500">(C)</span>}</Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {e.assigned_role && <RoleBadge role={e.assigned_role} short />}
                        <Badge tone={e.contribution_type === "payee" ? "info" : "neutral"}>{e.contribution_type === "payee" ? "Payee" : "Non-payee"}</Badge>
                        {e.is_substitute && <Badge tone="warning">Sub</Badge>}
                        {e.attendance && <StatusBadge status={e.attendance === "present" ? "confirmed" : e.attendance === "late" ? "tentative" : "cancelled"} label={e.attendance.replace("_", "-")} />}
                      </div>
                    </div>
                    <div className="hidden text-right sm:block"><RatingPill value={e.average_rating} />{e.reliability_score != null && <ReliabilityMeter score={e.reliability_score} compact />}</div>
                    {r.can_manage && !e.is_captain && (
                      <Button variant="ghost" size="icon" aria-label={`Manage ${e.player.full_name}`} onClick={() => setEditing(e)}><MoreVertical className="size-5" /></Button>
                    )}
                  </div>
                ))}
              </Card>
            </section>
            {r.history.length > 0 && (
              <section>
                <SectionHeader title="Changes" />
                <Card className="divide-y divide-sand-200">
                  {r.history.map((e) => (
                    <div key={`${e.player.id}-${e.status}`} className="flex items-center gap-3 p-3 text-sm">
                      <Avatar name={e.player.full_name} src={e.player.profile_image} size="sm" />
                      <span className="flex-1">{e.player.full_name}</span><StatusBadge status="cancelled" label={e.status} />
                    </div>
                  ))}
                </Card>
              </section>
            )}
            {editing && <SeatSheet matchId={id} entry={editing} onClose={() => setEditing(null)} />}
          </>
        )}
      </QueryState>
    </div>
  );
}

function SeatSheet({ matchId, entry, onClose }: { matchId: string; entry: S<"RosterEntryOut">; onClose: () => void }) {
  const [role, setRole] = useState<PlayingRole | "">(entry.assigned_role ?? "");
  const [ct, setCt] = useState(entry.contribution_type);
  const [mode, setMode] = useState<"edit" | "replace" | "remove">("edit");
  const [replacement, setReplacement] = useState("");
  const [reason, setReason] = useState("");
  const members = useSuggestions(matchId, "members", undefined, mode === "replace");
  const inv = [["roster"], ["matches"], ["invitations"]];
  const save = useAction(() => matches.updateSeat(matchId, entry.player.id, { assigned_role: role || null, contribution_type: ct }), { invalidate: inv, success: "Updated", onSuccess: onClose });
  const remove = useAction(() => matches.updateSeat(matchId, entry.player.id, { status: "removed", reason: reason || null }), { invalidate: inv, success: "Player removed from squad", onSuccess: onClose });
  const replace = useAction(() => matches.replace(matchId, entry.player.id, { replacement_player_id: replacement, reason: reason || null }), {
    invalidate: inv, success: (r) => (r[0]?.ok ? "Substitute invited" : `Removed, but invite failed: ${r[0]?.message}`), onSuccess: onClose,
  });
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={entry.player.full_name}
      footer={mode === "edit" ? <Button block size="lg" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button>
        : mode === "replace" ? <Button block size="lg" disabled={!replacement} loading={replace.isPending} onClick={() => replace.mutate(undefined)}>Replace & invite substitute</Button>
        : <Button block size="lg" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(undefined)}>Remove from squad</Button>}>
      <div className="mb-4 flex gap-2">
        <Button size="sm" variant={mode === "edit" ? "primary" : "secondary"} onClick={() => setMode("edit")}>Edit</Button>
        <Button size="sm" variant={mode === "replace" ? "primary" : "secondary"} icon={<RefreshCw className="size-4" />} onClick={() => setMode("replace")}>Replace</Button>
        <Button size="sm" variant={mode === "remove" ? "danger" : "secondary"} icon={<UserMinus className="size-4" />} onClick={() => setMode("remove")}>Remove</Button>
      </div>
      {mode === "edit" ? (
        <div className="space-y-4">
          <Field label="Playing as">{(id) => <Select id={id} value={role} onChange={(e) => setRole(e.target.value as PlayingRole)}>{PLAYING_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</Select>}</Field>
          <Field label="Contribution">{(id) => <Select id={id} value={ct} onChange={(e) => setCt(e.target.value as S<"ContributionType">)}><option value="payee">Payee (shares cost)</option><option value="non_payee">Non-payee (free)</option></Select>}</Field>
        </div>
      ) : (
        <div className="space-y-4">
          {mode === "replace" && (
            <Field label="Substitute" hint="Team members only here. Use Find a Player for anyone nearby.">{(id) => (
              <Select id={id} value={replacement} onChange={(e) => setReplacement(e.target.value)}>
                <option value="">Choose a player</option>
                {(members.data ?? []).filter((s) => !s.already_invited && s.availability_state !== "unavailable").map((s) => (
                  <option key={s.player.id} value={s.player.id}>{s.player.full_name} · {s.availability_state}</option>
                ))}
              </Select>)}
            </Field>
          )}
          <Field label="Reason" optional>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
          <p className="text-sm text-ink-500">{entry.player.full_name} will be notified. Their spot opens up immediately.</p>
        </div>
      )}
    </Sheet>
  );
}
