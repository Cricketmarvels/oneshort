import { relativeTime } from "@cm/shared";
import { Star } from "lucide-react";
import { useParams, useSearchParams } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { RatingPill, ReliabilityMeter } from "@/components/players/Rating";
import { Avatar } from "@/components/ui/avatar";
import { Card, SectionHeader } from "@/components/ui/card";
import { Segmented } from "@/components/ui/chip";
import { EmptyState, QueryState, Spinner } from "@/components/ui/states";
import { useReputation } from "@/services/api/endpoints";

const LABELS: Record<string, string> = {
  punctuality: "Punctuality", behaviour: "Behaviour", sportsmanship: "Sportsmanship", participation: "Participation",
  overall: "Overall", fair_opportunities: "Fair opportunities", team_management: "Team management", communication: "Communication",
};

export function ReputationPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const type = (params.get("type") as "player" | "captain") ?? "player";
  const q = useReputation(id, type);
  return (
    <div className="space-y-5">
      <PageHeader back title="Reputation" subtitle="Only verified participants of completed matches can rate." />
      <Segmented label="Reputation type" value={type} onChange={(t) => setParams({ type: t })} options={[{ value: "player", label: "As player" }, { value: "captain", label: "As captain" }]} />
      <QueryState query={q} skeleton={<Spinner />}>
        {(r) => (
          <>
            <Card className="flex flex-wrap items-center gap-4 p-5">
              <Avatar name={r.user.full_name} src={r.user.profile_image} size="lg" />
              <div className="flex-1"><p className="text-xl font-bold">{r.user.full_name}</p><p className="text-sm text-ink-500">{r.matches_played ?? 0} matches {type === "captain" ? "captained" : "played"}</p></div>
              <div className="text-right"><p className="font-display text-4xl font-extrabold">{r.average_rating?.toFixed(1) ?? "—"}</p><p className="text-xs text-ink-500">{r.rating_count} rating{r.rating_count === 1 ? "" : "s"}</p></div>
            </Card>
            {r.reliability_score != null && <Card className="flex items-center justify-between p-4"><span className="font-semibold">Reliability score</span><ReliabilityMeter score={r.reliability_score} /></Card>}
            {Object.keys(r.breakdown).length > 0 && (
              <Card className="space-y-2.5 p-5">
                {Object.entries(r.breakdown).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-3 text-sm">
                    <span className="w-36 shrink-0 text-ink-700">{LABELS[k] ?? k}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-sand-200"><div className="h-full rounded-full bg-amber-400" style={{ width: `${(v / 5) * 100}%` }} /></div>
                    <span className="tabular w-8 text-right font-semibold">{v.toFixed(1)}</span>
                  </div>
                ))}
              </Card>
            )}
            <section>
              <SectionHeader title="Recent reviews" />
              {r.recent.length === 0 ? <EmptyState icon={<Star />} title="No reviews yet" /> : (
                <div className="space-y-3">
                  {r.recent.map((x) => (
                    <Card key={x.id} className="p-4">
                      <div className="flex items-center gap-2"><Avatar name={x.reviewer.full_name} src={x.reviewer.profile_image} size="sm" />
                        <span className="flex-1 text-sm font-semibold">{x.reviewer.full_name}</span><RatingPill value={x.overall} /></div>
                      <p className="mt-1 text-xs text-ink-500">{x.match_title} · {relativeTime(x.created_at)}</p>
                      {x.comment && <p className="mt-2 text-sm text-ink-700">“{x.comment}”</p>}
                    </Card>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </QueryState>
    </div>
  );
}
