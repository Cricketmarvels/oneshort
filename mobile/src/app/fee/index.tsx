/**
 * Split a match fee. Works for pickup matches (ledger = match id) and team-vs-team matches
 * (ledger = this team's fee side, opened from the match centre). OneShort only records who has
 * paid: money goes directly to the captain (cash/UPI); no payment is processed here.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { formatPaise, rupeesToPaise, type S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Stack, useLocalSearchParams } from "expo-router";
import { BadgeCheck, Ban, BellRing, CheckSquare, Plus, Square, Trash2, UserPlus, Wallet, X } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, ScrollView, View } from "react-native";

import { ShareToGroup } from "@/components/match-admin";
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
/** Same shape the server accepts: name@bank (e.g. rahul@okaxis, 9876543210@ybl). */
const UPI_RE = /^[A-Za-z0-9][A-Za-z0-9.\-_]{1,99}@[A-Za-z][A-Za-z0-9.\-]{1,49}$/;
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
  const reload = () => { for (const k of [["fee", ledger], ["fee-side", p.fixture], ["payments"], ["fee", published?.id], ["fees-to-collect"]]) void qc.invalidateQueries({ queryKey: k }); };

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
      <Txt v="small" color={T.muted}>OneShort doesn't process payments. Pay your captain directly by cash or UPI; they mark it paid here. Never share a UPI PIN.</Txt>
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
      {mine?.status === "paid" ? <Txt v="small" color={T.muted}>Marked paid by {mine.captain.full_name}. This is a manual record — OneShort doesn't process or verify payments.</Txt> : null}
    </View>
  );
}

function Manager({ ledger, side, expenses, draft, published, dash, onChange }: {
  ledger: string; side?: Side; expenses: Expense[]; draft?: Settlement; published?: Settlement; dash?: Dashboard; onChange: () => void;
}) {
  const [tab, setTab] = useState<"setup" | "collect">(published ? "collect" : "setup");
  const base = draft ?? published;
  // Pickup match: the squad comes from the roster and the captain ticks who shares the fee.
  const roster = useQuery({ queryKey: ["roster", ledger], enabled: !side, queryFn: () => api<S<"RosterOut">>(`/matches/${ledger}/roster`) });
  const squad = roster.data?.active ?? [];
  const defaultTicked = squad.filter((e) => !base || base.lines.some((l) => l.player.id === e.player.id && !l.exempt)).map((e) => e.player.id);
  const [ticked, setTicked] = useState<string[] | null>(null);
  const [extras, setExtras] = useState<Extra[]>(() => (base?.lines ?? []).filter((l) => l.added).map((l) => (
    l.guest ? { key: l.player.id, name: l.player.full_name, guest_id: l.player.id } : { key: l.player.id, name: l.player.full_name, user_id: l.player.id })));
  const [changed, setChanged] = useState(false);
  const [adding, setAdding] = useState(false);
  const picked = ticked ?? defaultTicked;
  const who: WhoPays = { ticked: side ? undefined : picked, extras };
  return (
    <View style={{ gap: SP.xl }}>
      <Segmented value={tab} onChange={setTab} options={[{ v: "setup", l: published ? "Revise split" : "Set up split" }, { v: "collect", l: "Collect payments" }]} />
      {tab === "setup" ? (
        <>
          <Expenses ledger={ledger} expenses={expenses} onChange={onChange} />
          {side ? <Squad key={side.members.map((m) => `${m.user.id}${m.in_squad}${m.contribution_type}`).join()} side={side} onChange={onChange} /> : null}
          <Players step={side ? 3 : 2} adding={adding} setAdding={setAdding} squad={side ? null : squad} loading={!side && roster.isPending} ticked={picked} extras={extras}
            onTick={(id) => { setTicked(picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]); setChanged(true); }}
            onAll={(on) => { setTicked(on ? squad.map((e) => e.player.id) : []); setChanged(true); }}
            onAdd={(x) => { setExtras([...extras, x]); setChanged(true); }}
            onRemove={(key) => { setExtras(extras.filter((x) => x.key !== key)); setChanged(true); }} />
          <Split step={side ? 4 : 3} ledger={ledger} draft={draft} published={published} hasExpenses={expenses.length > 0} who={who} changed={changed} onAddPlayer={() => setAdding(true)}
            onCalculated={(st) => { setChanged(false); setTicked(null); setExtras(st.lines.filter((l) => l.added).map((l) => (
              l.guest ? { key: l.player.id, name: l.player.full_name, guest_id: l.player.id } : { key: l.player.id, name: l.player.full_name, user_id: l.player.id }))); }}
            onChange={() => { onChange(); }} onPublished={() => setTab("collect")} />
        </>
      ) : dash ? <Collect dash={dash} ledger={ledger} onChange={onChange} /> : (
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

function Split({ step, ledger, draft, published, hasExpenses, who, changed, onAddPlayer, onCalculated, onChange, onPublished }: {
  step: number; ledger: string; draft?: Settlement; published?: Settlement; hasExpenses: boolean; who: WhoPays; changed: boolean; onAddPlayer: () => void;
  onCalculated: (st: Settlement) => void; onChange: () => void; onPublished: () => void;
}) {
  const base = draft ?? published;
  const [rounding, setRounding] = useState<S<"RoundingMode">>(base?.rounding_mode ?? "exact_paise");
  const [instructions, setInstructions] = useState(base?.payment_instructions ?? "");
  const { user } = useAuth();
  const [upi, setUpi] = useState(base?.upi_id ?? user?.fee_upi_id ?? "");
  const upiOk = !upi.trim() || UPI_RE.test(upi.trim());
  const [reason, setReason] = useState("");
  const nobody = (who.ticked?.length ?? 1) + who.extras.length === 0;
  const calc = useMutation({
    mutationFn: () => api<Settlement>(`/matches/${ledger}/settlements`, { method: "POST", body: {
      rounding_mode: rounding, player_ids: who.ticked ?? null,
      extra_players: who.extras.map(({ name, user_id, guest_id }) => ({ name, user_id: user_id ?? null, guest_id: guest_id ?? null })),
      payment_instructions: instructions || null, upi_id: upi.trim() || null, revision_reason: published ? reason || "Updated split" : null,
    } }),
    onSuccess: (st) => { onCalculated(st); onChange(); },
    onError: (e) => Alert.alert("Couldn't calculate the split", errorText(e)),
  });
  // Adding or unticking a player saves the split straight away, so the preview (and a page reload) always
  // shows who is in it. Waits briefly so a run of ticks makes one request.
  const { mutate, isPending, isError } = calc;
  const auto = changed && hasExpenses && !nobody && upiOk && !isError; // after an error the captain retries by hand
  useEffect(() => {
    if (!auto || isPending) return;
    const t = setTimeout(() => mutate(), 600);
    return () => clearTimeout(t);
  }, [auto, isPending, who, mutate]);
  const publish = useMutation({
    mutationFn: (id: string) => api<Settlement>(`/settlements/${id}/publish`, { method: "POST", body: {} }),
    onSuccess: () => { onChange(); onPublished(); Alert.alert("Split shared", "Every paying player with the app has been notified of their amount. Send the group message for everyone else."); },
    onError: (e) => Alert.alert("Couldn't publish", errorText(e)),
  });
  return (
    <Section title={`${step} · ${published ? "Revise the split" : "Split & share"}`}>
      {!hasExpenses ? <Txt v="small" color={T.muted}>Add at least one expense first.</Txt> : null}
      <Card>
        <Txt v="smallSemi" color={T.text2}>Rounding</Txt>
        <Segmented value={rounding} onChange={setRounding} options={[{ v: "exact_paise", l: "Exact" }, { v: "round_up_rupee", l: "Round up to ₹1" }]} />
        <Field label="Your UPI ID" value={upi} onChangeText={(v) => setUpi(v.replace(/\s/g, ""))} placeholder="e.g. rahul@okaxis or 9876543210@ybl" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" maxLength={100}
          error={upiOk ? null : "That doesn't look like a UPI ID. It should look like name@bank."} hint={upiOk ? "Shown in the WhatsApp message so players can pay you straight away. Remembered for next time. Never share your UPI PIN." : undefined} />
        <Field label="Other payment note (optional)" value={instructions} onChangeText={setInstructions} placeholder="e.g. Cash at the ground is fine too" maxLength={300} />
        {published ? <Field label="Reason for revising" value={reason} onChangeText={setReason} placeholder="e.g. Umpire fee added" maxLength={120} /> : null}
        <Button title={draft ? "Recalculate split" : "Calculate split"} variant={changed || !draft ? "primary" : "secondary"} disabled={!hasExpenses || nobody || !upiOk} loading={calc.isPending} onPress={() => calc.mutate()} />
        {nobody ? <Txt v="small" color={T.warnText}>Tick or add at least one player.</Txt> : null}
      </Card>
      {draft ? (
        <Card style={{ gap: 0 }}>
          <View style={{ flexDirection: "row", paddingBottom: 8 }}>
            <Txt v="label" color={T.muted} style={{ flex: 1 }}>Preview · {draft.eligible_players} paying</Txt>
            <Txt v="label" color={T.muted}>{formatPaise(draft.total_assigned_paise)}</Txt>
          </View>
          {draft.lines.map((l) => (
            <View key={l.player.id} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: T.line }}>
              <Avatar uri={l.player.profile_image} name={l.player.full_name} size={30} />
              <Txt v="bodyMed" style={{ flex: 1 }} numberOfLines={1}>{l.player.full_name}</Txt>
              {l.guest ? <Badge status="info" label="Guest" /> : l.added ? <Badge status="info" label="Added" /> : null}
              {!l.eligible ? <Badge status="neutral" label={l.contribution_type === "non_payee" ? "Plays free" : "Exempt"} /> : null}
              <Txt v="number" style={{ fontSize: 15 }} color={l.eligible ? T.text : T.muted}>{formatPaise(l.amount_paise)}</Txt>
            </View>
          ))}
          {draft.rounding_adjustment_paise ? <Txt v="small" color={T.muted} style={{ paddingTop: 8 }}>Rounding adds {formatPaise(draft.rounding_adjustment_paise)} in total.</Txt> : null}
          <Button title="Someone missing? Add player" variant="ghost" size="sm" icon={<UserPlus size={16} color={T.primaryDark} strokeWidth={1.5} />} onPress={onAddPlayer} style={{ marginTop: 6 }} />
          {changed ? <Txt v="small" color={T.muted} style={{ paddingTop: 8 }}>Updating the split…</Txt> : null}
          <Button title={published ? "Share revised split" : "Share with players"} style={{ marginTop: SP.md }} loading={publish.isPending}
            disabled={changed} onPress={() => publish.mutate(draft.id)} />
        </Card>
      ) : null}
      {draft && !changed ? <GroupMessage ledger={ledger} settlementId={draft.id} stamp={`${draft.total_assigned_paise}-${draft.lines.length}-${draft.payment_instructions ?? ""}`}
        note="Ready to paste in your team group. Also tap “Share with players” so everyone on OneShort can track what they owe." /> : null}
    </Section>
  );
}

type Extra = { key: string; name: string; user_id?: string; guest_id?: string };
type WhoPays = { ticked?: string[]; extras: Extra[] };
type Hit = { id: string; name: string; area: string | null; city: string | null; image: string | null };

/**
 * Who shares the fee: tick squad players, and add anyone who turned up last minute — a OneShort player found by
 * name, or just a typed name for someone without the app (a guest; the captain marks their payment by hand).
 */
function Players({ step, adding, setAdding, squad, loading, ticked, extras, onTick, onAll, onAdd, onRemove }: {
  step: number; adding: boolean; setAdding: (v: boolean) => void; squad: S<"RosterEntryOut">[] | null; loading: boolean; ticked: string[]; extras: Extra[];
  onTick: (id: string) => void; onAll: (on: boolean) => void; onAdd: (x: Extra) => void; onRemove: (key: string) => void;
}) {
  const [q, setQ] = useState("");
  const typed = q.trim();
  const taken = new Set([...(squad ?? []).map((e) => e.player.id), ...extras.map((x) => x.user_id ?? x.key)]);
  const search = useQuery({
    queryKey: ["fee-player-search", typed], enabled: adding && typed.length >= 2, staleTime: 30_000,
    queryFn: () => api<{ players: Hit[] }>("/search", { query: { q: typed, types: "players", limit: 6 } }),
  });
  const hits = (search.data?.players ?? []).filter((h) => !taken.has(h.id));
  const add = (x: Omit<Extra, "key">) => { onAdd({ ...x, key: x.user_id ?? `guest-${x.name.toLowerCase()}` }); setQ(""); };
  const guestTaken = extras.some((x) => x.name.toLowerCase() === typed.toLowerCase());
  const count = ticked.length + extras.length;
  const allOn = !!squad?.length && squad.every((e) => ticked.includes(e.player.id));
  return (
    <Section title={`${step} · Who's paying (${count})`}>
      <Txt v="small" color={T.muted}>{squad ? "Untick anyone who didn't play. Add last-minute players below." : "Add anyone outside the squad who should share the fee."}</Txt>
      {squad ? (
        <Card style={{ gap: 0 }}>
          {loading ? <LoadingSkeleton rows={3} /> : !squad.length ? <Txt v="small" color={T.muted}>Nobody is in the squad yet. Add players below.</Txt> : (
            <>
              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: allOn }} onPress={() => onAll(!allOn)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 10 }}>
                {allOn ? <CheckSquare size={22} color={T.primary} strokeWidth={2} /> : <Square size={22} color={T.muted} strokeWidth={1.5} />}
                <Txt v="smallSemi" color={T.text2}>{allOn ? "Untick all" : "Tick all"} · {ticked.length}/{squad.length} from the squad</Txt>
              </Pressable>
              {squad.map((e) => {
                const on = ticked.includes(e.player.id);
                return (
                  <Pressable key={e.player.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={e.player.full_name} onPress={() => onTick(e.player.id)}
                    style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: T.line, opacity: on ? 1 : 0.55 }}>
                    {on ? <CheckSquare size={22} color={T.primary} strokeWidth={2} /> : <Square size={22} color={T.muted} strokeWidth={1.5} />}
                    <Avatar uri={e.player.profile_image} name={e.player.full_name} size={30} />
                    <Txt v="bodyMed" style={{ flex: 1 }} numberOfLines={1}>{e.player.full_name}{e.is_captain ? " (C)" : ""}</Txt>
                    {e.contribution_type === "non_payee" ? <Badge status="neutral" label="Plays free" /> : null}
                  </Pressable>
                );
              })}
            </>
          )}
        </Card>
      ) : null}
      {extras.length ? (
        <Card style={{ gap: 0 }}>
          <Txt v="label" color={T.muted} style={{ paddingBottom: 6 }}>Added for this match</Txt>
          {extras.map((x) => (
            <View key={x.key} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: T.line }}>
              <CheckSquare size={22} color={T.primary} strokeWidth={2} />
              <Avatar name={x.name} size={30} />
              <Txt v="bodyMed" style={{ flex: 1 }} numberOfLines={1}>{x.name}</Txt>
              <Badge status="info" label={x.user_id ? "On OneShort" : "Guest"} />
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${x.name}`} hitSlop={10} onPress={() => onRemove(x.key)}><X size={18} color={T.muted} /></Pressable>
            </View>
          ))}
        </Card>
      ) : null}
      {!adding ? (
        <Button title="Add player" variant="secondary" size="sm" icon={<UserPlus size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => setAdding(true)} />
      ) : (
        <Card style={{ gap: SP.sm }}>
          <Field label="Player name" value={q} onChangeText={setQ} placeholder="Type a name, e.g. Anshul" maxLength={80} autoFocus
            returnKeyType="done" onSubmitEditing={() => { if (typed.length >= 2 && !guestTaken) add({ name: typed }); }} />
          {typed.length >= 2 ? (
            <View style={{ gap: SP.sm }}>
              <Button title={guestTaken ? `${typed} is already added` : `Add “${typed}”`} size="sm" disabled={guestTaken}
                icon={<UserPlus size={16} color="#FFFFFF" strokeWidth={1.8} />} onPress={() => add({ name: typed })} />
              <Txt v="small" color={T.muted}>{"Not on OneShort? That's fine: they're added by name and you mark their payment yourself."}</Txt>
              {hits.length ? <Txt v="label" color={T.muted} style={{ paddingTop: 4 }}>Or pick them on OneShort</Txt> : search.isFetching ? <Txt v="small" color={T.muted}>Checking OneShort…</Txt> : null}
              <View>
                {hits.map((h) => (
                  <Pressable key={h.id} accessibilityRole="button" onPress={() => add({ name: h.name, user_id: h.id })}
                    style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: T.line }}>
                    <Avatar uri={h.image} name={h.name} size={30} />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Txt v="bodyMed" numberOfLines={1}>{h.name}</Txt>
                      {h.area || h.city ? <Txt v="small" color={T.muted} numberOfLines={1}>{[h.area, h.city].filter(Boolean).join(", ")}</Txt> : null}
                    </View>
                    <Plus size={18} color={T.primaryDark} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : <Txt v="small" color={T.muted}>Type at least 2 letters.</Txt>}
          <Button title="Done" variant="ghost" size="sm" onPress={() => { setAdding(false); setQ(""); }} />
        </Card>
      )}
    </Section>
  );
}

/** The split as one tidy WhatsApp message (built by the server), with Copy and WhatsApp buttons. */
function GroupMessage({ ledger, settlementId, stamp, note }: { ledger: string; settlementId: string; stamp: string; note?: string }) {
  const msg = useQuery({ queryKey: ["fee", ledger, "share", settlementId, stamp], queryFn: () => api<S<"ShareOut">>(`/settlements/${settlementId}/share`) });
  return (
    <View style={{ gap: SP.sm }}>
      <Txt v="h3">WhatsApp group message</Txt>
      {note ? <Txt v="small" color={T.muted}>{note}</Txt> : null}
      {msg.isPending ? <LoadingSkeleton rows={3} /> : msg.isError ? <ErrorBox error={msg.error} onRetry={() => void msg.refetch()} /> : <ShareToGroup text={msg.data.text} />}
    </View>
  );
}

function Collect({ dash, ledger, onChange }: { dash: Dashboard; ledger: string; onChange: () => void }) {
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
      <GroupMessage ledger={ledger} settlementId={sid} stamp={dash.records.map((r) => r.status).join()} note="Who has paid and who hasn't, ready to paste in your team group." />
      <UpiCard current={dash.settlement.upi_id} onSaved={onChange} />
      {dash.settlement.payment_instructions ? <Txt v="small" color={T.text2}>Players were told: “{dash.settlement.payment_instructions}”</Txt> : null}
      {dash.records.slice().sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9)).map((r) => (
        <Card key={r.id} onPress={() => { setFocus(r); sheet.current?.present(); }} label={`${r.player.full_name}, ${STATUS[r.status]?.[1]}`}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar uri={r.player.profile_image} name={r.player.full_name} size={40} />
            <View style={{ flex: 1 }}>
              <Txt v="h3" numberOfLines={1}>{r.player.full_name}{r.player_is_guest ? " · Guest" : ""}</Txt>
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

/**
 * Where players pay the captain. Saved on the captain's account, so it shows in the group message and in
 * reminders straight away — even for a split that was shared before the captain added it — and is prefilled
 * on the next split.
 */
function UpiCard({ current, onSaved }: { current?: string | null; onSaved: () => void }) {
  const [editing, setEditing] = useState(!current);
  const [upi, setUpi] = useState(current ?? "");
  const ok = UPI_RE.test(upi.trim());
  const save = useMutation({
    mutationFn: () => api("/users/me", { method: "PUT", body: { fee_upi_id: upi.trim() } }),
    onSuccess: () => { setEditing(false); onSaved(); },
    onError: (e) => Alert.alert("Couldn't save your UPI ID", errorText(e)),
  });
  if (!editing && current) {
    return (
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="small" color={T.muted}>Players pay you on UPI</Txt>
          <Txt v="h3" selectable numberOfLines={1}>{current}</Txt>
        </View>
        <Button title="Change" size="sm" variant="secondary" onPress={() => { setUpi(current); setEditing(true); }} />
      </Card>
    );
  }
  return (
    <Card style={{ gap: SP.sm, backgroundColor: current ? T.surface : T.warningBackground }}>
      <Txt v="h3">{current ? "Change your UPI ID" : "Add your UPI ID"}</Txt>
      {!current ? <Txt v="small" color={T.text2}>So the WhatsApp message and reminders tell players exactly where to pay.</Txt> : null}
      <Field label="Your UPI ID" value={upi} onChangeText={(v) => setUpi(v.replace(/\s/g, ""))} placeholder="e.g. rahul@okaxis or 9876543210@ybl"
        autoCapitalize="none" autoCorrect={false} keyboardType="email-address" maxLength={100}
        error={upi.trim() && !ok ? "That doesn't look like a UPI ID. It should look like name@bank." : null} hint="Never share your UPI PIN." />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title="Save UPI ID" size="sm" disabled={!ok} loading={save.isPending} onPress={() => save.mutate()} style={{ flex: 1 }} />
        {current ? <Button title="Cancel" size="sm" variant="ghost" onPress={() => setEditing(false)} /> : null}
      </View>
    </Card>
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
          {dash.settlement.upi_id ? <Txt v="body" color={T.text2}>Pay {mine.captain.full_name} on UPI: <Txt v="bodyMed" selectable>{dash.settlement.upi_id}</Txt></Txt> : null}
          {dash.settlement.payment_instructions ? <Txt v="body" color={T.text2}>{dash.settlement.upi_id ? "" : `Pay ${mine.captain.full_name}: `}{dash.settlement.payment_instructions}</Txt> : !dash.settlement.upi_id ? <Txt v="small" color={T.muted}>Pay {mine.captain.full_name} directly by cash or UPI.</Txt> : null}
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
