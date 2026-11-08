import { ROLE_LABELS, type PlayerPublic } from "@cm/shared";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router";

import { RatingPill, ReliabilityMeter } from "@/components/players/Rating";
import { RoleBadge } from "@/components/players/RoleBadge";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, SectionHeader, Stat } from "@/components/ui/card";

export function ProfileView({ p }: { p: PlayerPublic }) {
  const s = p.stats;
  return (
    <div className="space-y-5">
      <Card className="flex flex-col items-center gap-3 p-6 text-center sm:flex-row sm:text-left">
        <Avatar name={p.full_name} src={p.profile_image} size="xl" />
        <div className="flex-1">
          <h2 className="text-2xl font-extrabold">{p.full_name}</h2>
          <p className="text-sm text-ink-500">{p.city} · Member since {new Date(p.member_since).toLocaleDateString("en-IN", { month: "short", year: "numeric" })}</p>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
            <RoleBadge role={p.primary_role} />
            {p.secondary_roles.map((r) => <Badge key={r}>{ROLE_LABELS[r]}</Badge>)}
          </div>
        </div>
        <div className="flex flex-col items-center gap-1 sm:items-end">
          <RatingPill value={p.average_rating} count={p.rating_count} />
          <ReliabilityMeter score={p.reliability_score} />
          <Link to={`/users/${p.user_id}/reputation`} className="text-xs font-semibold text-brand-700">Reputation →</Link>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Matches" value={s.matches_played} />
        <Stat label="Reliability" value={Math.round(p.reliability_score)} tone="brand" />
        <Stat label="No-shows" value={s.no_shows} tone={s.no_shows ? "danger" : "default"} />
        <Stat label="Response rate" value={s.response_rate != null ? `${Math.round(s.response_rate * 100)}%` : "—"} />
      </div>
      <Card className="space-y-3 p-5">
        <SectionHeader title="Cricket" />
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Item k="Batting" v={p.batting_style?.replace("_", "-")} />
          <Item k="Bowling" v={p.bowling_style?.replace(/_/g, " ")} />
          <Item k="Experience" v={p.experience_years != null ? `${p.experience_years} years` : null} />
          <Item k="Formats" v={p.preferred_formats.join(", ")} />
          <Item k="Days" v={p.preferred_days.join(", ")} />
          <Item k="Timing" v={p.preferred_timing.join(", ")} />
        </dl>
        {p.bio && <p className="rounded-2xl bg-sand-100 p-3 text-sm">{p.bio}</p>}
        {p.previous_teams.length > 0 && <p className="text-sm text-ink-700"><span className="text-ink-500">Previous teams:</span> {p.previous_teams.join(", ")}</p>}
        {p.cricheroes_url && <a href={p.cricheroes_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-700">CricHeroes profile <ExternalLink className="size-3.5" /></a>}
      </Card>
    </div>
  );
}

function Item({ k, v }: { k: string; v?: string | null }) {
  return <div><dt className="text-xs text-ink-500">{k}</dt><dd className="font-medium capitalize">{v || "—"}</dd></div>;
}
