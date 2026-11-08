import type { Team } from "@cm/shared";
import { ChevronRight, MapPin } from "lucide-react";
import { Link } from "react-router";

import { RatingPill } from "@/components/players/Rating";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function TeamCard({ team }: { team: Team }) {
  return (
    <Link to={`/teams/${team.id}`} className="block min-w-0">
      <Card className="flex items-center gap-3 p-4 transition hover:shadow-[var(--shadow-float)]">
        <Avatar name={team.team_name} src={team.logo} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{team.team_name}</p>
          <p className="flex items-center gap-1 truncate text-sm text-ink-500"><MapPin className="size-3.5" aria-hidden />{team.area}, {team.city}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge tone="brand">{team.category}</Badge>
            <span className="text-xs text-ink-500">{team.member_count} members</span>
            <RatingPill value={team.average_rating} />
            {team.my_membership && <Badge tone={team.my_membership === "invited" ? "warning" : "neutral"}>{team.my_membership}</Badge>}
          </div>
        </div>
        <ChevronRight className="size-5 text-ink-400" aria-hidden />
      </Card>
    </Link>
  );
}
