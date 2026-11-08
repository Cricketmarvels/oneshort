import type { S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Minus, Plus } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, Switch, TextInput, View } from "react-native";

import { Button, Card, Chip, Field, LoadingSkeleton, Section, Segmented, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import type { Fixture } from "@/lib/types";
import { FW, R, SP, T } from "@/theme";

type Line = { inXI: boolean; bat: boolean; runs: string; balls: string; fours: string; sixes: string; notOut: boolean; bowl: boolean; overs: string; bRuns: string; wkts: string; maidens: string; c: number; ro: number; st: number };
const blank = (): Line => ({ inXI: false, bat: false, runs: "", balls: "", fours: "", sixes: "", notOut: false, bowl: false, overs: "", bRuns: "", wkts: "", maidens: "", c: 0, ro: 0, st: 0 });
const n = (s: string) => Number(s.replace(/[^\d]/g, "")) || 0;
const ballsFromOvers = (s: string) => { const [o, b] = s.split("."); return n(o ?? "0") * 6 + Math.min(5, n(b ?? "0")); };

function Num({ label, value, onChange, w = 58 }: { label: string; value: string; onChange: (v: string) => void; w?: number }) {
  return (
    <View style={{ width: w, gap: 2 }}>
      <Txt v="label" color={T.muted} style={{ fontSize: 9 }}>{label}</Txt>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} keyboardType="decimal-pad" style={{ height: 38, borderRadius: R.sm, borderWidth: 1, borderColor: T.line, backgroundColor: T.white, textAlign: "center", ...FW.semibold, fontSize: 15, color: T.text }} />
    </View>
  );
}
function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <View style={{ alignItems: "center", gap: 2 }}>
      <Txt v="label" color={T.muted} style={{ fontSize: 9 }}>{label}</Txt>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Fewer ${label}`} onPress={() => onChange(Math.max(0, value - 1))} hitSlop={6} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.paper, alignItems: "center", justifyContent: "center" }}><Minus size={14} color={T.ink} strokeWidth={1.5} /></Pressable>
        <Txt v="smallSemi" style={{ minWidth: 14, textAlign: "center" }}>{value}</Txt>
        <Pressable accessibilityRole="button" accessibilityLabel={`More ${label}`} onPress={() => onChange(value + 1)} hitSlop={6} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: T.paper, alignItems: "center", justifyContent: "center" }}><Plus size={14} color={T.ink} strokeWidth={1.5} /></Pressable>
      </View>
    </View>
  );
}

export default function SubmitResult() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const fq = useQuery({ queryKey: ["fixture", id], queryFn: () => api<Fixture>(`/fixtures/${id}`) });
  const f = fq.data;
  const members = useQuery({
    queryKey: ["fixture", id, "members"], enabled: !!f,
    queryFn: async () => {
      const [h, a] = await Promise.all([f!.home_team.id, f!.away_team.id].map((t) => api<S<"TeamMemberOut">[]>(`/teams/${t}/members`)));
      return { [f!.home_team.id]: h!.filter((m) => m.status === "active"), [f!.away_team.id]: a!.filter((m) => m.status === "active") };
    },
  });
  const [type, setType] = useState<"won" | "tied" | "no_result">("won");
  const [winner, setWinner] = useState<string | null>(null);
  const [first, setFirst] = useState<string | null>(null);
  const [inn, setInn] = useState<Record<string, { runs: string; wkts: string; overs: string }>>({});
  const [lines, setLines] = useState<Record<string, Line>>({});
  const [notes, setNotes] = useState("");
  const [team, setTeam] = useState<string | null>(null);
  const submit = useMutation({
    mutationFn: (body: S<"ResultIn">) => api<Fixture>(`/fixtures/${id}/result`, { method: "POST", body }),
    onSuccess: (fx) => { qc.setQueryData(["fixture", id], fx); void qc.invalidateQueries({ queryKey: ["fixtures"] }); Alert.alert("Result submitted", "The other team's captain has been asked to verify it."); router.back(); },
    onError: (e) => Alert.alert("Check the scorecard", errorText(e)),
  });
  if (!f || members.isPending) return <View style={{ padding: SP.page }}><LoadingSkeleton rows={4} /></View>;
  const teams = [f.home_team, f.away_team];
  const activeTeam = team ?? f.home_team.id;
  const L = (uid: string) => lines[uid] ?? blank();
  const setL = (uid: string, patch: Partial<Line>) => setLines({ ...lines, [uid]: { ...L(uid), ...patch } });
  const battingOrder = first ? [first, teams.find((t) => t.id !== first)!.id] : [];
  const build = (): S<"ResultIn"> => ({
    result_type: type,
    winner_team_id: type === "won" ? winner : null,
    innings: battingOrder.filter((t) => inn[t]?.runs).map((t) => ({ batting_team_id: t, runs: n(inn[t]!.runs), wickets: n(inn[t]!.wkts), balls: ballsFromOvers(inn[t]!.overs || String(f.overs)) })),
    players: Object.entries(lines).filter(([, l]) => l.inXI).map(([uid, l]) => {
      const tid = teams.find((t) => (members.data?.[t.id] ?? []).some((m) => m.user.id === uid))!.id;
      return {
        user_id: uid, team_id: tid,
        batting: l.bat ? { runs: n(l.runs), balls: n(l.balls), fours: n(l.fours), sixes: n(l.sixes), out: !l.notOut } : null,
        bowling: l.bowl && ballsFromOvers(l.overs) > 0 ? { balls: ballsFromOvers(l.overs), runs: n(l.bRuns), wickets: n(l.wkts), maidens: n(l.maidens) } : null,
        fielding: { catches: l.c, run_outs: l.ro, stumpings: l.st },
      };
    }),
    notes: notes || null,
  });
  const ready = (type === "no_result" || (first && battingOrder.every((t) => inn[t]?.runs))) && (type !== "won" || winner);
  return (
    <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.xl, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
      <Txt v="small" color={T.muted}>The other captain verifies this before it counts. Only players who are members of each team can be added to the scorecard.</Txt>
      <Section title="Result">
        <Segmented value={type} onChange={setType} options={[{ v: "won", l: "Won" }, { v: "tied", l: "Tied" }, { v: "no_result", l: "No result" }]} />
        {type === "won" ? <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{teams.map((t) => <Chip key={t.id} label={`${t.team_name} won`} active={winner === t.id} onPress={() => setWinner(t.id)} />)}</View> : null}
      </Section>
      <Section title="Batted first">
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>{teams.map((t) => <Chip key={t.id} label={t.team_name} active={first === t.id} onPress={() => setFirst(t.id)} />)}</View>
        {battingOrder.map((tid, i) => (
          <Card key={tid}>
            <Txt v="smallSemi">{i === 0 ? "1st" : "2nd"} innings · {teams.find((t) => t.id === tid)!.team_name}</Txt>
            <View style={{ flexDirection: "row", gap: SP.md }}>
              <Num label="Runs" w={80} value={inn[tid]?.runs ?? ""} onChange={(v) => setInn({ ...inn, [tid]: { ...(inn[tid] ?? { runs: "", wkts: "", overs: "" }), runs: v } })} />
              <Num label="Wickets" w={80} value={inn[tid]?.wkts ?? ""} onChange={(v) => setInn({ ...inn, [tid]: { ...(inn[tid] ?? { runs: "", wkts: "", overs: "" }), wkts: v } })} />
              <Num label={`Overs (max ${f.overs})`} w={100} value={inn[tid]?.overs ?? ""} onChange={(v) => setInn({ ...inn, [tid]: { ...(inn[tid] ?? { runs: "", wkts: "", overs: "" }), overs: v } })} />
            </View>
          </Card>
        ))}
      </Section>
      <Section title="Scorecard">
        <Segmented value={activeTeam} onChange={setTeam} options={teams.map((t) => ({ v: t.id, l: t.team_name }))} />
        {(members.data?.[activeTeam] ?? []).map((m) => {
          const l = L(m.user.id);
          return (
            <Card key={m.user.id} style={!l.inXI ? { opacity: 0.75 } : undefined}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Txt v="h3" style={{ flex: 1 }}>{m.user.full_name}</Txt>
                <Txt v="small" color={T.muted}>Played</Txt>
                <Switch value={l.inXI} onValueChange={(v) => setL(m.user.id, { inXI: v })} trackColor={{ true: T.accent, false: T.switchOff }} thumbColor={T.surface} {...({ activeThumbColor: T.surface, activeTrackColor: T.accent } as object)} accessibilityLabel={`${m.user.full_name} played`} />
              </View>
              {l.inXI ? (
                <View style={{ gap: SP.md }}>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Chip label="Batted" active={l.bat} onPress={() => setL(m.user.id, { bat: !l.bat })} />
                    <Chip label="Bowled" active={l.bowl} onPress={() => setL(m.user.id, { bowl: !l.bowl })} />
                  </View>
                  {l.bat ? (
                    <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <Num label="Runs" value={l.runs} onChange={(v) => setL(m.user.id, { runs: v })} />
                      <Num label="Balls" value={l.balls} onChange={(v) => setL(m.user.id, { balls: v })} />
                      <Num label="4s" w={46} value={l.fours} onChange={(v) => setL(m.user.id, { fours: v })} />
                      <Num label="6s" w={46} value={l.sixes} onChange={(v) => setL(m.user.id, { sixes: v })} />
                      <Chip label="Not out" active={l.notOut} onPress={() => setL(m.user.id, { notOut: !l.notOut })} />
                    </View>
                  ) : null}
                  {l.bowl ? (
                    <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                      <Num label="Overs" value={l.overs} onChange={(v) => setL(m.user.id, { overs: v })} />
                      <Num label="Runs" value={l.bRuns} onChange={(v) => setL(m.user.id, { bRuns: v })} />
                      <Num label="Wkts" w={50} value={l.wkts} onChange={(v) => setL(m.user.id, { wkts: v })} />
                      <Num label="Mdns" w={50} value={l.maidens} onChange={(v) => setL(m.user.id, { maidens: v })} />
                    </View>
                  ) : null}
                  <View style={{ flexDirection: "row", justifyContent: "space-around" }}>
                    <Stepper label="Catches" value={l.c} onChange={(v) => setL(m.user.id, { c: v })} />
                    <Stepper label="Run-outs" value={l.ro} onChange={(v) => setL(m.user.id, { ro: v })} />
                    <Stepper label="Stumpings" value={l.st} onChange={(v) => setL(m.user.id, { st: v })} />
                  </View>
                </View>
              ) : null}
            </Card>
          );
        })}
      </Section>
      <Field label="Notes (optional)" value={notes} onChangeText={setNotes} maxLength={200} placeholder="e.g. Reduced to 16 overs due to rain" />
      <Button title="Submit for verification" size="lg" variant="lime" disabled={!ready} loading={submit.isPending} onPress={() => submit.mutate(build())} />
    </ScrollView>
  );
}
