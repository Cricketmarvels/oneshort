import type { S } from "@cm/shared";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { reports, useMyReports, usePublicPlayer } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

const CATEGORIES: Array<[S<"ReportCategory">, string]> = [
  ["abusive_language", "Abusive language"], ["physical_misconduct", "Physical misconduct"], ["harassment", "Harassment"],
  ["threatening_behaviour", "Threatening behaviour"], ["unsportsmanlike", "Unsportsmanlike behaviour"],
  ["financial_misconduct", "Financial misconduct"], ["repeated_no_shows", "Repeated no-shows"], ["other", "Other"],
];

export function ReportPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [userId, setUserId] = useState(params.get("user") ?? "");
  const matchId = params.get("match");
  const target = usePublicPlayer(userId);
  const mine = useMyReports();
  const [category, setCategory] = useState<S<"ReportCategory">>("unsportsmanlike");
  const [desc, setDesc] = useState("");
  const submit = useAction(() => reports.create({ target_user_id: userId, match_id: matchId, category, description: desc }), {
    invalidate: [["reports"]], success: "Report submitted. Our moderators will review it.", onSuccess: () => nav(-1),
  });
  return (
    <div className="space-y-5">
      <PageHeader back title="Report misconduct" subtitle="Reports are confidential and reviewed by human moderators." />
      <p className="flex gap-2 rounded-2xl bg-ball-50 p-3 text-sm text-ink-700"><ShieldAlert className="size-5 shrink-0 text-ball-600" />If someone is in immediate danger, contact local emergency services (112) first.</p>
      <Card className="space-y-4 p-5">
        {params.get("user") ? (
          <p className="text-sm">Reporting <strong>{target.data?.full_name ?? "this user"}</strong></p>
        ) : (
          <Field label="User ID" hint="Open the player's profile and tap Report to fill this automatically.">{(id) => <Input id={id} value={userId} onChange={(e) => setUserId(e.target.value.trim())} />}</Field>
        )}
        <Field label="What happened?">{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as S<"ReportCategory">)}>{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
        <Field label="Details" hint="At least 10 characters. Include the match, time and what was said or done.">{(id) => <Textarea id={id} minLength={10} maxLength={2000} value={desc} onChange={(e) => setDesc(e.target.value)} />}</Field>
        <Button block size="lg" variant="danger" disabled={desc.trim().length < 10 || !/^[a-f0-9]{24}$/.test(userId)} loading={submit.isPending} onClick={() => submit.mutate(undefined)}>Submit report</Button>
      </Card>
      {(mine.data?.length ?? 0) > 0 && (
        <section>
          <SectionHeader title="My reports" />
          <Card className="divide-y divide-sand-200">
            {mine.data!.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-3.5 text-sm">
                <span><span className="font-mono text-xs text-ink-400">{r.report_code}</span> · {r.category.replace(/_/g, " ")} · {r.target.full_name}</span>
                <StatusBadge status={r.status} />
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}
