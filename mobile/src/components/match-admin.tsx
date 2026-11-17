/**
 * Captain-only match actions that are destructive enough to deserve one implementation.
 *
 * `CancelMatch` is shown on the match page and on Find Players (the dashboard's "Fill Squad"), because a
 * ground falls through while you are looking at the squad you were trying to fill, not only when you happen
 * to be on the match page. `ChangeMatchTime` and `NotifySquad` cover the common match-day case where the
 * previous game overruns or rain holds things up: move the slot, and tell the squad.
 */
import { formatDateTime, formatTime, timeRange, type S } from "@cm/shared";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Alert, Linking, Switch, View } from "react-native";

import { PlayRIcon } from "@/components/icons";
import { CalendarPicker, TimeField } from "@/components/pickers";
import { copyText } from "@/components/regulars";
import { Button, Card, Chip, Field, InlineNotice, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { joinUrl } from "@/lib/joinlink";
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

const DELAY_REASONS = ["Previous match running late", "Rain delay", "Ground not ready", "Other"] as const;
const SHIFTS = [{ l: "+15 min", m: 15 }, { l: "+30 min", m: 30 }, { l: "+45 min", m: 45 }, { l: "+1 hr", m: 60 }, { l: "+2 hr", m: 120 }] as const;
/** IST "YYYY-MM-DD" and "HH:MM" for an instant (the pickers work in IST, like Create a match). */
const istParts = (iso: string) => { const d = new Date(new Date(iso).getTime() + 5.5 * 3600_000).toISOString(); return { date: d.slice(0, 10), time: d.slice(11, 16) }; };
const sameIstDay = (a: string, b: string) => istParts(a).date === istParts(b).date;

/**
 * Move the match: quick "+30 min" style delays for an overrunning slot or rain, or a new date and time.
 * The length of the match is kept. By default the confirmed squad is told at once;
 * the captain can switch that off (e.g. still confirming with the ground) and use "Notify squad" later.
 */
export function ChangeMatchTime({ m, onDone }: { m: S<"MatchOut">; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState<number | "custom" | null>(null);
  const start0 = istParts(m.start_at);
  const [date, setDate] = useState(start0.date);
  const [time, setTime] = useState(start0.time);
  const [choice, setChoice] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [notify, setNotify] = useState(true);
  // "Now" is captured when the captain picks a start, so render stays pure and the past-time check is current.
  const [now, setNow] = useState(0); // set whenever a start is picked, before any new start exists
  const [done, setDone] = useState<{ text: string; notified: boolean } | null>(null);
  const duration = new Date(m.end_at).getTime() - new Date(m.start_at).getTime();
  const newStart = shift === null ? null
    : shift === "custom" ? new Date(`${date}T${time}:00+05:30`)
    : new Date(new Date(m.start_at).getTime() + shift * 60_000);
  const unchanged = !!newStart && newStart.getTime() === new Date(m.start_at).getTime();
  const inPast = !!newStart && newStart.getTime() < now - 5 * 60_000;
  const reason = choice === "Other" ? note.trim() || null : choice;
  const reset = () => { setOpen(false); setShift(null); setChoice(null); setNote(""); setNotify(true); };
  const save = useMutation({
    mutationFn: () => api<S<"MatchOut">>(`/matches/${m.id}`, {
      method: "PUT",
      body: { start_at: newStart!.toISOString(), end_at: new Date(newStart!.getTime() + duration).toISOString(), reschedule_reason: reason, notify_squad: notify },
    }),
    onSuccess: (r) => {
      setDone({ text: timeChangeText(r), notified: notify });
      reset();
      onDone();
    },
    onError: (e) => Alert.alert("Couldn't change the time", errorText(e)),
  });
  if (done) {
    return (
      <Card style={{ gap: SP.md }}>
        <Txt v="h3">Match time updated</Txt>
        <InlineNotice tone={done.notified ? "info" : "warning"}>
          {done.notified ? "Confirmed squad players have been notified." : "Nobody has been told yet. Use \"Notify squad\", or send the message below to your group."}
        </InlineNotice>
        <ShareToGroup text={done.text} />
        <Button title="Done" variant="ghost" onPress={() => setDone(null)} />
      </Card>
    );
  }
  if (!open) return <Button title="Change match time" variant="secondary" icon={<PlayRIcon name="clock" size={18} color={T.primaryDark} />} onPress={() => setOpen(true)} />;
  const newIso = newStart && !Number.isNaN(newStart.getTime()) ? newStart.toISOString() : null;
  return (
    <Card style={{ gap: SP.md }}>
      <View style={{ gap: 2 }}>
        <Txt v="h3">Change match time</Txt>
        <Txt v="small" color={T.muted}>Now: {formatDateTime(m.start_at, m.timezone)}. The match keeps its length.</Txt>
      </View>
      <Txt v="smallSemi">What happened?</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {DELAY_REASONS.map((r) => <Chip key={r} label={r} active={choice === r} onPress={() => setChoice(choice === r ? null : r)} />)}
      </View>
      {choice === "Other" ? <Field label="Reason (players see this)" value={note} onChangeText={setNote} placeholder="e.g. Umpire running late" maxLength={120} /> : null}
      <Txt v="smallSemi">New start</Txt>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {SHIFTS.map((x) => <Chip key={x.m} label={x.l} active={shift === x.m} onPress={() => { setNow(Date.now()); setShift(x.m); }} />)}
        <Chip label="Another day or time" active={shift === "custom"} onPress={() => { setNow(Date.now()); setShift("custom"); }} />
      </View>
      {shift === "custom" ? (
        <View style={{ gap: SP.md }}>
          <CalendarPicker value={date} onChange={(d) => { setNow(Date.now()); setDate(d); }} maxDays={180} />
          <TimeField label="Start time" value={time} onChange={(t) => { setNow(Date.now()); setTime(t); }} />
        </View>
      ) : null}
      {newIso ? (
        <InlineNotice tone={inPast ? "warning" : "info"}>
          {inPast ? "That time has already passed. Pick a later start."
            : unchanged ? "That's the current time. Pick a different start."
            : `New time: ${sameIstDay(newIso, m.start_at) ? "" : `${formatDateTime(newIso, m.timezone, { hour: undefined, minute: undefined })} · `}${timeRange(newIso, new Date(newStart!.getTime() + duration).toISOString(), m.timezone)} (was ${formatTime(m.start_at, m.timezone)})`}
        </InlineNotice>
      ) : null}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Switch accessibilityLabel="Notify the squad now" value={notify} onValueChange={setNotify} trackColor={{ true: T.primary, false: T.switchOff }} thumbColor={T.surface} {...({ activeThumbColor: T.surface, activeTrackColor: T.primary } as object)} />
        <View style={{ flex: 1, gap: 2 }}>
          <Txt v="body">Notify the squad now</Txt>
          <Txt v="small" color={T.muted}>{notify ? "Confirmed squad players get a notification with the new time and reason." : "Nobody is told yet. Send it later with \"Notify squad\"."}</Txt>
        </View>
      </View>
      <Button title={notify ? "Update time & notify squad" : "Update time"} disabled={!newIso || inPast || unchanged} loading={save.isPending} onPress={() => save.mutate()} />
      <Button title="Keep current time" variant="ghost" onPress={reset} />
    </Card>
  );
}

const UPDATE_PRESETS = ["Previous match running late", "Rain delay, we'll start once it clears", "Ground is ready, come on time", "Please reach 15 min early"] as const;

/**
 * Send the squad a timing update without changing the time (or announce a change made with notifications off).
 * The server adds the current start time and limits this to one update every 10 minutes per match.
 */
export function NotifySquad({ m, onDone }: { m: S<"MatchOut">; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const pendingAnnounce = m.last_reschedule && !m.last_reschedule.notified;
  const send = useMutation({
    mutationFn: () => api<S<"NotifySquadOut">>(`/matches/${m.id}/notify-squad`, { method: "POST", body: { message: msg.trim() || null } }),
    onSuccess: (r) => {
      setOpen(false); setMsg(""); onDone();
      Alert.alert("Squad notified", r.notified === 0 ? "Nobody is confirmed in the squad yet, so no one was notified." : r.notified === 1 ? "1 confirmed player was notified." : `${r.notified} confirmed players were notified.`);
    },
    onError: (e) => Alert.alert("Couldn't notify the squad", errorText(e)),
  });
  if (!open) {
    return (
      <View style={{ gap: SP.sm }}>
        {pendingAnnounce ? <InlineNotice tone="warning">{"You changed the time but haven't told the squad yet."}</InlineNotice> : null}
        <Button title="Notify squad" variant={pendingAnnounce ? "primary" : "secondary"} onPress={() => setOpen(true)} />
      </View>
    );
  }
  return (
    <Card style={{ gap: SP.md }}>
      <View style={{ gap: 2 }}>
        <Txt v="h3">Notify squad</Txt>
        <Txt v="small" color={T.muted}>They get your note plus the start time: {formatDateTime(m.start_at, m.timezone)}.</Txt>
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {UPDATE_PRESETS.map((p) => <Chip key={p} label={p} active={msg === p} onPress={() => setMsg(msg === p ? "" : p)} />)}
      </View>
      <Field label="Message (optional)" value={msg} onChangeText={setMsg} placeholder="Write your own note" maxLength={140} />
      <Button title="Send to squad" loading={send.isPending} onPress={() => send.mutate()} />
      <Txt v="small" color={T.muted}>Or send the same update to your team&apos;s WhatsApp group:</Txt>
      <ShareToGroup text={squadUpdateText(m, msg)} />
      <Button title="Cancel" variant="ghost" onPress={() => { setOpen(false); setMsg(""); }} />
    </Card>
  );
}

const matchLink = (m: S<"MatchOut">) => joinUrl(`/match/${m.id}`, `https://oneshort.co/match/${m.id}`);
const groundLine = (m: S<"MatchOut">) => (m.venue.name ? `\nGround: ${m.venue.name}` : "");

/** WhatsApp-group text for a time change, built from the saved match (so it shows the time the server kept). */
export function timeChangeText(m: S<"MatchOut">): string {
  const r = m.last_reschedule;
  const was = r ? ` (was ${sameIstDay(r.from_start, m.start_at) ? formatTime(r.from_start, m.timezone) : formatDateTime(r.from_start, m.timezone)})` : "";
  const why = r?.reason ? `\nReason: ${r.reason}` : "";
  return `⏰ Match time changed: ${m.title}\nNew time: ${formatDateTime(m.start_at, m.timezone)}${was}${why}${groundLine(m)}\n${matchLink(m)}`;
}

/** WhatsApp-group text for a captain update: the note plus the current start time. */
export function squadUpdateText(m: S<"MatchOut">, note: string): string {
  const n = note.trim();
  return `📢 ${m.title}${n ? `\n${n}` : ""}\nStart time: ${formatDateTime(m.start_at, m.timezone)}${groundLine(m)}\n${matchLink(m)}`;
}

/** Shows a message the way WhatsApp will: *bold* and _italic_ rendered, the markers hidden. */
function WhatsAppText({ text }: { text: string }) {
  return (
    <Txt v="small" selectable>
      {text.split(/(\*[^*\n]+\*|_[^_\n]+_)/g).map((part, i) =>
        part.length > 2 && part.startsWith("*") && part.endsWith("*") ? <Txt key={i} v="smallSemi">{part.slice(1, -1)}</Txt>
        : part.length > 2 && part.startsWith("_") && part.endsWith("_") ? <Txt key={i} v="small" style={{ fontStyle: "italic" }}>{part.slice(1, -1)}</Txt>
        : part)}
    </Txt>
  );
}

/** Copy a ready-made message for the team's WhatsApp group, or open WhatsApp with it filled in. */
export function ShareToGroup({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <View style={{ gap: SP.sm }}>
      <View style={{ padding: 12, borderRadius: 12, backgroundColor: T.surface2 }}>
        <WhatsAppText text={text} />
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button title={copied ? "Copied" : "Copy for group"} variant="secondary" style={{ flex: 1 }}
          onPress={() => void copyText(text).then((ok) => { if (ok) { setCopied(true); setTimeout(() => setCopied(false), 2500); } })} />
        <Button title="WhatsApp" icon={<PlayRIcon name="chat" size={18} color="#FFFFFF" />} style={{ flex: 1 }}
          onPress={() => void Linking.openURL(`https://wa.me/?text=${encodeURIComponent(text)}`)} />
      </View>
    </View>
  );
}

/** Both captain timing actions together, for the match page and Find Players. Hidden once a match has started. */
export function MatchTimeTools({ m, onDone }: { m: S<"MatchOut">; onDone: () => void }) {
  if (m.viewer_relation !== "manager" || ["in_progress", "completed", "cancelled"].includes(m.match_status)) return null;
  return (
    <View style={{ gap: SP.sm }}>
      <ChangeMatchTime m={m} onDone={onDone} />
      <NotifySquad m={m} onDone={onDone} />
    </View>
  );
}
