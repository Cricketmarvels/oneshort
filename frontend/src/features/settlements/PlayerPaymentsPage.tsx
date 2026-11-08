import { formatDateTime, formatPaise, PAYMENT_STATUS_LABELS, type S } from "@cm/shared";
import { MessageSquare, Wallet } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Stat } from "@/components/ui/card";
import { Tabs } from "@/components/ui/chip";
import { EmptyState, QueryState, Spinner } from "@/components/ui/states";
import { useMyPayments } from "@/services/api/endpoints";

import { DiscussionSheet } from "./DiscussionSheet";

export function PlayerPaymentsPage() {
  const [tab, setTab] = useState<"all" | "pending" | "paid" | "exempted" | "disputed">("all");
  const q = useMyPayments(tab === "all" ? undefined : tab);
  const [thread, setThread] = useState<S<"PaymentRecordOut"> | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader title="My payments" back subtitle="Contributions across all your teams. Pay your captain directly, then they'll mark it paid." />
      <QueryState query={q} skeleton={<Spinner />}>
        {(d) => (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Outstanding" value={formatPaise(d.outstanding_paise)} tone={d.outstanding_paise ? "danger" : "default"} />
              <Stat label="Paid" value={formatPaise(d.paid_paise)} tone="success" />
              <Stat label="Pending" value={d.pending_count} />
              <Stat label="Disputed" value={d.disputed_count} />
            </div>
            <Tabs value={tab} onChange={setTab} tabs={(["all", "pending", "paid", "exempted", "disputed"] as const).map((v) => ({ value: v, label: v === "all" ? "All" : PAYMENT_STATUS_LABELS[v] }))} />
            {d.records.length === 0 ? <EmptyState icon={<Wallet />} title="Nothing here" body="When a captain publishes match fees, they'll show up here." /> : (
              <div className="space-y-3">
                {d.records.map((r) => (
                  <Card key={r.id} className="p-4">
                    <div className="flex items-start gap-3">
                      <Avatar name={r.team_name} />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold">{r.team_name}</p>
                        <Link to={`/matches/${r.match_id}/fees`} className="text-sm text-ink-500 hover:underline">{r.match_title} · {formatDateTime(r.match_start_at)}</Link>
                        <p className="mt-1 text-xs text-ink-500">Captain {r.captain.full_name}{r.status === "paid" ? " · marked paid by captain" : ""}{r.credited_paise > 0 && r.status !== "paid" ? ` · ${formatPaise(r.credited_paise)} already credited` : ""}</p>
                      </div>
                      <div className="text-right">
                        <p className="tabular text-lg font-bold">{formatPaise(r.status === "paid" || r.status === "exempted" ? r.amount_paise : r.balance_paise)}</p>
                        <StatusBadge status={r.status} label={PAYMENT_STATUS_LABELS[r.status]} />
                      </div>
                    </div>
                    <div className="mt-3 flex justify-end gap-2 border-t border-sand-200 pt-3">
                      <Button size="sm" variant="ghost" icon={<MessageSquare className="size-4" />} onClick={() => setThread(r)}>Discuss</Button>
                      <Link to={`/matches/${r.match_id}/fees`}><Button size="sm" variant="secondary">Details</Button></Link>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}
      </QueryState>
      {thread && <DiscussionSheet record={thread} onClose={() => setThread(null)} />}
    </div>
  );
}
