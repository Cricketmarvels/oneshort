/**
 * Captain "Find players" request flow (refined spec §5):
 *   form (match OR day + time window, role counts, radius, min rating)
 *   → radar "searching" → results grouped by role with real records → invite
 *   → live request board (waiting / accepted / declined, confirm, chat, close / reopen request).
 * Only available players (declared availability overlapping the window) are returned by the server.
 */
import { formatDateTime, type S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, Circle, MapPin, ShieldCheck, Star } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, View } from "react-native";

import { ChatButtons } from "@/components/invites";
import { shareText, useInviteLink } from "@/components/regulars";
import { FillBar, KickerChip, RadarSearch, RoleStepper, SectionHeader } from "@/components/refined";
import { Avatar, Badge, Button, Chip, EmptyState, ErrorBox, InlineNotice, LoadingSkeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { roleLabel } from "@/lib/format";
import { useLocation } from "@/lib/location";
import { R, SP, T } from "@/theme";

type Match = S<"MatchOut">;
type Result = S<"PlayerResultOut">;
type SearchOut = { data: Result[]; meta: S<"PlayerSearchMeta"> };
type Invitation = S<"InvitationOut">;
type Role = Result["primary_role"];

const ROLES: { v: Role; l: string; hint: string }[] = [
  { v: "batsman", l: "Batters", hint: "Top or middle order" },
  { v: "bowler", l: "Bowlers", hint: "Pace or spin" },
  { v: "all_rounder", l: "All-rounders", hint: "Bat and bowl" },
  { v: "wicketkeeper", l: "Wicketkeeper", hint: "Behind the stumps" },
];
const WINDOWS = [
  { v: "morning", l: "Morning", sub: "7–11 AM", s: [7, 0], e: [11, 0] },
  { v: "afternoon", l: "Afternoon", sub: "12–4 PM", s: [12, 0], e: [16, 0] },
  { v: "evening", l: "Evening", sub: "4:30–8 PM", s: [16, 30], e: [20, 0] },
  { v: "night", l: "Night", sub: "8 PM–12 AM", s: [20, 0], e: [24, 0] },
] as const;
const RADII = [5, 10, 20] as const;

function nextDays(n = 7) {
  const out: { key: string; label: string; date: Date }[] = [];
  const base = new Date(); base.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    const d = new Date(base); d.setDate(base.getDate() + i);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
    out.push({ key: d.toISOString(), label, date: d });
  }
  return out;
}
function at(day: Date, [h, m]: readonly [number, number]) { const d = new Date(day); d.setHours(h, m, 0, 0); return d; }
const roleName = (r: string) => roleLabel(r);

export default function FindPlayersRequest() {
  const qc = useQueryClient();
  const params = useLocalSearchParams<{ match?: string }>();
  const loc = useLocation();
  const matches = useQuery({ queryKey: ["my-matches"], queryFn: () => api<{ data: Match[] }>("/matches", { query: { role: "captain", when: "upcoming" } }) });
  const open = (matches.data?.data ?? []).filter((m) => m.viewer_relation === "manager" && ["published", "recruiting", "squad_confirmed"].includes(m.match_status));

  const [mode, setMode] = useState<"match" | "window">(params.match ? "match" : "match");
  const [matchId, setMatchId] = useState<string | null>(params.match ?? null);
  const days = useMemo(() => nextDays(), []);
  const [day, setDay] = useState((days.find((d) => d.date.getDay() === 6) ?? days[0]!).key); // default: coming Saturday
  const [win, setWin] = useState<(typeof WINDOWS)[number]["v"]>("morning");
  const [counts, setCounts] = useState<Record<Role, number>>({ batsman: 0, bowler: 1, all_rounder: 0, wicketkeeper: 0 });
  const [radius, setRadius] = useState<(typeof RADII)[number]>(10);
  const [minRating, setMinRating] = useState<number | null>(null);
  const [stage, setStage] = useState<"form" | "searching" | "results">("form");
  const [picked, setPicked] = useState<Record<string, Role | null>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<SearchOut | null>(null);
  const [err, setErr] = useState<unknown>(null);

  useEffect(() => { if (!matchId && open.length) setMatchId(open[0]!.id); }, [open, matchId]);
  useEffect(() => { if (!matches.isPending && !open.length) setMode("window"); }, [matches.isPending, open.length]);

  const match = open.find((m) => m.id === matchId) ?? null;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const role_counts = Object.fromEntries(Object.entries(counts).filter(([, n]) => n > 0));
  const w = WINDOWS.find((x) => x.v === win)!;
  const dayDate = days.find((d) => d.key === day)!.date;

  const search = async () => {
    setErr(null); setNotice(null); setPicked({}); setStage("searching");
    const body = mode === "match" && match
      ? { match_id: match.id, radius_km: radius, role_counts, min_rating: minRating, page_size: 50 }
      : { start_at: at(dayDate, w.s).toISOString(), end_at: at(dayDate, w.e).toISOString(), location: { lat: loc.lat, lng: loc.lng }, radius_km: radius, role_counts, min_rating: minRating, page_size: 50 };
    const started = Date.now();
    try {
      const r = await api<SearchOut>("/discovery/players", { method: "POST", body });
      await new Promise((ok) => setTimeout(ok, Math.max(0, 1400 - (Date.now() - started))));
      setResult(r); setStage("results");
    } catch (e) { setErr(e); setStage("form"); }
  };

  const invite = useMutation({
    mutationFn: () => api<S<"InvitationResultItem">[]>(`/matches/${match!.id}/invitations`, { method: "POST", body: { invites: Object.entries(picked).map(([player_id, role]) => ({ player_id, ...(role ? { proposed_role: role } : {}) })) } }),
    onSuccess: (r) => {
      const sent = r.filter((x) => x.ok).length;
      setNotice(`${sent} invitation${sent === 1 ? "" : "s"} sent${sent < r.length ? ` · ${r.length - sent} couldn't be sent` : ""}. Players see them on their dashboard (and on WhatsApp if they opted in).`);
      setPicked({});
      setResult((cur) => cur && { ...cur, data: cur.data.filter((p) => !r.some((x) => x.ok && x.player_id === p.player.id)) });
      void qc.invalidateQueries({ queryKey: ["match-invitations", match!.id] });
    },
    onError: (e) => setNotice(`Couldn't send invitations: ${errorText(e)}`),
  });

  const groups = useMemo(() => {
    const data = result?.data ?? [];
    const wanted = Object.keys(role_counts) as Role[];
    if (!wanted.length) return [{ role: null as Role | null, need: 0, rows: data }];
    return wanted.map((role) => ({ role, need: counts[role], rows: data.filter((p) => p.matched_role === role) }));
  }, [result]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.section, paddingBottom: 120, backgroundColor: T.bg }} keyboardShouldPersistTaps="handled">
      {stage === "searching" ? (
        <RadarSearch title="Looking for available players…" body={`${total ? `${total} needed · ` : ""}within ${radius} km of ${mode === "match" && match ? match.venue.name : loc.label}`} />
      ) : stage === "results" && result ? (
        <Results groups={groups} meta={result.meta} picked={picked} setPicked={setPicked} canInvite={!!match} onEdit={() => setStage("form")}
          onInvite={() => invite.mutate()} inviting={invite.isPending} notice={notice} radius={radius} />
      ) : (
        <>
          {mode === "match" && match ? <RegularsFirst matchId={match.id} /> : null}
          <View style={{ gap: 6 }}>
            <KickerChip label="CAPTAIN · PLAYER REQUEST" />
            <Txt v="hero">Who do you need?</Txt>
            <Txt v="body" color={T.muted}>We only show players whose availability covers your time, nearest and most reliable first.</Txt>
          </View>

          <View style={{ gap: SP.md }}>
            <SectionHeader title="When" />
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Chip label="One of my matches" active={mode === "match"} onPress={() => setMode("match")} />
              <Chip label="Pick a day & time" active={mode === "window"} onPress={() => setMode("window")} />
            </View>
            {mode === "match" ? (
              matches.isPending ? <LoadingSkeleton rows={2} /> : !open.length ? (
                <EmptyState title="No open matches yet" body="Create a match to invite players into it, or search a day and time first." action="Create match" onAction={() => router.push("/match/new")} />
              ) : (
                <View style={{ gap: 8 }}>
                  {open.map((m) => {
                    const on = m.id === matchId;
                    return (
                      <Pressable key={m.id} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setMatchId(m.id)}
                        style={{ padding: 14, borderRadius: R.card, borderWidth: on ? 1.5 : 1, borderColor: on ? T.primary : T.line, backgroundColor: on ? T.primarySoft : T.surface, gap: 4 }}>
                        <Txt v="h3" color={on ? T.primaryDark : T.ink} numberOfLines={1}>{m.title}</Txt>
                        <Txt v="small" color={T.muted} numberOfLines={1}>{formatDateTime(m.start_at, m.timezone)} · {m.venue.name}</Txt>
                        <Txt v="small" color={T.muted}>{m.composition.confirmed_total} / {m.composition.capacity} in squad · {m.composition.vacancies} open</Txt>
                      </Pressable>
                    );
                  })}
                </View>
              )
            ) : (
              <View style={{ gap: SP.md }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 8 }}>
                  {days.map((d) => <Chip key={d.key} label={d.label} active={d.key === day} onPress={() => setDay(d.key)} />)}
                </ScrollView>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {WINDOWS.map((x) => {
                    const on = x.v === win;
                    return (
                      <Pressable key={x.v} accessibilityRole="radio" accessibilityState={{ selected: on }} onPress={() => setWin(x.v)}
                        style={{ width: "48%", flexGrow: 1, padding: 12, borderRadius: 14, borderWidth: on ? 1.5 : 1, borderColor: on ? T.primary : T.line, backgroundColor: on ? T.primarySoft : T.surface }}>
                        <Txt v="h3" color={on ? T.primaryDark : T.ink}>{x.l}</Txt>
                        <Txt v="small" color={T.muted}>{x.sub}</Txt>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><MapPin size={15} color={T.muted} /><Txt v="small" color={T.muted}>Around {loc.label}</Txt></View>
              </View>
            )}
          </View>

          <View style={{ gap: 4 }}>
            <SectionHeader title="Roles needed" />
            <View style={{ backgroundColor: T.surface, borderRadius: R.card, borderWidth: 1, borderColor: T.line, paddingHorizontal: 16, paddingVertical: 4 }}>
              {ROLES.map((r, i) => (
                <View key={r.v} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: T.line }}>
                  <RoleStepper label={r.l} hint={r.hint} value={counts[r.v]} onChange={(n) => setCounts({ ...counts, [r.v]: n })} />
                </View>
              ))}
            </View>
            <Txt v="small" color={T.muted} style={{ marginTop: 4 }}>{total ? `${total} player${total === 1 ? "" : "s"} needed` : "Leave all at 0 to see every available player"}</Txt>
          </View>

          <View style={{ gap: SP.md }}>
            <SectionHeader title="Distance & rating" />
            <View style={{ flexDirection: "row", gap: 8 }}>{RADII.map((r) => <Chip key={r} label={`${r} km`} active={radius === r} onPress={() => setRadius(r)} />)}</View>
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              {([null, 3, 4] as const).map((r) => <Chip key={String(r)} label={r ? `${r}+ stars` : "Any rating"} active={minRating === r} onPress={() => setMinRating(r)} />)}
            </View>
            <Txt v="small" color={T.muted}>Rating filters hide players who haven't been rated yet.</Txt>
          </View>

          {err ? <ErrorBox error={err} onRetry={() => void search()} /> : null}
          <Button title="Search available players" size="lg" disabled={mode === "match" && !match} onPress={() => void search()} />
        </>
      )}

      {match && stage !== "searching" ? <RequestBoard match={match} /> : null}
    </ScrollView>
  );
}

function Record({ p }: { p: Result }) {
  const bits: string[] = [];
  if (p.matches_played) bits.push(`${p.matches_played} match${p.matches_played === 1 ? "" : "es"}`);
  if (p.experience_years) bits.push(`${p.experience_years} yr exp`);
  bits.push(`~${p.approx_distance_km} km`);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      {p.average_rating != null && p.rating_count >= 3 ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><Star size={13} color={T.accentOrange} fill={T.accentOrange} /><Txt v="smallSemi">{p.average_rating.toFixed(1)}</Txt><Txt v="small" color={T.muted}>({p.rating_count})</Txt></View>
      ) : <Txt v="small" color={T.faint}>Not rated yet</Txt>}
      {p.rating_count >= 3 || p.matches_played >= 3 ? <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}><ShieldCheck size={13} color={T.successText} /><Txt v="small" color={T.successText}>{Math.round(p.reliability_score)}% reliable</Txt></View> : null}
      <Txt v="small" color={T.muted}>{bits.join(" · ")}</Txt>
    </View>
  );
}

function Results({ groups, meta, picked, setPicked, canInvite, onEdit, onInvite, inviting, notice, radius }: {
  groups: { role: Role | null; need: number; rows: Result[] }[]; meta: S<"PlayerSearchMeta">; picked: Record<string, Role | null>; setPicked: (p: Record<string, Role | null>) => void;
  canInvite: boolean; onEdit: () => void; onInvite: () => void; inviting: boolean; notice: string | null; radius: number;
}) {
  const n = Object.keys(picked).length;
  return (
    <View style={{ gap: SP.section }}>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <KickerChip label={`${meta.total} AVAILABLE · ${radius} KM`} tone={meta.total ? "success" : "aqua"} />
          <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={12}><Txt v="smallSemi" color={T.primaryDark}>Edit request</Txt></Pressable>
        </View>
        <Txt v="hero">{meta.total ? "Players ready to play" : "No one free yet"}</Txt>
        <Txt v="small" color={T.muted}>Ranked by role fit, distance, reliability and history with your team. Distances are approximate.</Txt>
      </View>
      {notice ? <InlineNotice>{notice}</InlineNotice> : null}
      {!meta.total ? <EmptyState title="Nobody's availability matches" body="Try a wider radius, another time window, or fewer role requirements." action="Edit request" onAction={onEdit} /> : null}
      {groups.filter((g) => meta.total).map((g) => (
        <View key={g.role ?? "all"} style={{ gap: SP.sm }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Txt v="h2">{g.role ? roleName(g.role) : "Available players"}</Txt>
            {g.role ? <Badge status={g.rows.length >= g.need ? "success" : g.rows.length ? "warning" : "neutral"} label={`Need ${g.need} · ${g.rows.length} found`} /> : null}
          </View>
          {!g.rows.length ? <Txt v="small" color={T.muted}>No available {g.role ? roleName(g.role).toLowerCase() : "players"} in range for this time.</Txt> : null}
          {g.rows.map((p) => {
            const on = p.player.id in picked;
            return (
              <Pressable key={p.player.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${p.player.full_name}, ${roleName(p.primary_role)}`}
                onPress={() => { const next = { ...picked }; if (on) delete next[p.player.id]; else next[p.player.id] = g.role ?? null; setPicked(next); }}
                style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: R.card, borderWidth: on ? 1.5 : 1, borderColor: on ? T.primary : T.line, backgroundColor: on ? T.primarySoft : T.surface }}>
                <Avatar uri={p.player.profile_image} name={p.player.full_name} size={46} />
                <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <Txt v="h3" numberOfLines={1} style={{ flexShrink: 1 }}>{p.player.full_name}</Txt>
                    {p.is_team_member ? <KickerChip label="TEAM" /> : null}
                  </View>
                  <Txt v="small" color={T.muted} numberOfLines={1}>{roleName(p.primary_role)}{p.role_match === "secondary" ? ` · also ${g.role ? roleName(g.role).toLowerCase() : ""}` : ""} · {p.availability_status === "available" ? "Available" : "Tentative"}</Txt>
                  <Record p={p} />
                </View>
                {on ? <CheckCircle2 size={24} color={T.primary} /> : <Circle size={24} color={T.line} />}
              </Pressable>
            );
          })}
        </View>
      ))}
      {meta.total ? (
        canInvite ? (
          <Button title={n ? `Invite ${n} player${n === 1 ? "" : "s"}` : "Select players to invite"} size="lg" disabled={!n} loading={inviting} onPress={onInvite} />
        ) : (
          <InlineNotice>Invitations are sent for a match. Create a match for this time, then invite these players from here.</InlineNotice>
        )
      ) : null}
      {!canInvite && meta.total ? <Button title="Create a match" variant="secondary" onPress={() => router.push("/match/new")} /> : null}
    </View>
  );
}

const STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Waiting", tone: "warning" }, accepted: { label: "Accepted", tone: "info" }, confirmed: { label: "Confirmed", tone: "success" },
  rejected: { label: "Declined", tone: "danger" }, expired: { label: "Expired", tone: "neutral" }, cancelled: { label: "Withdrawn", tone: "neutral" },
};

/** Live request board for the chosen match: who's waiting, accepted, declined; confirm; chat; close / reopen. */
function RequestBoard({ match }: { match: Match }) {
  const qc = useQueryClient();
  const invs = useQuery({ queryKey: ["match-invitations", match.id], queryFn: () => api<Invitation[]>(`/matches/${match.id}/invitations`), refetchInterval: 15_000 });
  const m = useQuery({ queryKey: ["match", match.id], queryFn: () => api<Match>(`/matches/${match.id}`), initialData: match });
  const [msg, setMsg] = useState<string | null>(null);
  const refresh = () => { for (const k of [["match-invitations", match.id], ["match", match.id], ["my-matches"]]) void qc.invalidateQueries({ queryKey: k }); };
  const confirm = useMutation({ mutationFn: (id: string) => api(`/invitations/${id}/confirm`, { method: "POST" }), onSuccess: () => { setMsg("Spot confirmed."); refresh(); }, onError: (e) => setMsg(errorText(e)) });
  const move = useMutation({ mutationFn: (to: string) => api(`/matches/${match.id}/transition`, { method: "POST", body: { to } }),
    onSuccess: (_r, to) => { setMsg(to === "squad_confirmed" ? "Request closed — squad confirmed. No new invitations or join requests." : "Request reopened — you can invite players again."); refresh(); }, onError: (e) => setMsg(errorText(e)) });
  const cur = m.data ?? match;
  const rows = (invs.data ?? []).filter((i) => i.direction === "invite" || i.invitation_status !== "cancelled");
  const counts = rows.reduce<Record<string, number>>((a, i) => ({ ...a, [i.invitation_status]: (a[i.invitation_status] ?? 0) + 1 }), {});
  const closed = cur.match_status === "squad_confirmed";
  return (
    <View style={{ gap: SP.md, paddingTop: SP.sm }}>
      <SectionHeader title="Your request board" action="Match page" onAction={() => router.push({ pathname: "/match/[id]", params: { id: match.id } })} />
      <View style={{ backgroundColor: T.surface, borderRadius: R.card, borderWidth: 1, borderColor: T.line, padding: 16, gap: 14 }}>
        <View style={{ gap: 2 }}>
          <Txt v="h3" numberOfLines={1}>{cur.title}</Txt>
          <Txt v="small" color={T.muted}>{formatDateTime(cur.start_at, cur.timezone)} · {closed ? "Closed (squad confirmed)" : "Open for players"}</Txt>
        </View>
        <FillBar filled={cur.composition.confirmed_total} total={cur.composition.capacity} />
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          {(["pending", "accepted", "confirmed", "rejected"] as const).map((s) => <Badge key={s} status={STATUS[s]!.tone} label={`${STATUS[s]!.label} ${counts[s] ?? 0}`} />)}
        </View>
        {msg ? <InlineNotice>{msg}</InlineNotice> : null}
        {invs.isPending ? <LoadingSkeleton rows={2} /> : invs.isError ? <ErrorBox error={invs.error} onRetry={() => void invs.refetch()} /> : !rows.length ? (
          <Txt v="small" color={T.muted}>No invitations yet. Search above and invite players — their replies appear here.</Txt>
        ) : rows.map((i) => {
          const st = STATUS[i.invitation_status] ?? { label: i.invitation_status, tone: "neutral" };
          return (
            <View key={i.id} style={{ gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: T.line }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <Avatar uri={i.player.profile_image} name={i.player.full_name} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt v="h3" numberOfLines={1}>{i.player.full_name}</Txt>
                  <Txt v="small" color={T.muted} numberOfLines={1}>{i.proposed_role ? roleName(i.proposed_role) : "Any role"} · {i.direction === "request" ? "asked to join" : "invited"}</Txt>
                </View>
                <Badge status={st.tone} label={st.label} />
              </View>
              {i.invitation_status === "accepted" ? <Button title="Confirm spot" size="sm" loading={confirm.isPending && confirm.variables === i.id} onPress={() => confirm.mutate(i.id)} /> : null}
              {i.can_chat ? <ChatButtons invitationId={i.id} compact quiet /> : null}
            </View>
          );
        })}
        {cur.allowed_transitions.includes("squad_confirmed") ? (
          <Button title="Close request — squad is confirmed" variant="outline" loading={move.isPending} onPress={() => move.mutate("squad_confirmed")} />
        ) : closed && cur.allowed_transitions.includes("recruiting") ? (
          <Button title="Reopen request" variant="secondary" loading={move.isPending} onPress={() => move.mutate("recruiting")} />
        ) : null}
      </View>
    </View>
  );
}

/** Nudge: share the squad link with regulars before searching strangers. */
function RegularsFirst({ matchId }: { matchId: string }) {
  const l = useInviteLink(matchId);
  return (
    <View style={{ gap: 8, padding: 14, borderRadius: R.card, backgroundColor: T.primarySoft }}>
      <Txt v="h3">Asked your regulars yet?</Txt>
      <Txt v="small" color={T.muted}>Share the squad link in your WhatsApp group first — regulars add themselves. Then search for the spots that are left.{l.data?.joined.length ? ` ${l.data.joined.length} joined via link so far.` : ""}</Txt>
      {l.data ? <Button title="Share squad link on WhatsApp" size="sm" onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(shareText(l.data!))}`)} /> : null}
    </View>
  );
}
