import { formatDateTime, formatPaise } from "@cm/shared";
import { CircleDollarSign, Wallet } from "lucide-react";
import { Link } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, QueryState } from "@/components/ui/states";
import { useMatches, useMyPayments } from "@/services/api/endpoints";

export function SplitFeeHubPage() {
  const captain = useMatches({ role: "captain", when: "all" });
  const mine = useMyPayments();
  return (
    <div className="space-y-6">
      <PageHeader title="Split a Fee" back subtitle="Track match expenses and who has paid. Payments happen directly between players and captains (cash, UPI, etc.)." />
      <Link to="/payments" className="block">
        <Card className="flex items-center gap-4 p-5">
          <span className="grid size-12 place-items-center rounded-2xl bg-amber-100 text-amber-900"><Wallet className="size-6" /></span>
          <div className="flex-1"><p className="font-semibold">My payments</p><p className="text-sm text-ink-500">What you owe across all teams</p></div>
          <p className="tabular text-xl font-bold">{mine.data ? formatPaise(mine.data.outstanding_paise) : "…"}</p>
        </Card>
      </Link>
      <section>
        <SectionHeader title="Matches you manage" subtitle="Pick a match to add expenses and settle up" />
        <QueryState query={captain} isEmpty={(d) => d.data.filter((m) => m.match_status !== "draft" && m.match_status !== "cancelled").length === 0}
          empty={<EmptyState icon={<CircleDollarSign />} title="No matches to settle" body="Create a match first, then split its costs here." action={<Link to="/matches/new"><Button size="sm">Create match</Button></Link>} />}>
          {(d) => (
            <Card className="divide-y divide-sand-200">
              {d.data.filter((m) => m.match_status !== "draft" && m.match_status !== "cancelled").map((m) => (
                <Link key={m.id} to={`/matches/${m.id}/fees`} className="flex items-center justify-between gap-3 p-4 hover:bg-sand-50">
                  <div className="min-w-0"><p className="truncate font-semibold">{m.title}</p><p className="text-sm text-ink-500">{m.team_name} · {formatDateTime(m.start_at, m.timezone)}</p></div>
                  <StatusBadge status={m.match_status} />
                </Link>
              ))}
            </Card>
          )}
        </QueryState>
      </section>
    </div>
  );
}
