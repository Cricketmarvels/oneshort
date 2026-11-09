import { ROLE_LABELS, type PlayerSelf, type S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Bell, CalendarDays, ChevronRight, LogOut, MapPin, Plus, Trophy, Users, Wallet } from "lucide-react-native";
import { type ComponentType, useState } from "react";
import { Alert, Pressable, ScrollView, Switch, View } from "react-native";

import { TeamLogo } from "@/components/cricket";
import { Avatar, Button, Card, Divider, Section, Segmented, Txt } from "@/components/ui";
import { useAppearance } from "@/lib/appearance";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { currentLocation, pickAndUpload } from "@/lib/device";
import { SP, T } from "@/theme";

type IconT = ComponentType<{ size?: number; color?: string }>;
const PREF_GROUPS: { label: string; types: S<"NotificationType">[] }[] = [
  { label: "Team challenges", types: ["team_challenge", "challenge_accepted", "challenge_counter", "challenge_confirmed", "challenge_rejected", "challenge_cancelled"] },
  { label: "Match results & disputes", types: ["result_submitted", "result_confirmed", "result_disputed"] },
  { label: "Rating & leaderboard changes", types: ["rating_updated"] },
  { label: "Community announcements", types: ["community_announcement", "community_join_request", "community_membership"] },
  { label: "Match reminders", types: ["match_reminder", "match_rescheduled", "match_cancelled"] },
  { label: "Invitations & join requests", types: ["player_invitation", "team_invitation", "join_request"] },
];

function Row({ icon: Icon, label, onPress }: { icon: IconT; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12, opacity: pressed ? 0.7 : 1 })}>
      <View style={{ width: 34, height: 34, borderRadius: 11, backgroundColor: T.paper, alignItems: "center", justifyContent: "center" }}><Icon size={17} color={T.ink} /></View>
      <Txt v="bodyMed" style={{ flex: 1 }}>{label}</Txt>
      <ChevronRight size={18} color={T.muted} strokeWidth={1.5} />
    </Pressable>
  );
}

export default function Profile() {
  const { user, reload, signOut } = useAuth();
  const prof = useQuery({ queryKey: ["player", "me"], queryFn: () => api<PlayerSelf>("/players/me"), retry: false });
  const teams = useQuery({ queryKey: ["teams", "member"], queryFn: () => api<{ data: S<"TeamOut">[] }>("/teams", { query: { scope: "member" } }) });
  const meQ = useQuery({ queryKey: ["users", "me"], queryFn: () => api<S<"UserOut">>("/users/me") });
  const appearance = useAppearance();
  const blocks = useQuery({ queryKey: ["blocks"], queryFn: () => api<S<"BlockedUserOut">[]>("/users/me/blocks") });
  const muted = new Set(meQ.data?.notification_prefs.muted_types ?? []);
  const togglePref = async (types: S<"NotificationType">[], on: boolean) => {
    const prefs = meQ.data!.notification_prefs;
    const cur = prefs.muted_types ?? [];
    const next = on ? cur.filter((t) => !types.includes(t)) : [...new Set([...cur, ...types])];
    try { await api("/users/me", { method: "PUT", body: { notification_prefs: { ...prefs, muted_types: next } } }); void meQ.refetch(); } catch (e) { Alert.alert("Couldn't save", errorText(e)); }
  };
  const simOpts = useQuery({ queryKey: ["auth-options"], queryFn: () => api<S<"AuthOptionsOut">>("/auth/options"), staleTime: 60_000 });
  const simulatorMode = !!simOpts.data?.whatsapp_simulator;
  const [waTest, setWaTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [waTesting, setWaTesting] = useState(false);
  const testWhatsApp = async () => {
    setWaTesting(true);
    try {
      const r = await api<{ status: string }>("/users/me/whatsapp-test", { method: "POST" });
      const msg: Record<string, string> = {
        sent: simulatorMode ? "Sent to the WhatsApp simulator (test mode) — open it below." : "Sent — check WhatsApp on your phone.",
        failed: "WhatsApp rejected the message. If you're using the Twilio sandbox, send the join code from your phone first.",
        not_configured: "WhatsApp isn't connected to PlayR yet (no provider set up on the server).",
        opted_out: "Switch on WhatsApp updates first.",
        no_number: "Add a mobile number to your account first.",
      };
      setWaTest({ ok: r.status === "sent", text: msg[r.status] ?? r.status });
    } catch (e) { setWaTest({ ok: false, text: errorText(e) }); } finally { setWaTesting(false); }
  };
  const setWhatsApp = async (on: boolean) => {
    if (on && !meQ.data?.mobile_number) return Alert.alert("Add your mobile number first", "WhatsApp messages go to your verified mobile number.");
    try { await api("/users/me", { method: "PUT", body: { notification_prefs: { ...meQ.data!.notification_prefs, whatsapp: on } } }); void meQ.refetch(); } catch (e) { Alert.alert("Couldn't save", errorText(e)); }
  };
  const photo = async () => {
    try { const url = await pickAndUpload("library"); if (url) { await api("/users/me", { method: "PUT", body: { profile_image: url } }); await reload(); } }
    catch (e) { Alert.alert("Upload failed", errorText(e)); }
  };
  const updateLocation = async () => {
    const loc = await currentLocation();
    if (!loc) return Alert.alert("Location", "Permission denied. You can still pick an area on the leaderboard.");
    const p = prof.data;
    await api("/players/me", { method: "PUT", body: { primary_role: p?.primary_role ?? "batsman", secondary_roles: p?.secondary_roles ?? [], home_location: loc, locality: p?.locality, availability_visibility: p?.availability_visibility ?? "discoverable" } });
    void prof.refetch();
    Alert.alert("Home area updated", "Others only ever see an approximate distance.");
  };
  return (
    <ScrollView style={{ backgroundColor: T.paper }} contentContainerStyle={{ paddingBottom: 60 }}>
      <View>
<View style={{ padding: SP.page, paddingTop: SP.sm, alignItems: "center", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Change profile photo" onPress={() => void photo()}>
          <Avatar uri={user?.profile_image} name={user?.full_name ?? "Me"} size={88} />
        </Pressable>
        <Txt v="h1" color={T.ink}>{user?.full_name}</Txt>
        <Txt v="small" color={T.muted}>{[prof.data?.locality, user?.city].filter(Boolean).join(", ")} · {prof.data ? ROLE_LABELS[prof.data.primary_role] : ""}</Txt>
        {user ? <Button title="View my rating & stats" variant="lime" size="sm" icon={<Trophy size={15} color={T.ink} strokeWidth={1.5} />} onPress={() => router.push({ pathname: "/player/[id]", params: { id: user.id } })} /> : null}
      </View>
</View>
      <View style={{ padding: SP.page, gap: SP.xl }}>
        <Section title="My teams" action="Create team" onAction={() => router.push("/team/new")}>
          {(teams.data?.data ?? []).map((t) => (
            <Card key={t.id} onPress={() => router.push({ pathname: "/team/[id]", params: { id: t.id } })} label={t.team_name}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <TeamLogo team={t} size={40} />
                <View style={{ flex: 1 }}><Txt v="h3">{t.team_name}</Txt><Txt v="small" color={T.muted}>{t.my_membership === "admin" ? "Vice-captain" : t.my_membership === "captain" ? "Captain" : "Member"} · {t.member_count} players</Txt></View>
                <ChevronRight size={18} color={T.muted} strokeWidth={1.5} />
              </View>
            </Card>
          ))}
          {!teams.isPending && !teams.data?.data.length ? <Button title="Create a team" variant="secondary" icon={<Plus size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => router.push("/team/new")} /> : null}
        </Section>
        <Card style={{ gap: 0 }}>
          <Row icon={CalendarDays} label="Availability" onPress={() => router.push("/availability")} />
          <Divider />
          <Row icon={Wallet} label="My match fees" onPress={() => router.push("/payments")} />
          <Divider />
          <Row icon={Bell} label="Notifications" onPress={() => router.push("/notifications")} />
          <Divider />
          <Row icon={MapPin} label="Set home area from my location" onPress={() => void updateLocation()} />
          <Divider />
          <Row icon={Users} label="My teams" onPress={() => router.push("/teams")} />
        </Card>
        <Section title="Appearance">
          <Card style={{ gap: 10 }}>
            <Segmented value={appearance.pref} onChange={appearance.set} options={[{ v: "light", l: "Light" }, { v: "dark", l: "Dark" }, { v: "system", l: "System" }]} />
            <Txt v="small" color={T.muted}>{appearance.pref === "system" ? "Follows your phone's light/dark setting." : appearance.pref === "dark" ? "Dark theme is on." : "Light theme is on."}</Txt>
          </Card>
        </Section>
        {blocks.data?.length ? (
          <Section title={`Blocked people (${blocks.data.length})`}>
            <Card style={{ gap: 0 }}>
              {blocks.data.map((b, i) => (
                <View key={b.user.id} style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: T.line }}>
                  <Avatar name={b.user.full_name} uri={b.user.profile_image} size={36} />
                  <Txt v="bodyMed" style={{ flex: 1 }} numberOfLines={1}>{b.user.full_name}</Txt>
                  <Button title="Unblock" size="sm" variant="secondary" onPress={() => void api(`/users/${b.user.id}/block`, { method: "DELETE" }).then(() => blocks.refetch()).catch((e) => Alert.alert("Couldn't unblock", errorText(e)))} />
                </View>
              ))}
            </Card>
            <Txt v="small" color={T.muted}>Blocked people's posts are hidden from you. They aren't notified.</Txt>
          </Section>
        ) : null}
        {meQ.data ? (
          <Section title="Notify me about">
            <Card style={{ gap: 0 }}>
              {PREF_GROUPS.map((g, i) => {
                const on = !g.types.every((t) => muted.has(t));
                return (
                  <View key={g.label}>
                    {i ? <Divider /> : null}
                    <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10 }}>
                      <Txt v="bodyMed" style={{ flex: 1 }}>{g.label}</Txt>
                      <Switch value={on} onValueChange={(v) => void togglePref(g.types, v)} trackColor={{ true: T.accent, false: T.switchOff }} thumbColor={T.surface} {...({ activeThumbColor: T.surface, activeTrackColor: T.accent } as object)} accessibilityLabel={g.label} />
                    </View>
                  </View>
                );
              })}
              <Divider />
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Txt v="bodyMed">WhatsApp updates</Txt>
                  <Txt v="small" color={T.muted}>Get match invitations on WhatsApp, and let captains and players you've agreed to play with message you there.</Txt>
                </View>
                <Switch value={!!meQ.data.notification_prefs.whatsapp} onValueChange={(v) => { setWaTest(null); void setWhatsApp(v); }} trackColor={{ true: T.accent, false: T.switchOff }} thumbColor={T.surface} {...({ activeThumbColor: T.surface, activeTrackColor: T.accent } as object)} accessibilityLabel="WhatsApp updates" />
              </View>
              {meQ.data.notification_prefs.whatsapp ? (
                <View style={{ gap: 6, paddingBottom: 10 }}>
                  <Txt v="small" color={T.muted}>Messages go to {meQ.data.mobile_number}.</Txt>
                  <Button title="Send a test message" variant="secondary" size="sm" loading={waTesting} onPress={() => void testWhatsApp()} style={{ alignSelf: "flex-start" }} />
                  {waTest ? <Txt v="small" color={waTest.ok ? T.successText : T.warningText}>{waTest.text}</Txt> : null}
                  {simulatorMode ? <Button title="Open WhatsApp simulator (test mode)" variant="ghost" size="sm" onPress={() => router.push("/whatsapp-sim")} style={{ alignSelf: "flex-start" }} /> : null}
                </View>
              ) : null}
            </Card>
          </Section>
        ) : null}
        <Button title="Privacy & data" variant="secondary" onPress={() => router.push("/privacy")} />
        <Button title="Signed-in devices" variant="secondary" onPress={() => router.push("/sessions")} />
        <Button title="Log out" variant="secondary" icon={<LogOut size={16} color={T.ink} strokeWidth={1.5} />} onPress={() => void signOut()} />
      </View>
    </ScrollView>
  );
}
