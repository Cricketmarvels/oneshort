import { Plus, Swords } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { MatchCard } from "@/components/matches/MatchCard";
import { Button } from "@/components/ui/button";
import { Segmented, Tabs } from "@/components/ui/chip";
import { EmptyState, QueryState } from "@/components/ui/states";
import { useMatches } from "@/services/api/endpoints";

export function MatchesPage() {
  const [when, setWhen] = useState<"upcoming" | "past">("upcoming");
  const [role, setRole] = useState<"all" | "captain" | "player">("all");
  const q = useMatches({ when, role });
  return (
    <div>
      <PageHeader title="Matches" action={<Link to="/matches/new"><Button icon={<Plus className="size-4" />}>New match</Button></Link>} />
      <Tabs value={when} onChange={setWhen} tabs={[{ value: "upcoming", label: "Upcoming" }, { value: "past", label: "History" }]} />
      <div className="my-4 max-w-sm"><Segmented label="Role" value={role} onChange={setRole} options={[{ value: "all", label: "All" }, { value: "captain", label: "Captaining" }, { value: "player", label: "Playing" }]} /></div>
      <QueryState query={q} isEmpty={(d) => d.data.length === 0}
        empty={<EmptyState icon={<Swords />} title={when === "upcoming" ? "No upcoming matches" : "No match history yet"} body="Create a match or find a team to get started."
          action={<div className="flex gap-2"><Link to="/matches/new"><Button size="sm">Create match</Button></Link><Link to="/discover/teams"><Button size="sm" variant="secondary">Find a team</Button></Link></div>} />}>
        {(d) => <div className="grid gap-3 md:grid-cols-2">{d.data.map((m) => <MatchCard key={m.id} match={m} />)}</div>}
      </QueryState>
    </div>
  );
}
