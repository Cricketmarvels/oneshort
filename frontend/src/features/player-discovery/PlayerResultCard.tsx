import { ROLE_LABELS, type S } from "@cm/shared";
import { ChevronDown, MapPin } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { RatingPill, ReliabilityMeter } from "@/components/players/Rating";
import { RoleBadge } from "@/components/players/RoleBadge";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/utils/cn";

const FACTOR_LABELS: Record<string, string> = {
  proximity: "Proximity", availability: "Availability", role: "Role fit", rating: "Rating",
  reliability: "Reliability", participation: "Experience", response_rate: "Responsiveness",
};

export function PlayerResultCard({ r, selected, onToggle, selectable }: { r: S<"PlayerResultOut">; selected: boolean; onToggle: () => void; selectable: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className={cn("p-4 transition", selected && "ring-2 ring-brand-600")}>
      <div className="flex items-start gap-3">
        {selectable && (
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${r.player.full_name}`} className="mt-3 size-5 shrink-0 accent-brand-700" />
        )}
        <Avatar name={r.player.full_name} src={r.player.profile_image} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <Link to={`/players/${r.player.id}`} className="truncate font-semibold hover:underline">{r.player.full_name}</Link>
            <span className="tabular shrink-0 rounded-lg bg-brand-50 px-2 py-0.5 text-sm font-bold text-brand-800" title="Match score">{Math.round(r.score)}</span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <RoleBadge role={r.primary_role} />
            {r.role_match === "secondary" && <Badge tone="neutral">secondary fit</Badge>}
            {r.availability_status === "tentative" && <Badge tone="warning">tentative</Badge>}
            {r.coverage < 1 && <Badge tone="warning">{Math.round(r.coverage * 100)}% of match</Badge>}
            {r.is_team_member && <Badge tone="brand">team member</Badge>}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-700">
            <span className="flex items-center gap-1"><MapPin className="size-4 text-ink-400" aria-hidden />~{r.approx_distance_km} km</span>
            <RatingPill value={r.average_rating} count={r.rating_count} />
            <ReliabilityMeter score={r.reliability_score} compact />
            <span className="text-xs text-ink-500">{r.matches_played} matches</span>
          </div>
        </div>
      </div>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="mt-2 flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-ink-900">
        Why this player? <ChevronDown className={cn("size-3.5 transition", open && "rotate-180")} />
      </button>
      {open && (
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          {Object.entries(r.score_breakdown).map(([k, v]) => (
            <div key={k}>
              <dt className="text-ink-500">{FACTOR_LABELS[k] ?? k}</dt>
              <dd className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-sand-200"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round(v * 100)}%` }} /></dd>
            </div>
          ))}
          <div className="col-span-full text-ink-400">Batting {r.batting_style?.replace("_", " ") ?? "—"} · Bowling {r.bowling_style?.replace(/_/g, " ") ?? "—"} · {ROLE_LABELS[r.primary_role]}</div>
        </dl>
      )}
    </Card>
  );
}
