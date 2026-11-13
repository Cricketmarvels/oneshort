import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { BadgeCheck, Calendar, FileText, Hash, MapPin, Wallet } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";

import { PhotoHero, RowHeader, ShareButton, ShieldCrest } from "@/components/identity";
import { ConfirmationModal, PromptModal } from "@/components/sheet";
import { Avatar, Button, Card, EmptyState, ErrorBox, InlineNotice, List, LoadingSkeleton, Row, Txt, UnderlineTabs } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { formatLabel, overs, when } from "@/lib/format";
import type { Fixture } from "@/lib/types";
import { R, SP, T } from "@/theme";

export default function FixtureDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["fixture", id], queryFn: () => api<Fixture>(`/fixtures/${id}`) });
  const [disputing, setDisputing] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [tab, setTab] = useState<"scorecard" | "summary" | "stats">("scorecard");
  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => api<Fixture>(`/fixtures/${id}/${action}`, { method: "POST", body: body ?? {} }),
    onSuccess: (f, v) => {
      qc.setQueryData(["fixture", id], f);
      for (const k of ["fixtures", "home", "lb", "rating", "team"]) void qc.invalidateQueries({ queryKey: [k] });
      if (v.action === "verify") Alert.alert("Result confirmed", "It's official. Ratings and leaderboards have been updated.");
      if (v.action === "dispute") Alert.alert("Result disputed", "It's on hold and won't affect ratings until it's corrected or resolved by an admin.");
    },
    onError: (e) => Alert.alert("Couldn't update the match", errorText(e)),
  });
  if (q.isPending) return <View style={{ flex: 1, backgroundColor: T.paper, padding: SP.page }}><LoadingSkeleton rows={4} /></View>;
  if (q.isError) return <View style={{ padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View>;
  const f = q.data;
  const r = f.result;
  const name = (tid: string) => (tid === f.home_team.id ? f.home_team.team_name : f.away_team.team_name);
  const order = r?.innings.length ? r.innings : [];
  const main = order[order.length - 1];
  const status = !r ? (f.status === "cancelled" ? "Cancelled" : "Scheduled") : r.status === "confirmed" ? "Result" : r.status === "submitted" ? "Awaiting verification" : r.status === "disputed" ? "Disputed" : "Voided";
  const all = r?.players ?? [];
  const topBat = [...all].filter((p) => p.batting).sort((x, y) => y.batting!.runs - x.batting!.runs).slice(0, 3);
  const topBowl = [...all].filter((p) => p.bowling && p.bowling.balls).sort((x, y) => y.bowling!.wickets - x.bowling!.wickets || x.bowling!.runs - y.bowling!.runs).slice(0, 3);
  const actions = (
    <View style={{ gap: SP.sm }}>
      {f.actions.includes("verify") ? <Button title="Verify result" variant="highlight" size="lg" icon={<BadgeCheck size={18} color={T.ink} strokeWidth={2} />} onPress={() => setVerifying(true)} /> : null}
      {f.actions.includes("dispute") ? <Button title="Dispute result" variant="outline" onPress={() => setDisputing(true)} /> : null}
      {f.actions.includes("submit_result") ? <Button title={r?.status === "disputed" ? "Submit corrected result" : "Submit result & scorecard"} variant="highlight" size="lg" onPress={() => router.push({ pathname: "/fixture/result", params: { id: f.id } })} /> : null}
    </View>
  );
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ paddingBottom: 60 }}>
      <Stack.Screen options={{ title: "Match centre", headerTitleAlign: "center", headerRight: () => <ShareButton message={`${f.home_team.team_name} vs ${f.away_team.team_name}${r ? ` — ${r.summary}` : ""} · OneShort`} /> }} />
      <View style={{ paddingHorizontal: SP.page, paddingTop: SP.sm }}>
        <PhotoHero photo="stadium" height={232}>
          <View style={{ flex: 1, padding: 16, justifyContent: "space-between" }}>
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
              <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.pill, backgroundColor: T.limeAccent }}><Txt v="smallSemi" style={{ fontSize: 11.5 }}>{formatLabel(f.format)} · {f.overs} overs</Txt></View>
              {f.is_demo ? <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.pill, backgroundColor: "rgba(255,255,255,0.2)" }}><Txt v="smallSemi" color="#FFFFFF" style={{ fontSize: 11.5 }}>Demo</Txt></View> : null}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Pressable accessibilityRole="button" accessibilityLabel={f.home_team.team_name} onPress={() => router.push({ pathname: "/team/[id]", params: { id: f.home_team.id } })}><ShieldCrest name={f.home_team.team_name} size={74} /></Pressable>
              <View style={{ flex: 1, alignItems: "center", gap: 2 }}>
                {main ? (
                  <>
                    <Txt v="display" color="#FFFFFF" style={{ fontSize: 38, lineHeight: 44 }}>{main.runs}/{main.wickets}</Txt>
                    <Txt v="bodyMed" color="rgba(255,255,255,0.85)">({overs(main.balls)} ov)</Txt>
                  </>
                ) : <Txt v="h1" color="#FFFFFF">{when(f.start_at, { hour: "numeric", minute: "2-digit" })}</Txt>}
                <View style={{ marginTop: 6, paddingHorizontal: 10, paddingVertical: 3, borderRadius: R.pill, backgroundColor: r?.status === "confirmed" ? T.limeAccent : "rgba(255,255,255,0.22)" }}>
                  <Txt v="smallSemi" color={r?.status === "confirmed" ? T.ink : "#FFFFFF"} style={{ fontSize: 11.5 }}>{status}</Txt>
                </View>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel={f.away_team.team_name} onPress={() => router.push({ pathname: "/team/[id]", params: { id: f.away_team.id } })}><ShieldCrest name={f.away_team.team_name} size={74} /></Pressable>
            </View>
            <View style={{ alignItems: "center" }}>
              <Txt v="h3" color="#FFFFFF" numberOfLines={1}>{f.home_team.team_name} vs {f.away_team.team_name}</Txt>
              <Txt v="small" color="rgba(255,255,255,0.8)" numberOfLines={1}>{f.venue.name} · {when(f.start_at, { weekday: "short", day: "numeric", month: "short" })}</Txt>
            </View>
          </View>
        </PhotoHero>
      </View>

      <View style={{ padding: SP.page, gap: SP.lg }}>
        {f.actions.includes("verify") || f.actions.includes("submit_result") ? actions : null}
        <UnderlineTabs value={tab} onChange={setTab} options={[{ v: "scorecard", l: "Scorecard" }, { v: "summary", l: "Summary" }, { v: "stats", l: "Stats" }]} />
        {tab === "scorecard" ? (
          <View style={{ gap: SP.md }}>
            {!r || !r.players.length ? <EmptyState title={r ? "No scorecard was submitted" : "No score yet"} body={r ? r.summary : "The scorecard appears here once a captain submits the result."} /> : r.innings.map((i) => {
              const bat = r.players.filter((p) => p.team_id === i.batting_team_id && p.batting);
              const bowl = r.players.filter((p) => p.team_id !== i.batting_team_id && p.bowling && p.bowling.balls);
              return (
                <Card key={i.batting_team_id} style={{ gap: 0, padding: 0, overflow: "hidden" }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: SP.lg, paddingVertical: 12, backgroundColor: T.surface2 }}>
                    <Txt v="h2">{name(i.batting_team_id)}</Txt>
                    <Txt v="h3" style={{ fontVariant: ["tabular-nums"] }}>{i.runs}/{i.wickets} ({overs(i.balls)})</Txt>
                  </View>
                  {bat.map((p) => (
                    <Pressable key={p.user.id} accessibilityRole="button" onPress={() => router.push({ pathname: "/player/[id]", params: { id: p.user.id } })} style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: SP.lg, paddingVertical: 10, borderTopWidth: 1, borderTopColor: T.line }}>
                      <Txt v="bodyMed" numberOfLines={1} style={{ flex: 1 }}>{p.user.full_name}{p.batting!.out ? "" : "*"}</Txt>
                      <Txt v="bodyMed" style={{ fontVariant: ["tabular-nums"] }}>{p.batting!.runs} <Txt v="small" color={T.muted}>({p.batting!.balls})</Txt></Txt>
                    </Pressable>
                  ))}
                  {bowl.length ? <Txt v="micro" color={T.muted} style={{ paddingHorizontal: SP.lg, paddingTop: 12, paddingBottom: 4 }}>Bowling</Txt> : null}
                  {bowl.map((p) => (
                    <View key={p.user.id} style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: SP.lg, paddingVertical: 10, borderTopWidth: 1, borderTopColor: T.line }}>
                      <Txt v="bodyMed" numberOfLines={1} style={{ flex: 1 }}>{p.user.full_name}</Txt>
                      <Txt v="bodyMed" style={{ fontVariant: ["tabular-nums"] }}>{p.bowling!.wickets}/{p.bowling!.runs} <Txt v="small" color={T.muted}>({overs(p.bowling!.balls)})</Txt></Txt>
                    </View>
                  ))}
                </Card>
              );
            })}
            {r?.status === "confirmed" ? (
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, padding: 14, borderRadius: R.lg, backgroundColor: T.successBackground }}>
                <BadgeCheck size={24} color={T.surface} fill={T.successText} strokeWidth={2} />
                <View><Txt v="h3" color={T.successText}>Result confirmed</Txt><Txt v="small" color={T.successText}>By {r.verified_by?.full_name ?? "the opposing captain"}</Txt></View>
              </View>
            ) : r?.status === "submitted" ? (
              <InlineNotice tone="warning">Submitted by {r.submitted_by?.full_name ?? "a captain"} for {name(r.submitted_team_id)}. It becomes official, and updates ratings, once the other captain verifies it.</InlineNotice>
            ) : r?.status === "disputed" ? (
              <InlineNotice tone="warning">Disputed: “{r.dispute_reason}”. Ratings are unchanged until a corrected scorecard is accepted or an admin resolves it.</InlineNotice>
            ) : null}
          </View>
        ) : tab === "summary" ? (
          <View style={{ gap: SP.md }}>
            {r ? <Card><Txt v="h2">{r.summary}</Txt>{r.status === "confirmed" ? <Txt v="small" color={T.muted}>{r.ratings_applied ? "Team and player ratings were updated from this scorecard." : "No ratings change for a no-result."}</Txt> : null}</Card> : null}
            <List>
              {([[Calendar, when(f.start_at)], [MapPin, `${f.venue.name}${f.venue.area ? `, ${f.venue.area}` : ""}`], [Hash, `${formatLabel(f.format)} · ${f.overs} overs · ${f.code}`], ...(f.conditions ? [[FileText, f.conditions] as const] : [])] as const).map(([Icon, text], k, arr) => (
                <Row key={k} last={k === arr.length - 1}><Icon size={18} color={T.primaryDark} strokeWidth={1.8} /><Txt v="body" style={{ flex: 1 }}>{text}</Txt></Row>
              ))}
            </List>
            {!(f.actions.includes("verify") || f.actions.includes("submit_result")) ? actions : null}
            {f.my_team_id && f.status !== "cancelled" ? (
              <Button title="Match expenses · split & track" variant="secondary" icon={<Wallet size={16} color={T.ink} strokeWidth={1.8} />}
                onPress={() => router.push({ pathname: "/fee", params: { fixture: f.id, team: f.my_team_id!, title: `${f.home_team.team_name} vs ${f.away_team.team_name}` } })} />
            ) : null}
            {f.actions.includes("cancel") ? <Button title="Cancel match" variant="danger" onPress={() => Alert.alert("Cancel this match?", "Both teams are notified.", [{ text: "Keep", style: "cancel" }, { text: "Cancel match", style: "destructive", onPress: () => run.mutate({ action: "cancel" }) }])} /> : null}
            {f.status === "scheduled" && !r && !f.actions.includes("submit_result") && f.my_team_id ? <Txt v="small" color={T.muted}>Either captain can submit the result once the match has started.</Txt> : null}
            {r?.notes ? <Txt v="small" color={T.muted}>Notes: {r.notes}</Txt> : null}
          </View>
        ) : (
          <View style={{ gap: SP.md }}>
            {!topBat.length && !topBowl.length ? <EmptyState title="No stats yet" body="Player stats come from the submitted scorecard." /> : null}
            {topBat.length ? (
              <View><RowHeader title="Top batters" /><List>{topBat.map((p, k) => (
                <Row key={p.user.id} last={k === topBat.length - 1}><Avatar name={p.user.full_name} uri={p.user.profile_image} size={36} /><View style={{ flex: 1 }}><Txt v="h3">{p.user.full_name}</Txt><Txt v="small" color={T.muted}>{name(p.team_id)}</Txt></View><Txt v="stat" style={{ fontSize: 18 }}>{p.batting!.runs}<Txt v="small" color={T.muted}> ({p.batting!.balls})</Txt></Txt></Row>
              ))}</List></View>
            ) : null}
            {topBowl.length ? (
              <View><RowHeader title="Top bowlers" /><List>{topBowl.map((p, k) => (
                <Row key={p.user.id} last={k === topBowl.length - 1}><Avatar name={p.user.full_name} uri={p.user.profile_image} size={36} /><View style={{ flex: 1 }}><Txt v="h3">{p.user.full_name}</Txt><Txt v="small" color={T.muted}>{name(p.team_id)}</Txt></View><Txt v="stat" style={{ fontSize: 18 }}>{p.bowling!.wickets}/{p.bowling!.runs}<Txt v="small" color={T.muted}> ({overs(p.bowling!.balls)})</Txt></Txt></Row>
              ))}</List></View>
            ) : null}
          </View>
        )}
      </View>

      <ConfirmationModal visible={verifying} title="Verify this result?" confirm="Yes, it's correct"
        body="Only verify if the score and scorecard are accurate. Verified results update team and player ratings and can only be reversed by a OneShort admin."
        onCancel={() => setVerifying(false)} onConfirm={() => { setVerifying(false); run.mutate({ action: "verify" }); }} loading={run.isPending} />
      <PromptModal visible={disputing} title="Dispute result" body="Explain what's wrong. The other captain can then submit a corrected result, or an admin will review it." placeholder="e.g. We scored 141/9, not 150/9" minLength={5} confirm="Dispute"
        onCancel={() => setDisputing(false)} onSubmit={(reason) => { setDisputing(false); run.mutate({ action: "dispute", body: { reason } }); }} />
    </ScrollView>
  );
}
