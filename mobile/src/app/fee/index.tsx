/**
 * Split a match fee. Works for pickup matches (ledger = match id) and team-vs-team matches
 * (ledger = this team's fee side, opened from the match centre). GoFindr only records who has
 * paid: money goes directly to the captain (cash/UPI); no payment is processed here.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { formatPaise, rupeesToPaise, type S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { BadgeCheck, Ban, BellRing, Plus, Share2, Trash2, Wallet } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";

import { FilterBottomSheet, PromptModal } from "@/components/sheet";
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorBox, Field, LoadingSkeleton, Section, Segmented, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { when } from "@/lib/format";
import { R, SP, T } from "@/theme";
import { ShieldCrest } from "@/components/identity";

type Expense = S<"ExpenseOut">;
type Settlement = S<"SettlementOut">;
type Dashboard = S<"CaptainDashboardOut">;
type Side = S<"FeeSideOut">;
type Record_ = S<"PaymentRecordOut">;

const CATS: { v: S<"ExpenseCategory">; l: string }[] = [
  { v: "ground", l: "Ground" }, { v: "balls", l: "Balls" }, { v: "umpire", l: "Umpire" }, { v: "refreshments", l: "Refreshments" },
  { v: "equipment", l: "Equipment" }, { v: "travel", l: "Travel" }, { v: "other", l: "Other" },
];
const METHODS: { v: S<"PaymentMethod">; l: string }[] = [
  { v: "upi", l: "UPI" }, { v: "cash", l: "Cash" }, { v: "gpay", l: "GPay" }, { v: "phonepe", l: "PhonePe" }, { v: "paytm", l: "Paytm" }, { v: "bank_transfer", l: "Bank" },
];
const STATUS: Record<string, [string, string]> = { pending: ["warning", "Pending"], paid: ["success", "Paid"], exempted: ["neutral", "Exempt"], disputed: ["danger", "Disputed"] };

export default function SplitFee() {
  const p = useLocalSearchParams<{ ledger?: string; fixture?: string; team?: string; title?: string }>();
  const qc = useQueryClient();
  const { user } = useAuth();
  // team-vs-team: open (or create) this team's ledger first
  // A ledger id is either a pickup match or a team-vs-team fee side; work out which.
  const match = useQuery({ queryKey: ["match", p.ledger], enabled: !!p.ledger, retry: false, queryFn: () => api<S<"MatchOut">>(`/matches/${p.ledger}`) });
  const isSide = !!p.fixture || (!!p.ledger && match.isError);
  const side = useQuery({
    queryKey: ["fee-side", p.fixture ?? p.ledger, p.team], enabled: isSide,
    queryFn: () => (p.fixture ? api<Side>(`/fixtures/${p.fixture}/fees/${p.team}`, { method: "POST", body: {} }) : api<Side>(`/fees/${p.ledger}`)),
  });
  const ledger = p.ledger ?? side.data?.id;
  const expenses = useQuery({ queryKey: ["fee", ledger, "expenses"], enabled: !!ledger, queryFn: () => api<Expense[]>(`/matches/${ledger}/expenses`) });
  const versions = useQuery({ queryKey: ["fee", ledger, "settlements"], enabled: !!ledger, queryFn: () => api<Settlement[]>(`/matches/${ledger}/settlements`) });
  const published = versions.data?.find((v) => v.settlement_status === "published");
  const draft = versions.data?.find((v) => v.settlement_status === "draft");
  const dash = useQuery({ queryKey: ["fee", published?.id, "dash"], enabled: !!published, queryFn: () => api<Dashboard>(`/settlements/${published!.id}/payments`) });
  const manager = isSide ? !!side.data?.can_manage : match.data?.viewer_relation === "manager";
  const title = p.title ?? side.data?.title ?? match.data?.title ?? "Match fee";
  const reload = () => { for (const k of [["fee", ledger], ["fee-side", p.fixture], ["payments"], ["fee", published?.id]]) void qc.invalidateQueries({ queryKey: k }); };

  if (side.isError) return <Shell title={title}><ErrorBox error={side.error} /></Shell>;
  if (!ledger || (p.ledger && match.isPending) || (isSide && side.isPending) || expenses.isPending || versions.isPending) return <Shell title={title}><LoadingSkeleton rows={4} /></Shell>;
  if (expenses.isError) return <Shell title={title}><ErrorBox error={expenses.error} onRetry={reload} /></Shell>;

  const total = (expenses.data ?? []).reduce((a, e) => a + e.amount_paise, 0);
  return (
    <Shell title={title} start={side.data?.start_at ?? match.data?.start_at} venue={match.data?.venue?.name ?? undefined}>
      <Summary total={dash.data?.total_paise ?? total} collected={dash.data?.collected_paise ?? 0} outstanding={dash.data?.outstanding_paise ?? 0}
        perHead={(published ?? draft)?.individual_contribution_paise} payers={(published ?? draft)?.eligible_players} state={published ? "published" : draft ? "draft" : "none"}
        start={side.data?.start_at ?? match.data?.start_at} records={dash.data?.records} me={user?.id} />
      {manager ? (
        <Manager ledger={ledger} side={side.data} expenses={expenses.data ?? []} draft={draft} published={published} dash={dash.data} onChange={reload} />
      ) : published && dash.data ? (
        <PlayerView dash={dash.data} me={user?.id} onChange={reload} />
      ) : (
        <EmptyState icon={<Wallet size={22} color={T.ink} strokeWidth={1.5} />} title="No fee published yet" body="Your captain hasn't shared the match fee split. You'll be notified when they do." />
      )}
      <Txt v="small" color={T.muted}>GoFindr doesn't process payments. Pay your captain directly by cash or UPI; they mark it paid here. Never share a UPI PIN.</Txt>
    </Shell>
  );
}

/** "Match expenses" header: both teams as crests when it's a team-vs-team match, else the match title. */
function Shell({ title, children, start, venue }: { title: string; children: React.ReactNode; start?: string; venue?: string }) {
  const [a, b] = title.includes(" vs ") ? title.split(" vs ") : [null, null];
  return (
    <>
      <Stack.Screen options={{ title: "Match expenses" }} />
      <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.xl, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        {a && b ? (
          <View style={{ alignItems: "center", gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 8 }}>
              <View style={{ alignItems: "center", gap: 4, width: 138 }}><ShieldCrest name={a} size={70} /><Txt v="h3" numberOfLines={2} style={{ textAlign: "center" }}>{a}</Txt></View>
              <Txt v="h2" color={T.muted}>vs</Txt>
              <View style={{ alignItems: "center", gap: 4, width: 138 }}><ShieldCrest name={b} size={70} /><Txt v="h3" numberOfLines={2} style={{ textAlign: "center" }}>{b}</Txt></View>
            </View>
            {start ? <Txt v="bodyMed">{when(start, { weekday: "short", day: "numeric", month: "short" })} • {when(start, { hour: "numeric", minute: "2-digit" })}</Txt> : null}
            {venue ? <Txt v="small" color={T.muted}>{venue}</Txt> : null}
          </View>
        ) : (
          <View style={{ gap: 2 }}>
            <Txt v="h1">{title}</Txt>
            {start ? <Txt v="small" color={T.muted}>{when(start)}{venue ? ` · ${venue}` : ""}</Txt> : null}
          </View>
        )}
        {children}
      </ScrollView>
    </>
  );
}

function Summary({ total, collected, outstanding, perHead, payers, state, records, me }: { total: number; collected: number; outstanding: number; perHead?: number; payers?: number; state: "none" | "draft" | "published"; start?: string; records?: Record_[]; me?: string }) {
  const mine = records?.find((r) => r.player.id === me);
  const people = records ?? [];
  return (
    <View style={{ gap: SP.lg }}>
      <View style={{ alignItems: "center", gap: 4, paddingVertical: 18, borderRadius: R.card, backgroundColor: T.primarySoft }}>
        <Txt v="bodyMed">Total match cost</Txt>
        <Txt v="display" style={{ fontSize: 32, lineHeight: 38 }}>{formatPaise(total)}</Txt>
        <Badge status={state === "published" ? "success" : state === "draft" ? "warning" : "neutral"} label={state === "published" ? `Shared · ${formatPaise(collected)} collected · ${formatPaise(outstanding)} to go` : state === "draft" ? "Draft — not shared yet" : "Not split yet"} />
      </View>
      {people.length || payers ? (
        <View style={{ gap: SP.sm }}>
          <Txt v="h2">Participants ({people.length || payers})</Txt>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {people.slice(0, 5).map((r, i) => <View key={r.id} style={{ marginLeft: i ? -6 : 0, borderRadius: 30, borderWidth: 3, borderColor: T.bg }}><Avatar uri={r.player.profile_image} name={r.player.full_name} size={44} /></View>)}
            {people.length > 5 ? <View style={{ marginLeft: -6, width: 50, height: 50, borderRadius: 25, borderWidth: 3, borderColor: T.bg, backgroundColor: T.surface2, alignItems: "center", justifyContent: "center" }}><Txt v="smallSemi" color={T.muted}>+{people.length - 5}</Txt></View> : null}
          </View>
        </View>
      ) : null}
      {mine || perHead ? (
        <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ gap: 2 }}>
            <Txt v="small" color={T.muted}>{mine ? "Your share" : "Share per player"}</Txt>
            <Txt v="metric" style={{ fontSize: 26 }}>{formatPaise(mine?.amount_paise ?? perHead ?? 0)}</Txt>
          </View>
          {mine ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: R.pill, backgroundColor: mine.status === "paid" ? T.successBackground : T.warningBackground }}>
              {mine.status === "paid" ? <BadgeCheck size={16} color={T.surface} fill={T.successText} strokeWidth={2} /> : null}
              <Txt v="smallSemi" color={mine.status === "paid" ? T.successText : T.warningText}>{STATUS[mine.status]?.[1] ?? mine.status}</Txt>
            </View>
          ) : null}
        </Card>
      ) : null}
      {mine?.status === "paid" ? <Txt v="small" color={T.muted}>Marked paid by {mine.captain.full_name}. This is a manual record — GoFindr doesn't process or verify payments.</Txt> : null}
    </View>
  );
}

function Manager({ ledger, side, expenses, draft, published, dash, onChange }: {
  ledger: string; side?: Side; expenses: Expense[]; draft?: Settlement; published?: Settlement; dash?: Dashboard; onChange: () => void;
}) {
  const [tab, setTab] = useState<"setup" | "collect">(published ? "collect" : "setup");
  return (
    <View style={{ gap: SP.xl }}>
      <Segmented value={tab} onChange={setTab} options={[{ v: "setup", l: published ? "Revise split" : "Set up split" }, { v: "collect", l: "Collect payments" }]} />
      {tab === "setup" ? (
        <>
          <Expenses ledger={ledger} expenses={expenses} onChange={onChange} />
          {side ? <Squad key={side.members.map((m) => `${m.user.id}${m.in_squad}${m.contribution_type}`).join()} side={side} onChange={onChange} /> : null}
          <Split ledger={ledger} draft={draft} published={published} hasExpenses={expenses.length > 0} onChange={() => { onChange(); }} onPublished={() => setTab("collect")} />
        </>
      ) : dash ? <Collect dash={dash} onChange={onChange} /> : (
        <EmptyState icon={<Wallet size={22} color={T.ink} strokeWidth={1.5} />} title="Nothing to collect yet" body="Publish the split first. Every paying player is notified with their amount and your payment instructions." />
      )}
    </View>
  );
}

function Expenses({ ledger, expenses, onChange }: { ledger: string; expenses: Expense[]; onChange: () => void }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [cat, setCat] = useState<S<"ExpenseCategory">>("ground");
  const add = useMutation({
    mutationFn: () => api(`/matches/${ledger}/expenses`, { method: "POST", body: { label: label || CATS.find((c) => c.v === cat)!.l, category: cat, amount_paise: rupeesToPaise(amount) } }),
    onSuccess: () => { setLabel(""); setAmount(""); onChange(); },
    onError: (e) => Alert.alert("Couldn't add expense", errorText(e)),
  });
  const remove = async (id: string) => { try { await api(`/matches/${ledger}/expenses/${id}`, { method: "DELETE" }); onChange(); } catch (e) { Alert.alert("Couldn't remove", errorText(e)); } };
  const valid = rupeesToPaise(amount) > 0;
  return (
    <Section title="1 · Expenses">
      <Card style={{ gap: 0 }}>
        {expenses.length ? expenses.map((e, i) => (
          <View key={e.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: T.line }}>
            <View style={{ flex: 1 }}>
              <Txt v="bodyMed">{e.label}</Txt>
              <Txt v="small" color={T.muted}>{CATS.find((c) => c.v === e.category)?.l ?? e.category}</Txt>
            </View>
            <Txt v="number" style={{ fontSize: 16 }}>{formatPaise(e.amount_paise)}</Txt>
            <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${e.label}`} onPress={() => void remove(e.id)} hitSlop={10}><Trash2 size={17} color={T.muted} strokeWidth={1.5} /></Pressable>
          </View>
        )) : <Txt v="small" color={T.muted}>No expenses yet. Add the ground booking, balls, umpire and so on.</Txt>}
      </Card>
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{CATS.map((c) => <Chip key={c.v} label={c.l} active={cat === c.v} onPress={() => setCat(c.v)} />)}</View>
        <View style={{ flexDirection: "row", gap: SP.sm, alignItems: "flex-end" }}>
          <View style={{ flex: 1 }}><Field label="Description (optional)" value={label} onChangeText={setLabel} placeholder={CATS.find((c) => c.v === cat)!.l} maxLength={60} /></View>
          <View style={{ width: 120 }}><Field label="Amount (₹)" value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ""))} keyboardType="decimal-pad" placeholder="3000" /></View>
        </View>
        <Button title="Add expense" size="sm" variant="secondary" icon={<Plus size={15} color={T.ink} strokeWidth={1.5} />} disabled={!valid} loading={add.isPending} onPress={() => add.mutate()} />
      </Card>
    </Section>
  );
}

function Squad({ side, onChange }: { side: Side; onChange: () => void }) {
  type St = "pays" | "free" | "out";
  const initial = useMemo(() => Object.fromEntries(side.members.map((m) => [m.user.id, (m.in_squad ? (m.contribution_type === "non_payee" ? "free" : "pays") : "out") as St])), [side]);
  const [state, setState] = useState<Record<string, St>>(initial);
  const dirty = side.members.some((m) => state[m.user.id] !== initial[m.user.id]);
  const save = useMutation({
    mutationFn: () => api(`/fees/${side.id}/squad`, { method: "PUT", body: {
      player_ids: Object.entries(state).filter(([, v]) => v !== "out").map(([k]) => k),
      non_payee_ids: Object.entries(state).filter(([, v]) => v === "free").map(([k]) => k),
    } }),
    onSuccess: onChange,
    onError: (e) => Alert.alert("Couldn't save the squad", errorText(e)),
  });
  const payers = Object.values(state).filter((v) => v === "pays").length;
  return (
    <Section title="2 · Who shares the fee">
      <Txt v="small" color={T.muted}>{side.team_name} pays its own share. Pick the players splitting it; mark anyone playing for free.</Txt>
      <Card style={{ gap: 0 }}>
        {side.members.map((m, i) => (
          <View key={m.user.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: T.line }}>
            <Avatar uri={m.user.profile_image} name={m.user.full_name} size={34} />
            <Txt v="bodyMed" style={{ flex: 1 }} numberOfLines={1}>{m.user.full_name}</Txt>
            <View style={{ flexDirection: "row", gap: 4 }}>
              {(["pays", "free", "out"] as const).map((v) => (
                <Chip key={v} label={{ pays: "Pays", free: "Free", out: "Out" }[v]} active={state[m.user.id] === v} onPress={() => setState({ ...state, [m.user.id]: v })} />
              ))}
            </View>
          </View>
        ))}
      </Card>
      {dirty ? <Button title={`Save squad · ${payers} paying`} size="sm" disabled={!payers} loading={save.isPending} onPress={() => save.mutate()} /> : null}
    </Section>
  );
}

function Split({ ledger, draft, published, hasExpenses, onChange, onPublished }: { ledger: string; draft?: Settlement; published?: Settlement; hasExpenses: boolean; onChange: () => void; onPublished: () => void }) {
  const base = draft ?? published;
  const [exempt, setExempt] = useState<string[]>(base?.lines.filter((l) => l.exempt).map((l) => l.player.id) ?? []);
  const [rounding, setRounding] = useState<S<"RoundingMode">>(base?.rounding_mode ?? "exact_paise");
  const [instructions, setInstructions] = useState(base?.payment_instructions ?? "");
  const [reason, setReason] = useState("");
  const calc = useMutation({
    mutationFn: () => api<Settlement>(`/matches/${ledger}/settlements`, { method: "POST", body: {
      rounding_mode: rounding, exempt_player_ids: exempt, payment_instructions: instructions || null, revision_reason: published ? reason || "Updated split" : null,
    } }),
    onSuccess: onChange,
    onError: (e) => Alert.alert("Couldn't calculate the split", errorText(e)),
  });
  const publish = useMutation({
    mutationFn: (id: string) => api<Settlement>(`/settlements/${id}/publish`, { method: "POST", body: {} }),
    onSuccess: () => { onChange(); onPublished(); Alert.alert("Split shared", "Every paying player has been notified of their amount."); },
    onError: (e) => Alert.alert("Couldn't publish", errorText(e)),
  });
  return (
    <Section title={published ? "3 · Revise the split" : "3 · Split & share"}>
      {!hasExpenses ? <Txt v="small" color={T.muted}>Add at least one expense first.</Txt> : null}
      <Card>
        <Txt v="smallSemi" color={T.text2}>Rounding</Txt>
        <Segmented value={rounding} onChange={setRounding} options={[{ v: "exact_paise", l: "Exact" }, { v: "round_up_rupee", l: "Round up to ₹1" }]} />
        <Field label="How should players pay you?" value={instructions} onChangeText={setInstructions} placeholder="e.g. UPI to rahul@okaxis or cash at the ground" hint="Shown to players. Never enter a UPI PIN or password." maxLength={300} />
        {published ? <Field label="Reason for revising" value={reason} onChangeText={setReason} placeholder="e.g. Umpire fee added" maxLength={120} /> : null}
        <Button title={draft ? "Recalculate split" : "Calculate split"} variant="secondary" disabled={!hasExpenses} loading={calc.isPending} onPress={() => calc.mutate()} />
      </Card>
      {draft ? (
        <Card style={{ gap: 0 }}>
          <View style={{ flexDirection: "row", paddingBottom: 8 }}>
            <Txt v="label" color={T.muted} style={{ flex: 1 }}>Preview · tap to exempt</Txt>
            <Txt v="label" color={T.muted}>{formatPaise(draft.total_assigned_paise)}</Txt>
          </View>
          {draft.lines.map((l) => {
            const ex = exempt.includes(l.player.id);
            return (
              <Pressable key={l.player.id} accessibilityRole="checkbox" accessibilityState={{ checked: !ex }} onPress={() => setExempt(ex ? exempt.filter((x) => x !== l.player.id) : [...exempt, l.player.id])}
                style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: T.line }}>
                <Avatar uri={l.player.profile_image} name={l.player.full_name} size={30} />
                <Txt v="bodyMed" style={{ flex: 1 }} numberOfLines={1}>{l.player.full_name}</Txt>
                {!l.eligible ? <Badge status="neutral" label={l.contribution_type === "non_payee" ? "Plays free" : "Exempt"} /> : null}
                <Txt v="number" style={{ fontSize: 15 }} color={l.eligible ? T.text : T.muted}>{formatPaise(l.amount_paise)}</Txt>
              </Pressable>
            );
          })}
          {draft.rounding_adjustment_paise ? <Txt v="small" color={T.muted} style={{ paddingTop: 8 }}>Rounding adds {formatPaise(draft.rounding_adjustment_paise)} in total.</Txt> : null}
          {JSON.stringify(exempt.slice().sort()) !== JSON.stringify(draft.lines.filter((l) => l.exempt).map((l) => l.player.id).sort()) ? (
            <Txt v="small" color={T.warnText} style={{ paddingTop: 8 }}>Exemptions changed. Recalculate before sharing.</Txt>
          ) : null}
          <Button title={published ? "Share revised split" : "Share with players"} style={{ marginTop: SP.md }} loading={publish.isPending}
            disabled={JSON.stringify(exempt.slice().sort()) !== JSON.stringify(draft.lines.filter((l) => l.exempt).map((l) => l.player.id).sort())}
            onPress={() => publish.mutate(draft.id)} />
        </Card>
      ) : null}
    </Section>
  );
}

function Collect({ dash, onChange }: { dash: Dashboard; onChange: () => void }) {
  const [focus, setFocus] = useState<Record_ | null>(null);
  const [method, setMethod] = useState<S<"PaymentMethod">>("upi");
  const sheet = useRef<BottomSheetModal>(null);
  const sid = dash.settlement.id;
  const act = async (fn: () => Promise<unknown>) => { try { await fn(); sheet.current?.dismiss(); onChange(); } catch (e) { Alert.alert("Couldn't update", errorText(e)); } };
  const openWa = async (path: string) => {
    try { const s = await api<S<"ShareOut">>(path, path.endsWith("/remind") ? { method: "POST", body: {} } : {}); await Linking.openURL(s.whatsapp_url); }
    catch (e) { Alert.alert("Couldn't open WhatsApp", errorText(e)); }
  };
  const order = { disputed: 0, pending: 1, paid: 2, exempted: 3 } as Record<string, number>;
  return (
    <View style={{ gap: SP.md }}>
      <Button title="Share summary on WhatsApp" variant="secondary" icon={<Share2 size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => void openWa(`/settlements/${sid}/share`)} />
      {dash.settlement.payment_instructions ? <Txt v="small" color={T.text2}>Players were told: “{dash.settlement.payment_instructions}”</Txt> : null}
      {dash.records.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)).map((r) => (
        <Card key={r.id} onPress={() => { setFocus(r); sheet.current?.present(); }} label={`${r.player.full_name}, ${STATUS[r.status]?.[1]}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar uri={r.player.profile_image} name={r.player.full_name} size={40} />
            <View style={{ flex: 1 }}>
              <Txt v="h3" numberOfLines={1}>{r.player.full_name}</Txt>
              <Txt v="small" color={T.muted}>{r.status === "paid" && r.method ? `Paid by ${METHODS.find((m) => m.v === r.method)?.l ?? r.method}` : r.dispute_reason ? `“${r.dispute_reason}”` : r.balance_paise ? `${formatPaise(r.balance_paise)} to collect` : " "}</Txt>
            </View>
            <View style={{ alignItems: "flex-end", gap: 4 }}>
              <Txt v="number" style={{ fontSize: 16 }}>{formatPaise(r.amount_paise)}</Txt>
              <Badge status={STATUS[r.status]?.[0] ?? "neutral"} label={STATUS[r.status]?.[1] ?? r.status} />
            </View>
          </View>
        </Card>
      ))}
      <FilterBottomSheet ref={sheet} title={focus ? `${focus.player.full_name} · ${formatPaise(focus.amount_paise)}` : ""} snap={["58%"]}>
        {focus ? (
          <View style={{ gap: SP.sm }}>
            {focus.status !== "paid" ? (
              <>
                <Txt v="label" color={T.muted}>Received by</Txt>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{METHODS.map((m) => <Chip key={m.v} label={m.l} active={method === m.v} onPress={() => setMethod(m.v)} />)}</View>
                <Button title="Mark as paid" icon={<BadgeCheck size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => void act(() => api(`/settlements/${sid}/payments/${focus.player.id}/mark-paid`, { method: "POST", body: { method } }))} />
                <Button title="Send reminder (WhatsApp)" variant="secondary" icon={<BellRing size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => { sheet.current?.dismiss(); void openWa(`/settlements/${sid}/payments/${focus.player.id}/remind`); }} />
              </>
            ) : (
              <Button title="Undo: mark as pending" variant="secondary" onPress={() => void act(() => api(`/settlements/${sid}/payments/${focus.player.id}/correct`, { method: "POST", body: { status: "pending", reason: "Marked paid by mistake" } }))} />
            )}
            {focus.status !== "exempted" ? <Button title="Exempt from paying" variant="ghost" icon={<Ban size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => void act(() => api(`/settlements/${sid}/payments/${focus.player.id}/mark-exempted`, { method: "POST", body: {} }))} /> : null}
          </View>
        ) : null}
      </FilterBottomSheet>
    </View>
  );
}

// ---------------------------------------------------------------- player
function PlayerView({ dash, me, onChange }: { dash: Dashboard; me?: string; onChange: () => void }) {
  const mine = dash.records.find((r) => r.player.id === me);
  const [disputing, setDisputing] = useState(false);
  return (
    <View style={{ gap: SP.md }}>
      {mine ? (
        <Card surface>
          <Txt v="label" color={T.accent}>Your share</Txt>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Txt v="stat">{formatPaise(mine.amount_paise)}</Txt>
            <Badge status={STATUS[mine.status]?.[0] ?? "neutral"} label={STATUS[mine.status]?.[1] ?? mine.status} />
          </View>
          {dash.settlement.payment_instructions ? <Txt v="body" color={T.text2}>Pay {mine.captain.full_name}: {dash.settlement.payment_instructions}</Txt> : <Txt v="small" color={T.muted}>Pay {mine.captain.full_name} directly by cash or UPI.</Txt>}
          {["pending", "paid"].includes(mine.status) ? <Button title="Something's wrong? Raise a dispute" variant="ghost" size="sm" onPress={() => setDisputing(true)} /> : null}
        </Card>
      ) : null}
      <Section title="Breakdown">
        <Card style={{ gap: 0 }}>
          {dash.settlement.expenses.map((e, i) => (
            <View key={i} style={{ flexDirection: "row", paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: T.line }}>
              <Txt v="body" style={{ flex: 1 }}>{e.label}</Txt><Txt v="smallSemi">{formatPaise(e.amount_paise)}</Txt>
            </View>
          ))}
        </Card>
        <Card style={{ gap: 0 }}>
          {dash.records.map((r, i) => (
            <View key={r.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: T.line }}>
              <Txt v="bodyMed" style={{ flex: 1 }} numberOfLines={1}>{r.player.full_name}{r.player.id === me ? " (you)" : ""}</Txt>
              <Txt v="small" color={T.text2}>{formatPaise(r.amount_paise)}</Txt>
              <Badge status={STATUS[r.status]?.[0] ?? "neutral"} label={STATUS[r.status]?.[1] ?? r.status} />
            </View>
          ))}
        </Card>
      </Section>
      <PromptModal visible={disputing} title="Raise a payment dispute" body="Your captain is notified and the record is flagged until it's sorted out." placeholder="e.g. I paid ₹300 in cash on Sunday" minLength={3} confirm="Raise dispute"
        onCancel={() => setDisputing(false)}
        onSubmit={async (reason) => { setDisputing(false); try { await api(`/settlements/${mine!.settlement_id}/payments/${mine!.player.id}/dispute`, { method: "POST", body: { reason } }); onChange(); } catch (e) { Alert.alert("Couldn't raise dispute", errorText(e)); } }} />
    </View>
  );
}
