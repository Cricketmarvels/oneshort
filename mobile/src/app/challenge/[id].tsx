import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Calendar, CheckCircle2, MapPin, MessageSquare, Trophy } from "lucide-react-native";
import { useState } from "react";
import { Alert, Modal, ScrollView, View } from "react-native";

import { ChallengeStatusBadge, TeamLogo } from "@/components/cricket";
import { initialProposal, ProposalForm, toProposalIn } from "@/components/proposal";
import { ConfirmationModal, PromptModal } from "@/components/sheet";
import { Button, Card, ErrorBox, Field, LoadingSkeleton, Section, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { CHALLENGE_LABEL, formatLabel, rating, when } from "@/lib/format";
import type { Challenge } from "@/lib/types";
import { R, SP, T } from "@/theme";

const STEPS = ["pending", "accepted", "confirmed", "completed"];

export default function ChallengeDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["challenge", id], queryFn: () => api<Challenge>(`/challenges/${id}`) });
  const [counterOpen, setCounterOpen] = useState(false);
  const [proposal, setProposal] = useState(initialProposal());
  const [message, setMessage] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const run = useMutation({
    mutationFn: ({ action, body }: { action: string; body?: unknown }) => api<Challenge>(`/challenges/${id}/${action}`, { method: "POST", body: body ?? {} }),
    onSuccess: (c) => {
      qc.setQueryData(["challenge", id], c);
      void qc.invalidateQueries({ queryKey: ["challenges"] });
      void qc.invalidateQueries({ queryKey: ["home"] });
      void qc.invalidateQueries({ queryKey: ["fixtures"] });
      setCounterOpen(false);
      if (c.status === "confirmed" && c.fixture_id) Alert.alert("Match confirmed", "It's in both teams' fixtures.", [{ text: "Open match", onPress: () => router.push({ pathname: "/fixture/[id]", params: { id: c.fixture_id! } }) }, { text: "OK" }]);
    },
    onError: (e) => Alert.alert("Couldn't update the challenge", errorText(e)),
  });
  if (q.isPending) return <View style={{ padding: SP.page }}><LoadingSkeleton rows={4} /></View>;
  if (q.isError) return <View style={{ padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View>;
  const c = q.data;
  const can = (a: string) => c.actions.includes(a as never);
  const p = c.proposal;
  const step = c.status === "counter_proposed" ? 0 : STEPS.indexOf(c.status);
  const myTurn = c.actions.some((a) => a !== "cancel");
  return (
    <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.xl, paddingBottom: 60 }}>
      <View>
<View style={{ padding: SP.page, gap: SP.lg }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <Txt v="label" color={T.accent}>{c.my_side === "to" ? "Incoming challenge" : c.my_side === "from" ? "Your challenge" : "Challenge"}</Txt>
          <ChallengeStatusBadge status={c.status} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {[c.from_team, c.to_team].map((t, i) => (
            <View key={t.id} style={{ flex: 1, alignItems: "center", gap: 6 }}>
              <TeamLogo team={t} size={58} />
              <Txt v="smallSemi" color={T.ink} style={{ textAlign: "center" }} onPress={() => router.push({ pathname: "/team/[id]", params: { id: t.id } })}>{t.team_name}</Txt>
              <Txt v="small" color={T.muted}>{t.rating ? rating(t.rating.rating) : "Unrated"}</Txt>
              {i === 0 ? null : null}
            </View>
          ))}
        </View>
        {/* status timeline */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {STEPS.map((s, i) => (
            <View key={s} style={{ flex: 1, gap: 4 }}>
              <View style={{ height: 4, borderRadius: 2, backgroundColor: i <= step && !["rejected", "cancelled"].includes(c.status) ? T.accent : T.line }} />
              <Txt v="label" color={i <= step ? T.ink : T.muted} style={{ fontSize: 9 }}>{CHALLENGE_LABEL[s]}</Txt>
            </View>
          ))}
        </View>
      </View>
</View>

      <Section title={c.status === "counter_proposed" ? "Latest proposal (counter)" : "Proposal"}>
        <Card style={{ gap: SP.md }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Calendar size={18} color={T.ink} strokeWidth={1.5} /><Txt v="bodyMed">{when(p.start_at)}</Txt></View>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><MapPin size={18} color={T.ink} strokeWidth={1.5} /><Txt v="bodyMed" style={{ flex: 1 }}>{p.venue.name}{p.venue.area ? `, ${p.venue.area}` : ""}</Txt></View>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}><Trophy size={18} color={T.ink} strokeWidth={1.5} /><Txt v="bodyMed">{formatLabel(p.format)} · {p.overs} overs a side</Txt></View>
          {p.conditions ? <Txt v="small" color={T.text2}>{p.conditions}</Txt> : null}
        </Card>
      </Section>

      {myTurn ? (
        <View style={{ gap: SP.sm }}>
          {can("accept") ? <Button title="Accept proposal" variant="lime" size="lg" loading={run.isPending} onPress={() => run.mutate({ action: "accept" })} /> : null}
          {can("confirm") ? <Button title="Confirm schedule" variant="lime" size="lg" icon={<CheckCircle2 size={18} color={T.ink} strokeWidth={1.5} />} loading={run.isPending} onPress={() => run.mutate({ action: "confirm" })} /> : null}
          {can("send") ? <Button title="Send challenge" variant="lime" size="lg" loading={run.isPending} onPress={() => run.mutate({ action: "send" })} /> : null}
          {can("counter") ? <Button title="Propose different details" variant="secondary" onPress={() => { setProposal(initialProposal(p)); setCounterOpen(true); }} /> : null}
          {can("reject") ? <Button title="Decline" variant="ghost" onPress={() => setRejecting(true)} /> : null}
        </View>
      ) : c.awaiting_team_id ? (
        <View style={{ padding: SP.page, borderRadius: R.lg, backgroundColor: T.tint }}>
          <Txt v="small" color={T.ink2}>Waiting for {c.awaiting_team_id === c.from_team.id ? c.from_team.team_name : c.to_team.team_name} to {c.status === "accepted" ? "confirm the schedule" : "respond"}.</Txt>
        </View>
      ) : null}
      {c.fixture_id ? <Button title="Open match" onPress={() => router.push({ pathname: "/fixture/[id]", params: { id: c.fixture_id! } })} /> : null}
      {can("cancel") ? <Button title={c.status === "draft" ? "Delete draft" : "Cancel challenge"} variant="ghost" onPress={() => setCancelling(true)} /> : null}

      <Section title="History">
        {c.history.slice().reverse().map((h, i) => (
          <Card key={i}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <MessageSquare size={15} color={T.muted} strokeWidth={1.5} />
              <Txt v="smallSemi" style={{ flex: 1 }}>{h.by_user?.full_name ?? "Captain"} · {h.by_team_id === c.from_team.id ? c.from_team.team_name : c.to_team.team_name}</Txt>
              <Txt v="small" color={T.muted}>{when(h.at, { day: "numeric", month: "short" })}</Txt>
            </View>
            <Txt v="small" color={T.text2}>{i === c.history.length - 1 ? "Proposed" : "Counter-proposed"}: {when(h.proposal.start_at)} · {formatLabel(h.proposal.format)} · {h.proposal.venue.name}</Txt>
            {h.message ? <Txt v="body">“{h.message}”</Txt> : null}
          </Card>
        ))}
      </Section>

      <Modal visible={counterOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCounterOpen(false)}>
        <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 60, backgroundColor: T.paper }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: "row", alignItems: "center" }}><Txt v="h2" style={{ flex: 1 }}>Counter-proposal</Txt><Button title="Close" variant="ghost" size="sm" onPress={() => setCounterOpen(false)} /></View>
          <ProposalForm value={proposal} onChange={setProposal} />
          <Field label="Message (optional)" value={message} onChangeText={setMessage} maxLength={200} placeholder="Can we do Sunday instead?" />
          <Button title="Send counter-proposal" size="lg" variant="lime" disabled={!toProposalIn(proposal)} loading={run.isPending} onPress={() => run.mutate({ action: "counter-propose", body: { proposal: toProposalIn(proposal), message: message || null } })} />
        </ScrollView>
      </Modal>
      <PromptModal visible={rejecting} title="Decline challenge" body="Optional: tell them why." placeholder="We're booked that weekend" confirm="Decline" minLength={0}
        onCancel={() => setRejecting(false)} onSubmit={(m) => { setRejecting(false); run.mutate({ action: "reject", body: { message: m || null } }); }} />
      <ConfirmationModal visible={cancelling} title={c.status === "confirmed" ? "Cancel this match?" : "Cancel challenge?"} destructive confirm="Yes, cancel"
        body={c.status === "confirmed" ? "The fixture is removed from both teams' schedules and the other captain is notified." : undefined}
        onCancel={() => setCancelling(false)} onConfirm={() => { setCancelling(false); run.mutate({ action: "cancel" }); }} />
    </ScrollView>
  );
}
