import { formatDateTime, formatPaise, MATCH_STATUS_LABELS, type Match } from "@cm/shared";
import { CalendarClock, MapPin, Users } from "lucide-react";
import { Link } from "react-router";

import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function MatchCard({ match }: { match: Match }) {
  const c = match.composition;
  return (
    <Link to={`/matches/${match.id}`} className="block min-w-0 rounded-[var(--radius-card)] focus-visible:outline-2">
      <Card className="p-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]">
        <div className="flex items-start gap-3">
          <Avatar name={match.team_name} src={match.team_logo} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate font-semibold text-ink-900">{match.title}</p>
            </div>
            <p className="truncate text-sm text-ink-500">{match.team_name} · {match.format} · {match.category}</p>
          </div>
          <StatusBadge status={match.match_status} label={MATCH_STATUS_LABELS[match.match_status]} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-1.5 text-sm text-ink-700 sm:grid-cols-3">
          <span className="flex items-center gap-1.5"><CalendarClock className="size-4 text-ink-400" aria-hidden />{formatDateTime(match.start_at, match.timezone)}</span>
          <span className="flex items-center gap-1.5 truncate"><MapPin className="size-4 text-ink-400" aria-hidden />{match.venue.name ?? match.venue.area}</span>
          <span className="flex items-center gap-1.5"><Users className="size-4 text-ink-400" aria-hidden />{c.confirmed_total}/{c.capacity}{match.per_head_fee_paise ? ` · ~${formatPaise(match.per_head_fee_paise)}` : ""}</span>
        </div>
      </Card>
    </Link>
  );
}
