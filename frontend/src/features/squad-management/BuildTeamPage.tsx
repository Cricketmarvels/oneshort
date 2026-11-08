import { formatDateTime, PLAYING_ROLES, ROLE_LABELS, type PlayingRole, type S } from "@cm/shared";
import { History, MapPinned, Send, Users } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { SquadComposition } from "@/components/matches/SquadComposition";
import { RatingPill, ReliabilityMeter } from "@/components/players/Rating";
import { RoleBadge } from "@/components/players/RoleBadge";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Tabs, ToggleChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/field";
import { EmptyState, QueryState, Spinner } from "@/components/ui/states";
import { InvitationCard } from "@/features/invitations/InvitationCard";
import { matches, useMatch, useMatchInvitations, useSuggestions } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

type Tab = "members" | "nearby" | "previous" | "invites";

export function BuildTeamPage() {
  const { id = "" } = useParams();
  const match = useMatch(id);
  const [tab, setTab] = useState<Tab>("members");
  const [role, setRole] = useState<PlayingRole | undefined>();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Record<string, S<"ContributionType">>>({});
  const members = useSuggestions(id, "members", role, tab === "members");
  const previous = useSuggestions(id, "previous", role, tab === "previous");
  const invites = useMatchInvitations(id, tab === "invites");
  const send = useAction(() => matches.invite(id, { invites: Object.entries(selected).map(([player_id, contribution_type]) => ({ player_id, contribution_type })) }), {
    invalidate: [["matches"], ["invitations"]],
    success: (r) => { const ok = r.filter((x) => x.ok); const bad = r.filter((x) => !x.ok); return `${ok.length} invited${bad.length ? ` · ${bad.length} skipped (${[...new Set(bad.map((b) => b.error_code?.toLowerCase().replace(/_/g, " ")))].join(", ")})` : ""}`; },
    onSuccess: () => setSelected({}),
  });
  if (match.isPending) return <Spinner />;
  if (!match.data) return <QueryState query={match}>{() => null}</QueryState>;
  const m = match.data;
  const def = m.default_contribution_type;
  const toggle = (pid: string) => setSelected((s) => { const n = { ...s }; if (n[pid]) delete n[pid]; else n[pid] = def; return n; });
  const list = tab === "members" ? members : previous;
  const count = Object.keys(selected).length;

  return (
    <div className="space-y-5 pb-24">
      <PageHeader back={`/matches/${id}`} title="Build your squad" subtitle={`${m.title} · ${formatDateTime(m.start_at, m.timezone)}`} />
      <Card className="p-5"><SquadComposition comp={m.composition} compact /></Card>
      <Tabs value={tab} onChange={setTab} tabs={[
        { value: "members", label: "Team members" }, { value: "nearby", label: "Nearby players" },
        { value: "previous", label: "Played before" }, { value: "invites", label: "Invitations" },
      ]} />
      {tab === "nearby" ? (
        <EmptyState icon={<MapPinned />} title="Search players near the venue" body="Uses the Find a Player engine with this match's venue and timing."
          action={<Link to={`/discover/players?match=${id}`}><Button>Open Find a Player</Button></Link>} />
      ) : tab === "invites" ? (
        <QueryState query={invites} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={<Send />} title="No invitations yet" />}>
          {(d) => <div className="grid gap-3 md:grid-cols-2">{d.map((i) => <InvitationCard key={i.id} inv={i} />)}</div>}
        </QueryState>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {PLAYING_ROLES.map((r) => <ToggleChip key={r} selected={role === r} onClick={() => setRole(role === r ? undefined : r)}>{ROLE_LABELS[r]}</ToggleChip>)}
            <Input className="h-10 max-w-56" placeholder="Search by name" aria-label="Search by name" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <QueryState query={list} isEmpty={(d) => d.length === 0}
            empty={<EmptyState icon={tab === "members" ? <Users /> : <History />} title={tab === "members" ? "No team members to invite" : "No previous players available"}
              body={tab === "members" ? "Add players to your team or use Nearby players." : "Players who've played for your team and are free at this time appear here."} />}>
            {(d) => (
              <div className="space-y-2">
                {d.filter((s) => !q || s.player.full_name.toLowerCase().includes(q.toLowerCase())).map((s) => {
                  const disabled = s.already_invited || s.availability_state === "unavailable";
                  return (
                    <Card key={s.player.id} className="flex items-center gap-3 p-3">
                      <input type="checkbox" className="size-5 accent-brand-700" disabled={disabled} checked={!!selected[s.player.id]} onChange={() => toggle(s.player.id)} aria-label={`Select ${s.player.full_name}`} />
                      <Avatar name={s.player.full_name} src={s.player.profile_image} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{s.player.full_name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {s.primary_role && <RoleBadge role={s.primary_role} short />}
                          <StatusBadge status={s.availability_state} />
                          {s.previous_matches_together > 0 && <Badge>{s.previous_matches_together} games with you</Badge>}
                          {s.already_invited && <Badge tone="info">invited</Badge>}
                        </div>
                      </div>
                      <div className="hidden text-right sm:block"><RatingPill value={s.average_rating} />{s.reliability_score != null && <ReliabilityMeter score={s.reliability_score} compact />}</div>
                      {selected[s.player.id] && (
                        <button type="button" onClick={() => setSelected({ ...selected, [s.player.id]: selected[s.player.id] === "payee" ? "non_payee" : "payee" })}
                          className="rounded-full bg-sand-100 px-2.5 py-1 text-xs font-semibold ring-1 ring-sand-300">{selected[s.player.id] === "payee" ? "Payee" : "Free"}</button>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </QueryState>
        </>
      )}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-16 z-20 px-4 md:bottom-4 md:left-[17rem]">
          <Card className="mx-auto flex max-w-3xl items-center justify-between gap-3 p-3 shadow-[var(--shadow-float)]">
            <p className="text-sm font-semibold">{count} selected · tap Payee/Free to change</p>
            <Button icon={<Send className="size-4" />} loading={send.isPending} onClick={() => send.mutate(undefined)}>Invite</Button>
          </Card>
        </div>
      )}
    </div>
  );
}
