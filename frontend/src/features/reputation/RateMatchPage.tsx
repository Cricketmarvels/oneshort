import type { S } from "@cm/shared";
import { CheckCircle2, Star } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { StarInput } from "@/components/players/Rating";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { EmptyState, QueryState, Spinner } from "@/components/ui/states";
import { ratings, useRateable } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

const LABELS: Record<string, string> = {
  punctuality: "Punctuality", behaviour: "Behaviour", sportsmanship: "Sportsmanship", participation: "Participation", overall: "Overall experience",
  fair_opportunities: "Fair playing opportunities", team_management: "Team management", communication: "Communication",
};

export function RateMatchPage() {
  const { id = "" } = useParams();
  const q = useRateable(id);
  return (
    <div className="space-y-5">
      <PageHeader back={`/matches/${id}`} title="Rate this match" subtitle="Honest, fair feedback helps everyone find good games. One rating per person." />
      <QueryState query={q} skeleton={<Spinner />} isEmpty={(d) => d.length === 0} empty={<EmptyState icon={<Star />} title="No one to rate" />}>
        {(d) => <div className="space-y-4">{d.map((p) => <RateCard key={p.user.id} matchId={id} p={p} />)}</div>}
      </QueryState>
    </div>
  );
}

function RateCard({ matchId, p }: { matchId: string; p: S<"RateableOut"> }) {
  const [scores, setScores] = useState<Record<string, number>>({});
  const [comment, setComment] = useState("");
  const submit = useAction(() => ratings.rate(matchId, { reviewed_user_id: p.user.id, scores, comment: comment || null }), {
    invalidate: [["ratings"]], success: `Thanks for rating ${p.user.full_name.split(" ")[0]}`,
  });
  const done = p.already_rated || submit.isSuccess;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-3">
        <Avatar name={p.user.full_name} src={p.user.profile_image} />
        <div className="flex-1"><p className="font-semibold">{p.user.full_name}</p><Badge tone={p.rating_type === "captain" ? "danger" : "brand"}>{p.rating_type}</Badge></div>
        {done && <span className="flex items-center gap-1 text-sm font-semibold text-brand-700"><CheckCircle2 className="size-5" />Rated</span>}
      </div>
      {!done && (
        <div className="mt-4 space-y-3">
          {p.categories.map((c) => (
            <div key={c} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink-700">{LABELS[c] ?? c}</span>
              <StarInput label={LABELS[c] ?? c} value={scores[c] ?? 0} onChange={(v) => setScores({ ...scores, [c]: v })} />
            </div>
          ))}
          <Textarea aria-label="Comment" maxLength={500} placeholder="Optional comment" value={comment} onChange={(e) => setComment(e.target.value)} />
          <Button block disabled={!scores.overall} loading={submit.isPending} onClick={() => submit.mutate(undefined)}>Submit rating</Button>
        </div>
      )}
    </Card>
  );
}
