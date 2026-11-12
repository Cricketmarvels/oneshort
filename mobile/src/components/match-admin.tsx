/**
 * Captain-only match actions that are destructive enough to deserve one implementation.
 *
 * `CancelMatch` is shown on the match page and on Find Players (the dashboard's "Fill Squad"), because a
 * ground falls through while you are looking at the squad you were trying to fill, not only when you happen
 * to be on the match page.
 */
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, View } from "react-native";

import { Button, Card, Chip, Field, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { SP, T } from "@/theme";

const REASONS = ["Ground unavailable", "Not enough players", "Rain / bad weather", "Other"] as const;

/**
 * Call a match off. Everyone in the squad and everyone invited is told, pending invitations are withdrawn,
 * and the match drops out of every upcoming list. It stays under past matches as "Cancelled", keeping the
 * squad, the fee ledger and the reason — which is why there is no undo.
 */
export function CancelMatch({ id, squad, onCancelled }: { id: string; squad: number; onCancelled: () => void }) {
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const reason = choice === "Other" ? note.trim() : choice;
  const cancel = useMutation({
    mutationFn: () => api(`/matches/${id}/cancel`, { method: "POST", body: { reason } }),
    onSuccess: onCancelled,
    onError: (e) => Alert.alert("Couldn't cancel the match", errorText(e)),
  });
  const confirm = () =>
    Alert.alert(
      "Call this match off?",
      `${squad === 1 ? "You are" : `${squad} players are`} in the squad. Everyone is told, invitations are withdrawn, and this can't be undone.`,
      [{ text: "Keep match", style: "cancel" }, { text: "Cancel match", style: "destructive", onPress: () => cancel.mutate() }],
    );
  if (!open) return <Button title="Cancel this match" variant="ghost" onPress={() => setOpen(true)} />;
  return (
    <Card style={{ gap: SP.md }}>
      <View style={{ gap: 2 }}>
        <Txt v="h3">Why is it off?</Txt>
        <Txt v="small" color={T.muted}>Players see the reason.</Txt>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {REASONS.map((r) => <Chip key={r} label={r} active={choice === r} onPress={() => setChoice(r)} />)}
      </View>
      {choice === "Other" ? <Field label="Reason" value={note} onChangeText={setNote} placeholder="Tell the squad what happened" maxLength={120} /> : null}
      <Button title="Cancel match" variant="danger" disabled={!reason} loading={cancel.isPending} onPress={confirm} />
      <Button title="Keep match" variant="ghost" onPress={() => { setOpen(false); setChoice(null); }} />
    </Card>
  );
}
