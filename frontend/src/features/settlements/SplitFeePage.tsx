import { formatPaise, PAYMENT_STATUS_LABELS, rupeesToPaise, type S } from "@cm/shared";
import { AlertTriangle, BellRing, Check, Copy, MessageSquare, Plus, Receipt, Share2, Trash2, Undo2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router";
import { toast } from "sonner";

import { useAuth } from "@/app/store/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Avatar } from "@/components/ui/avatar";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader, Stat } from "@/components/ui/card";
import { Segmented } from "@/components/ui/chip";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, QueryState, Spinner } from "@/components/ui/states";
import { fees, useExpenses, useMatch, usePaymentsDashboard, useRoster, useSettlements } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

import { DiscussionSheet } from "./DiscussionSheet";

const CATS: S<"ExpenseCategory">[] = ["ground", "balls", "umpire", "refreshments", "equipment", "travel", "other"];
const INV = [["settlements"], ["payments"], ["dashboard"]];

export function SplitFeePage() {
  const { id = "" } = useParams();
  const match = useMatch(id);
  const settlements = useSettlements(id);
  if (match.isPending || settlements.isPending) return <Spinner />;
  if (!match.data) return <QueryState query={match}>{() => null}</QueryState>;
  const manager = match.data.viewer_relation === "manager";
  const published = settlements.data?.find((s) => s.settlement_status === "published");
  const draft = settlements.data?.find((s) => s.settlement_status === "draft");
  return (
    <div className="space-y-6">
      <PageHeader back={`/matches/${id}`} title="Split a Fee" subtitle={`${match.data.title} · ${match.data.team_name}`} />
      <p className="flex gap-2 rounded-2xl bg-sand-200/60 p-3 text-xs text-ink-700">
        <AlertTriangle className="size-4 shrink-0 text-amber-600" aria-hidden />
        Payments are made directly to the captain (cash, UPI, PhonePe, GPay…). Statuses are recorded manually by the captain and are not verified by the app.
      </p>
      {manager && <CaptainFlow matchId={id} draft={draft} published={published} />}
      {published ? <PaymentsBoard settlement={published} manager={manager} /> : !manager && <EmptyState icon={<Receipt />} title="No settlement yet" body="Your captain hasn't published the match fees." />}
      {(settlements.data?.length ?? 0) > 1 && (
        <section>
          <SectionHeader title="Settlement history" />
          <Card className="divide-y divide-sand-200">
            {settlements.data!.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-3.5 text-sm">
                <span>v{s.version} · {formatPaise(s.total_expenses_paise)}{s.revision_reason ? ` · ${s.revision_reason}` : ""}</span>
                <StatusBadge status={s.settlement_status === "published" ? "confirmed" : s.settlement_status === "draft" ? "pending" : "expired"} label={s.settlement_status} />
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function CaptainFlow({ matchId, draft, published }: { matchId: string; draft?: S<"SettlementOut">; published?: S<"SettlementOut"> }) {
  const expenses = useExpenses(matchId);
  const roster = useRoster(matchId);
  const [exp, setExp] = useState({ label: "", amount: "", category: "ground" as S<"ExpenseCategory"> });
  const [mode, setMode] = useState<S<"RoundingMode">>(draft?.rounding_mode ?? "exact_paise");
  const [exempt, setExempt] = useState<string[]>(draft?.lines.filter((l) => l.exempt).map((l) => l.player.id) ?? []);
  const [adjust, setAdjust] = useState<Record<string, string>>(Object.fromEntries((draft?.lines ?? []).filter((l) => l.adjusted).map((l) => [l.player.id, String(l.amount_paise / 100)])));
  const [instructions, setInstructions] = useState(draft?.payment_instructions ?? published?.payment_instructions ?? "");
  const [reason, setReason] = useState("");
  const add = useAction(() => fees.addExpense(matchId, { label: exp.label, amount_paise: rupeesToPaise(exp.amount), category: exp.category }), {
    invalidate: INV, success: "Expense added", onSuccess: () => setExp({ ...exp, label: "", amount: "" }),
  });
  const remove = useAction((eid: string) => fees.removeExpense(matchId, eid), { invalidate: INV, success: "Expense removed" });
  const total = (expenses.data ?? []).reduce((a, e) => a + e.amount_paise, 0);
  const preview = useAction(() => fees.draft(matchId, {
    rounding_mode: mode, exempt_player_ids: exempt, payment_instructions: instructions || null, revision_reason: published ? reason || "Updated expenses" : null,
    adjustments: Object.entries(adjust).filter(([, v]) => v !== "").map(([player_id, v]) => ({ player_id, amount_paise: rupeesToPaise(v) })),
  }), { invalidate: INV, success: "Draft calculated. Review before publishing." });
  const publish = useAction((sid: string) => fees.publish(sid), { invalidate: INV, success: "Published. Payees have been notified." });
  const changed = useMemo(() => !!published && total !== published.total_expenses_paise, [published, total]);
  const amountOk = exp.label.trim() && rupeesToPaise(exp.amount) > 0;

  return (
    <div className="space-y-6">
      <section>
        <SectionHeader title="Expenses" subtitle={`Total ${formatPaise(total)}`} />
        <Card className="divide-y divide-sand-200">
          {(expenses.data ?? []).map((e) => (
            <div key={e.id} className="flex items-center gap-3 p-3.5">
              <Badge>{e.category}</Badge><span className="flex-1 text-sm font-medium">{e.label}</span>
              <span className="tabular font-semibold">{formatPaise(e.amount_paise)}</span>
              <Button variant="ghost" size="icon" aria-label={`Remove ${e.label}`} onClick={() => remove.mutate(e.id)}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <form className="grid grid-cols-[1fr_7rem] gap-2 p-3 sm:grid-cols-[8rem_1fr_8rem_auto]" onSubmit={(e) => { e.preventDefault(); if (amountOk) add.mutate(undefined); }}>
            <Select aria-label="Category" className="col-span-2 sm:col-span-1" value={exp.category} onChange={(e) => setExp({ ...exp, category: e.target.value as S<"ExpenseCategory"> })}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            <Input aria-label="Expense" placeholder="Ground booking" value={exp.label} onChange={(e) => setExp({ ...exp, label: e.target.value })} />
            <Input aria-label="Amount in rupees" inputMode="decimal" placeholder="₹" value={exp.amount} onChange={(e) => setExp({ ...exp, amount: e.target.value })} />
            <Button type="submit" className="col-span-2 sm:col-span-1" icon={<Plus className="size-4" />} disabled={!amountOk} loading={add.isPending}>Add</Button>
          </form>
        </Card>
      </section>

      <section>
        <SectionHeader title={published ? "Revise settlement" : "Calculate split"} subtitle="Contribution = eligible expenses ÷ eligible players" />
        <Card className="space-y-4 p-5">
          {published && <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-900">A settlement is already published{changed ? " and expenses have changed" : ""}. Publishing a revision keeps payments already made as credit.</p>}
          <Segmented label="Rounding" value={mode} onChange={setMode} options={[{ value: "exact_paise", label: "Exact (to the paisa)" }, { value: "round_up_rupee", label: "Round up to ₹1" }]} />
          <div>
            <p className="mb-2 text-sm font-medium text-ink-700">Players · exempt or set a fixed amount</p>
            <ul className="divide-y divide-sand-200 rounded-2xl ring-1 ring-sand-200">
              {(roster.data?.active ?? []).map((e) => (
                <li key={e.player.id} className="flex items-center gap-3 p-2.5">
                  <Avatar name={e.player.full_name} src={e.player.profile_image} size="sm" />
                  <span className="flex-1 truncate text-sm">{e.player.full_name}{e.contribution_type === "non_payee" && <Badge className="ml-2">non-payee</Badge>}</span>
                  {e.contribution_type === "payee" && <>
                    <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="size-4 accent-brand-700" checked={exempt.includes(e.player.id)} onChange={(ev) => setExempt(ev.target.checked ? [...exempt, e.player.id] : exempt.filter((x) => x !== e.player.id))} />Exempt</label>
                    <Input aria-label={`Fixed amount for ${e.player.full_name}`} className="h-9 w-24 text-sm" inputMode="decimal" placeholder="Auto" disabled={exempt.includes(e.player.id)} value={adjust[e.player.id] ?? ""} onChange={(ev) => setAdjust({ ...adjust, [e.player.id]: ev.target.value })} />
                  </>}
                </li>
              ))}
            </ul>
          </div>
          <Field label="Payment instructions" hint="Shown to players. Never share a UPI PIN or bank password.">{(fid) => <Textarea id={fid} maxLength={2000} placeholder="UPI: skipper@okhdfc or cash at the ground" value={instructions} onChange={(e) => setInstructions(e.target.value)} />}</Field>
          {published && <Field label="Reason for revision">{(fid) => <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Added refreshments" />}</Field>}
          <Button block variant="soft" size="lg" disabled={!total} loading={preview.isPending} onClick={() => preview.mutate(undefined)}>Calculate draft</Button>
        </Card>
      </section>

      {draft && (
        <section>
          <SectionHeader title={`Review draft (v${draft.version})`} />
          <Card className="space-y-4 p-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total" value={formatPaise(draft.total_expenses_paise)} />
              <Stat label="Eligible" value={draft.eligible_players} />
              <Stat label="Per head" value={formatPaise(draft.individual_contribution_paise)} tone="brand" />
              <Stat label="Rounding" value={formatPaise(draft.rounding_adjustment_paise)} sub={draft.rounding_adjustment_paise ? "surplus" : "none"} />
            </div>
            <ul className="divide-y divide-sand-200">
              {draft.lines.map((l) => (
                <li key={l.player.id} className="flex items-center justify-between py-2 text-sm">
                  <span>{l.player.full_name} {l.exempt && <Badge>exempt</Badge>} {l.adjusted && <Badge tone="info">fixed</Badge>} {!l.eligible && !l.exempt && <Badge>non-payee</Badge>}</span>
                  <span className="tabular font-semibold">{formatPaise(l.amount_paise)}{l.credited_paise > 0 && <span className="ml-1 text-xs font-normal text-brand-700">({formatPaise(l.credited_paise)} credited)</span>}</span>
                </li>
              ))}
            </ul>
            <Button block size="lg" loading={publish.isPending} onClick={() => publish.mutate(draft.id)}>Publish to players</Button>
            <p className="text-center text-xs text-ink-500">Once published, this settlement can't be edited, only revised.</p>
          </Card>
        </section>
      )}
    </div>
  );
}

function PaymentsBoard({ settlement, manager }: { settlement: S<"SettlementOut">; manager: boolean }) {
  const meId = useAuth((s) => s.user?.id);
  const dash = usePaymentsDashboard(settlement.id);
  const [action, setAction] = useState<{ kind: "paid" | "correct" | "dispute"; rec: S<"PaymentRecordOut"> } | null>(null);
  const [thread, setThread] = useState<S<"PaymentRecordOut"> | null>(null);
  const share = useAction(() => fees.share(settlement.id), { silent: false, onSuccess: (r) => window.open(r.whatsapp_url, "_blank", "noopener") });
  const copy = useAction(() => fees.share(settlement.id), { onSuccess: async (r) => { await navigator.clipboard.writeText(r.text); toast.success("Summary copied"); } });
  const remind = useAction((pid: string) => fees.remind(settlement.id, pid), { success: "In-app reminder sent", onSuccess: (r) => window.open(r.whatsapp_url, "_blank", "noopener") });
  const exempt = useAction((pid: string) => fees.markExempted(settlement.id, pid), { invalidate: INV, success: "Marked exempted" });
  return (
    <QueryState query={dash} skeleton={<Spinner />}>
      {(d) => (
        <section className="space-y-4">
          <SectionHeader title={manager ? "Payment dashboard" : "Match fees"} subtitle={`Settlement ${d.settlement.settlement_code} · v${d.settlement.version}`}
            action={<div className="flex gap-1"><Button size="icon" variant="secondary" aria-label="Copy summary" onClick={() => copy.mutate(undefined)}><Copy className="size-4" /></Button>
              <Button size="sm" variant="secondary" icon={<Share2 className="size-4" />} onClick={() => share.mutate(undefined)}>WhatsApp</Button></div>} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total" value={formatPaise(d.total_paise)} />
            <Stat label="Per head" value={formatPaise(d.individual_contribution_paise)} sub={`${d.eligible_players} eligible`} />
            <Stat label="Collected" value={formatPaise(d.collected_paise)} tone="success" />
            <Stat label="Outstanding" value={formatPaise(d.outstanding_paise)} tone={d.outstanding_paise ? "danger" : "default"} />
          </div>
          <Card className="divide-y divide-sand-200 overflow-hidden">
            {d.settlement.expenses.map((e, i) => <div key={i} className="flex justify-between bg-sand-50 px-4 py-2 text-sm text-ink-700"><span>{e.label}</span><span className="tabular">{formatPaise(e.amount_paise)}</span></div>)}
            {d.settlement.payment_instructions && <p className="bg-brand-50 px-4 py-2.5 text-sm text-brand-900"><strong>Pay to:</strong> {d.settlement.payment_instructions}</p>}
            {d.records.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 p-3.5">
                <Avatar name={r.player.full_name} src={r.player.profile_image} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.player.full_name}</p>
                  <p className="text-xs text-ink-500">{r.status === "paid" ? `Marked paid by captain${r.method ? ` · ${r.method}` : ""}` : r.dispute_reason ? `Dispute: ${r.dispute_reason}` : r.remarks ?? ""}</p>
                </div>
                <span className="tabular text-sm font-bold">{formatPaise(r.amount_paise)}</span>
                <StatusBadge status={r.status} label={PAYMENT_STATUS_LABELS[r.status]} />
                <div className="flex w-full justify-end gap-1 sm:w-auto">
                  {manager && (r.status === "pending" || r.status === "disputed") && <>
                    <Button size="sm" icon={<Check className="size-4" />} onClick={() => setAction({ kind: "paid", rec: r })}>Paid</Button>
                    <Button size="sm" variant="secondary" onClick={() => exempt.mutate(r.player.id)}>Exempt</Button>
                    {r.status === "pending" && <Button size="icon" variant="ghost" aria-label={`Remind ${r.player.full_name}`} onClick={() => remind.mutate(r.player.id)}><BellRing className="size-4" /></Button>}
                  </>}
                  {manager && (r.status === "paid" || r.status === "exempted") && <Button size="sm" variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setAction({ kind: "correct", rec: r })}>Correct</Button>}
                  {!manager && r.player.id === meId && (r.status === "pending" || r.status === "paid") && <Button size="sm" variant="ghost" onClick={() => setAction({ kind: "dispute", rec: r })}>Dispute</Button>}
                  <Button size="icon" variant="ghost" aria-label="Fee discussion" onClick={() => setThread(r)}><MessageSquare className="size-4" /></Button>
                </div>
              </div>
            ))}
          </Card>
          {action && <ActionSheet settlementId={settlement.id} {...action} onClose={() => setAction(null)} />}
          {thread && <DiscussionSheet record={thread} onClose={() => setThread(null)} />}
        </section>
      )}
    </QueryState>
  );
}

function ActionSheet({ settlementId, kind, rec, onClose }: { settlementId: string; kind: "paid" | "correct" | "dispute"; rec: S<"PaymentRecordOut">; onClose: () => void }) {
  const [method, setMethod] = useState<S<"PaymentMethod">>("upi");
  const [text, setText] = useState("");
  const [status, setStatus] = useState<S<"PaymentStatus">>("pending");
  const pid = rec.player.id;
  const run = useAction(() => (kind === "paid" ? fees.markPaid(settlementId, pid, { method, remarks: text || null })
    : kind === "correct" ? fees.correct(settlementId, pid, { status, reason: text })
    : fees.dispute(settlementId, pid, text)), { invalidate: INV, success: kind === "paid" ? "Marked paid. Player notified." : kind === "correct" ? "Corrected (audited)" : "Dispute raised. Captain notified.", onSuccess: onClose });
  const title = kind === "paid" ? `Mark ${rec.player.full_name} as paid` : kind === "correct" ? "Correct payment status" : "Raise a payment dispute";
  const needsText = kind !== "paid";
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title={title} description={formatPaise(rec.amount_paise)}
      footer={<Button block size="lg" disabled={needsText && text.trim().length < 3} loading={run.isPending} onClick={() => run.mutate(undefined)}>Confirm</Button>}>
      <div className="space-y-4">
        {kind === "paid" && <Field label="Paid via">{(id) => <Select id={id} value={method} onChange={(e) => setMethod(e.target.value as S<"PaymentMethod">)}>
          {(["upi", "gpay", "phonepe", "paytm", "cash", "bank_transfer", "other"] as const).map((m) => <option key={m} value={m}>{m.replace("_", " ").toUpperCase()}</option>)}</Select>}</Field>}
        {kind === "correct" && <Field label="Correct status to">{(id) => <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as S<"PaymentStatus">)}>
          {(["pending", "paid", "exempted"] as const).filter((s) => s !== rec.status).map((s) => <option key={s} value={s}>{PAYMENT_STATUS_LABELS[s]}</option>)}</Select>}</Field>}
        <Field label={kind === "paid" ? "Remarks" : kind === "correct" ? "Reason (required, audited)" : "What's wrong?"} optional={kind === "paid"}>
          {(id) => <Textarea id={id} maxLength={200} value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "dispute" ? "I paid ₹600 cash to Arjun before the match" : ""} />}
        </Field>
        {kind === "paid" && <p className="text-xs text-ink-500">Only confirm money you've actually received. This is recorded with your name and the time.</p>}
      </div>
    </Sheet>
  );
}
