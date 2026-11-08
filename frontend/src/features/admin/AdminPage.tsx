import { relativeTime, type S } from "@cm/shared";
import { Bot, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, Stat } from "@/components/ui/card";
import { Tabs } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, QueryState } from "@/components/ui/states";
import { admin, useAdminReports, useAdminStats } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

export function AdminPage() {
  const stats = useAdminStats();
  const [status, setStatus] = useState<"open" | "investigating" | "resolved" | "dismissed">("open");
  const reportsQ = useAdminReports(status);
  const [open, setOpen] = useState<S<"AdminReportOut"> | null>(null);
  return (
    <div className="space-y-5">
      <PageHeader title="Moderation" subtitle="Investigate reports and take action. All actions are audited." />
      {stats.data && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Open reports" value={stats.data.open_reports} tone={stats.data.open_reports ? "danger" : "default"} />
          <Stat label="Investigating" value={stats.data.investigating_reports} />
          <Stat label="Suspended" value={stats.data.suspended_users} />
          <Stat label="Restricted" value={stats.data.restricted_users} sub={`AI triage ${stats.data.ai_triage_enabled ? "on" : "off"}`} />
        </div>
      )}
      <Tabs value={status} onChange={setStatus} tabs={[{ value: "open", label: "Open" }, { value: "investigating", label: "Investigating" }, { value: "resolved", label: "Resolved" }, { value: "dismissed", label: "Dismissed" }]} />
      <QueryState query={reportsQ} isEmpty={(d) => d.data.length === 0} empty={<EmptyState icon={<ShieldCheck />} title="Queue is clear" />}>
        {(d) => (
          <div className="space-y-3">
            {d.data.map((r) => (
              <Card key={r.id} className="cursor-pointer p-4 hover:shadow-[var(--shadow-float)]" onClick={() => setOpen(r)}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-ink-400">{r.report_code}</span>
                  <Badge tone="danger">{r.category.replace(/_/g, " ")}</Badge>
                  {r.ai_triage && <Badge tone={r.ai_triage.severity === "critical" || r.ai_triage.severity === "high" ? "danger" : "warning"} icon={<Bot className="size-3" />}>AI: {r.ai_triage.severity}</Badge>}
                  <span className="ml-auto text-xs text-ink-400">{relativeTime(r.created_at)}</span>
                </div>
                <p className="mt-2 text-sm"><strong>{r.reporter.full_name}</strong> reported <strong>{r.target.full_name}</strong>{r.prior_reports_against_target ? ` · ${r.prior_reports_against_target} prior report(s)` : ""}</p>
                <p className="mt-1 line-clamp-2 text-sm text-ink-700">{r.description}</p>
              </Card>
            ))}
          </div>
        )}
      </QueryState>
      {open && <ReportSheet r={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function ReportSheet({ r, onClose }: { r: S<"AdminReportOut">; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [newStatus, setNewStatus] = useState<S<"ReportStatus">>(r.status === "open" ? "investigating" : r.status);
  const [action, setAction] = useState<S<"ModerationAction"> | "">("");
  const [days, setDays] = useState("7");
  const [reason, setReason] = useState("");
  const save = useAction(() => admin.updateReport(r.id, {
    status: newStatus, note: note || null,
    action: action ? { type: action, days: action === "temp_suspend" ? Number(days) : null, reason: reason || "See investigation notes" } : null,
  }), { invalidate: [["admin"]], success: "Report updated", onSuccess: onClose });
  return (
    <Sheet open size="lg" onOpenChange={(v) => !v && onClose()} title={`Report ${r.report_code}`} description={r.category.replace(/_/g, " ")}
      footer={<Button block size="lg" loading={save.isPending} disabled={!!action && !reason.trim()} onClick={() => save.mutate(undefined)}>Save</Button>}>
      <div className="space-y-4">
        <div className="flex items-center gap-3"><Avatar name={r.target.full_name} src={r.target.profile_image} />
          <div className="flex-1"><p className="font-semibold">{r.target.full_name}</p><p className="text-xs text-ink-500">Account: {r.target_account_status} · {r.prior_reports_against_target} prior report(s)</p></div>
          <StatusBadge status={r.status} /></div>
        <p className="rounded-2xl bg-sand-100 p-3 text-sm">{r.description}</p>
        {r.ai_triage && (
          <div className="rounded-2xl bg-sky-50 p-3 text-sm ring-1 ring-sky-200">
            <p className="flex items-center gap-1.5 font-semibold text-sky-900"><Bot className="size-4" />AI triage (advisory only, {r.ai_triage.model})</p>
            <p className="mt-1">{r.ai_triage.summary}</p>
            <p className="mt-1 text-xs text-ink-700">Severity <strong>{r.ai_triage.severity}</strong> · Suggests <strong>{r.ai_triage.suggested_action.replace(/_/g, " ")}</strong>. {r.ai_triage.rationale}</p>
          </div>
        )}
        {r.investigation_notes.length > 0 && (
          <ul className="space-y-1.5 text-sm">{r.investigation_notes.map((n, i) => <li key={i} className="rounded-xl bg-white p-2 ring-1 ring-sand-200">{n.note} <span className="text-xs text-ink-400">· {relativeTime(n.at)}</span></li>)}</ul>
        )}
        {r.actions.length > 0 && <div className="flex flex-wrap gap-1.5">{r.actions.map((a, i) => <Badge key={i} tone="danger">{a.action.replace(/_/g, " ")}</Badge>)}</div>}
        <Field label="Investigation note" optional>{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Status">{(id) => <Select id={id} value={newStatus} onChange={(e) => setNewStatus(e.target.value as S<"ReportStatus">)}>{(["open", "investigating", "resolved", "dismissed"] as const).map((s) => <option key={s} value={s}>{s}</option>)}</Select>}</Field>
          <Field label="Action" optional>{(id) => (
            <Select id={id} value={action} onChange={(e) => setAction(e.target.value as S<"ModerationAction"> | "")}>
              <option value="">No action</option><option value="warning">Issue warning</option><option value="restrict_matchmaking">Restrict matchmaking</option>
              <option value="temp_suspend">Temporary suspension</option><option value="permanent_suspend">Permanent suspension</option><option value="lift_restrictions">Lift restrictions</option>
            </Select>)}
          </Field>
        </div>
        {action === "temp_suspend" && <Field label="Days">{(id) => <Input id={id} type="number" min={1} max={365} value={days} onChange={(e) => setDays(e.target.value)} />}</Field>}
        {action && <Field label="Reason shown to the user">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>}
      </div>
    </Sheet>
  );
}
