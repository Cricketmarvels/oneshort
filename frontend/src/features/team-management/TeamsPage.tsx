import { Plus, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { TeamCard } from "@/components/teams/TeamCard";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/chip";
import { Input } from "@/components/ui/field";
import { EmptyState, QueryState } from "@/components/ui/states";
import { teams, useTeamInvites, useTeams } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

export function TeamsPage() {
  const [tab, setTab] = useState<"member" | "mine" | "all">("member");
  const [q, setQ] = useState("");
  const list = useTeams(tab, tab === "all" ? q : undefined);
  const invites = useTeamInvites();
  const respond = useAction(({ id, accept }: { id: string; accept: boolean }) => teams.respond(id, accept), {
    invalidate: [["teams"], ["dashboard"]], success: "Updated",
  });
  return (
    <div className="space-y-5">
      <PageHeader title="Teams" action={<Link to="/teams/new"><Button icon={<Plus className="size-4" />}>New team</Button></Link>} />
      {(invites.data?.length ?? 0) > 0 && (
        <section>
          <SectionHeader title="Team invitations" />
          <div className="space-y-2">
            {invites.data!.map((t) => (
              <Card key={t.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="flex-1"><p className="font-semibold">{t.team_name}</p><p className="text-sm text-ink-500">Captain {t.captain.full_name} · {t.area}</p></div>
                <Button size="sm" onClick={() => respond.mutate({ id: t.id, accept: true })}>Join</Button>
                <Button size="sm" variant="secondary" onClick={() => respond.mutate({ id: t.id, accept: false })}>Decline</Button>
              </Card>
            ))}
          </div>
        </section>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "member", label: "My teams" }, { value: "mine", label: "Captaining" }, { value: "all", label: "Browse" }]} />
      {tab === "all" && <Input placeholder="Search teams" aria-label="Search teams" value={q} onChange={(e) => setQ(e.target.value)} />}
      <QueryState query={list} isEmpty={(d) => d.data.length === 0}
        empty={<EmptyState icon={<Users />} title={tab === "mine" ? "You don't captain a team yet" : "No teams found"} action={<Link to="/teams/new"><Button size="sm">Create a team</Button></Link>} />}>
        {(d) => <div className="grid gap-3 md:grid-cols-2">{d.data.map((t) => <TeamCard key={t.id} team={t} />)}</div>}
      </QueryState>
    </div>
  );
}
