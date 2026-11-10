import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import type { S } from "@cm/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { Lock, Megaphone, Shield, Users } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, RefreshControl, ScrollView, TextInput, View } from "react-native";

import { CommunityFeedItem, PlayerLeaderboardCard, TeamLogo } from "@/components/cricket";
import { PhotoHero, ShareButton } from "@/components/identity";
import { ConfirmationModal, FilterBottomSheet, PromptModal } from "@/components/sheet";
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorBox, List, LoadingSkeleton, Row, Segmented, Txt, UnderlineTabs } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { rating, when } from "@/lib/format";
import { useManagedTeam } from "@/lib/hooks";
import type { Community, Post } from "@/lib/types";
import { FW, R, shadow, SP, T } from "@/theme";

type Tab = "events" | "announcements" | "discussion" | "members" | "teams" | "rankings";

export default function CommunityDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const qc = useQueryClient();
  const c = useQuery({ queryKey: ["community", id], queryFn: () => api<Community>(`/communities/${id}`) });
  const [tab, setTab] = useState<Tab>("events");
  const [joinOpen, setJoinOpen] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["community", id] }); void qc.invalidateQueries({ queryKey: ["communities"] }); };
  const join = useMutation({
    mutationFn: () => api<Community>(`/communities/${id}/join`, { method: "POST", body: { accept_guidelines: true } }),
    onSuccess: (r) => { setJoinOpen(false); refresh(); if (r.my_status === "pending") Alert.alert("Request sent", "A moderator will review your request."); },
    onError: (e) => Alert.alert("Couldn't join", errorText(e)),
  });
  const leave = useMutation({ mutationFn: () => api(`/communities/${id}/leave`, { method: "POST" }), onSuccess: refresh, onError: (e) => Alert.alert("Couldn't leave", errorText(e)) });

  if (c.isPending) return <View style={{ padding: SP.page }}><LoadingSkeleton rows={4} /></View>;
  if (c.isError) return <View style={{ padding: SP.page }}><ErrorBox error={c.error} onRetry={() => void c.refetch()} /></View>;
  const com = c.data;
  const member = !!com.my_role;
  const canRead = com.visibility === "public" || member;
  return (
    <>
      <Stack.Screen options={{ title: "Community", headerTitleAlign: "center", headerRight: () => <ShareButton message={`${com.name} on GoFindr — ${com.member_count} members`} /> }} />
      <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ paddingBottom: 60 }} refreshControl={<RefreshControl refreshing={c.isRefetching} onRefresh={refresh} tintColor={T.primary} />}>
        <View style={{ paddingHorizontal: SP.page, paddingTop: SP.sm }}>
          <PhotoHero photo="ground" height={170} scrim={0.08} />
          <View style={{ marginTop: -44, marginLeft: 14, width: 84, height: 84, borderRadius: 42, backgroundColor: T.surface, alignItems: "center", justifyContent: "center", borderWidth: 4, borderColor: T.bg, ...shadow(2) }}>
            <View style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: T.tint, alignItems: "center", justifyContent: "center" }}><Users size={34} color={T.primary} strokeWidth={2} /></View>
          </View>
        </View>
        <View style={{ paddingHorizontal: SP.page, paddingTop: SP.sm, gap: SP.md }}>
          <View style={{ gap: 2 }}>
            <Txt v="hero" style={{ fontSize: 23 }}>{com.name}</Txt>
            <Txt v="body" color={T.muted}>{com.member_count} members • {[...new Set([com.area, com.city].filter(Boolean))].join(", ")}{com.team_count ? ` • ${com.team_count} teams` : ""}</Txt>
          </View>
          {com.description ? <Txt v="body" color={T.muted}>{com.description}</Txt> : null}
          <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
            <Badge status="neutral" label={com.kind.charAt(0).toUpperCase() + com.kind.slice(1)} />
            {com.visibility === "private" ? <Badge status="neutral" icon={<Lock size={11} color={T.muted} strokeWidth={2} />} label="Private" /> : <Badge status="neutral" label="Public" />}
            {com.my_role ? <Badge status="info" label={`You: ${com.my_role.charAt(0).toUpperCase() + com.my_role.slice(1)}`} /> : null}
          </View>
          {!member ? (
            com.my_status === "pending" ? <Badge status="warning" label="Request pending approval" />
              : com.my_status === "banned" ? <Badge status="danger" label="You can't join this community" />
              : <Button title={com.visibility === "private" ? "Request to join" : "Join community"} size="lg" onPress={() => setJoinOpen(true)} style={{ borderRadius: R.pill }} />
          ) : null}
        </View>
        <View style={{ padding: SP.page, gap: SP.lg }}>
          {!canRead ? (
            <EmptyState icon={<Lock size={22} color={T.primaryDark} strokeWidth={1.8} />} title="Private community" body="Members see events, announcements and discussions. Request to join to take part." />
          ) : (
            <>
              <UnderlineTabs value={tab} onChange={setTab} options={[{ v: "events", l: "Events" }, { v: "announcements", l: "Announcements" }, { v: "discussion", l: "Discussion" }, { v: "members", l: "Members" }]} />
              {tab === "events" ? <Feed com={com} only={["match", "tournament"]} />
                : tab === "announcements" ? <Feed com={com} only={["announcement"]} />
                : tab === "discussion" ? <Feed com={com} only={["post", "poll"]} />
                : tab === "members" ? <Members com={com} /> : tab === "teams" ? <Teams com={com} /> : <Rankings id={com.id} />}
              <List>
                <Row onPress={() => setTab("teams")} label="Teams in this community"><Txt v="h3" style={{ flex: 1, fontSize: 14.5 }}>Teams in this community</Txt><Txt v="small" color={T.muted}>{com.team_count}</Txt></Row>
                <Row onPress={() => setTab("rankings")} label="Community rankings" last><Txt v="h3" style={{ flex: 1, fontSize: 14.5 }}>Community rankings</Txt></Row>
              </List>
            </>
          )}
          <Card style={{ backgroundColor: T.surface2 }}>
            <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}><Shield size={15} color={T.muted} strokeWidth={1.8} /><Txt v="label" color={T.muted}>Safety</Txt></View>
            {com.guidelines ? <Txt v="small" color={T.muted}>Guidelines: {com.guidelines}</Txt> : null}
            <Txt v="small" color={T.muted}>{com.disclaimer}</Txt>
            {member && com.my_role !== "owner" ? <Button title="Leave community" variant="ghost" size="sm" onPress={() => Alert.alert("Leave this community?", "You can join again later.", [{ text: "Stay", style: "cancel" }, { text: "Leave", style: "destructive", onPress: () => leave.mutate() }])} style={{ alignSelf: "flex-start" }} /> : null}
          </Card>
        </View>
      </ScrollView>
      <ConfirmationModal visible={joinOpen} title={`Join ${com.name}?`} confirm="I agree, join"
        body={`${com.guidelines ? `Community guidelines: ${com.guidelines}\n\n` : ""}${com.disclaimer}`}
        onCancel={() => setJoinOpen(false)} onConfirm={() => join.mutate()} loading={join.isPending} />
    </>
  );
}

function Feed({ com, only }: { com: Community; only: S<"CommunityPostType">[] }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const key = ["community", com.id, "feed"];
  const feed = useQuery({ queryKey: key, queryFn: () => api<Post[]>(`/communities/${com.id}/feed`) });
  const [body, setBody] = useState("");
  const [type, setType] = useState<S<"CommunityPostType">>(only[0]!);
  const [options, setOptions] = useState(["", ""]);
  const [focus, setFocus] = useState<Post | null>(null);
  const [reporting, setReporting] = useState(false);
  const sheet = useRef<BottomSheetModal>(null);
  const reload = () => void qc.invalidateQueries({ queryKey: key });
  const post = useMutation({
    mutationFn: () => api<Post>(`/communities/${com.id}/posts`, { method: "POST", body: { type, body, poll_options: type === "poll" ? options.filter((o) => o.trim()).map((text) => ({ text })) : [] } }),
    onSuccess: () => { setBody(""); setOptions(["", ""]); setType("post"); reload(); },
    onError: (e) => Alert.alert("Couldn't post", errorText(e)),
  });
  const act = async (fn: () => Promise<unknown>, done: string) => {
    try { await fn(); sheet.current?.dismiss(); reload(); Alert.alert(done); } catch (e) { Alert.alert("Couldn't do that", errorText(e)); }
  };
  const types: { v: S<"CommunityPostType">; l: string; staff?: boolean }[] = [
    { v: "post", l: "Post" }, { v: "match", l: "Match" }, { v: "announcement", l: "Announcement", staff: true }, { v: "poll", l: "Poll", staff: true }, { v: "tournament", l: "Tournament", staff: true },
  ];
  const canCompose = !!com.my_role && types.some((t) => only.includes(t.v) && (!t.staff || com.can_moderate));
  const items = (feed.data ?? []).filter((p) => only.includes(p.type));
  return (
    <View style={{ gap: SP.md }}>
      {canCompose ? (
        <Card>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {types.filter((t) => (!t.staff || com.can_moderate) && only.includes(t.v)).map((t) => <Chip key={t.v} label={t.l} active={type === t.v} onPress={() => setType(t.v)} icon={t.v === "announcement" ? <Megaphone size={13} color={type === t.v ? T.accent : T.muted} strokeWidth={1.5} /> : undefined} />)}
          </View>
          <TextInput accessibilityLabel="Write a post" value={body} onChangeText={setBody} multiline maxLength={2000} placeholder={type === "poll" ? "Ask a question…" : "Share with the community…"} placeholderTextColor={T.muted}
            style={{ minHeight: 70, ...FW.body, fontSize: 15, color: T.text, textAlignVertical: "top" }} />
          {type === "poll" ? options.map((o, i) => (
            <TextInput key={i} accessibilityLabel={`Option ${i + 1}`} value={o} onChangeText={(v) => setOptions(options.map((x, j) => (j === i ? v : x)))} placeholder={`Option ${i + 1}`} placeholderTextColor={T.muted}
              style={{ height: 42, borderRadius: R.sm, borderWidth: 1, borderColor: T.line, paddingHorizontal: 12, ...FW.body, color: T.text }} />
          )) : null}
          {type === "poll" && options.length < 6 ? <Button title="Add option" variant="ghost" size="sm" onPress={() => setOptions([...options, ""])} /> : null}
          <Button title="Post" size="sm" disabled={!body.trim() || (type === "poll" && options.filter((o) => o.trim()).length < 2)} loading={post.isPending} onPress={() => post.mutate()} style={{ alignSelf: "flex-end" }} />
        </Card>
      ) : !com.my_role ? <Txt v="small" color={T.muted}>Join to post, vote and organise games.</Txt> : null}
      {feed.isPending ? <LoadingSkeleton rows={3} /> : feed.isError ? <ErrorBox error={feed.error} /> : !items.length ? (
        <EmptyState title={only.includes("match") ? "No upcoming events" : only.includes("announcement") ? "No announcements yet" : "No discussions yet"} body={only.includes("match") ? "Matches and tournaments shared here show up as events." : "Start the conversation: share a game, ask for a player or post an update."} />
      ) : items.map((p) => only.includes("match") ? <EventCard key={p.id} p={p} /> : (
        <CommunityFeedItem key={p.id} p={p}
          onVote={com.my_role ? (i) => void act(() => api(`/communities/${com.id}/posts/${p.id}/vote`, { method: "POST", body: { option: i } }), "Vote recorded") : undefined}
          onMore={() => { setFocus(p); sheet.current?.present(); }} />
      ))}
      <FilterBottomSheet ref={sheet} title="Post options" snap={["40%"]}>
        {focus ? (
          <View style={{ gap: SP.sm }}>
            {focus.can_remove ? <Button title={focus.author.id === user?.id ? "Delete my post" : "Remove post (moderator)"} variant="danger" onPress={() => void act(() => api(`/communities/${com.id}/posts/${focus.id}`, { method: "DELETE" }), "Post removed")} /> : null}
            {focus.author.id !== user?.id ? (
              <>
                <Button title="Report post" variant="secondary" onPress={() => { sheet.current?.dismiss(); setReporting(true); }} />
                <Button title={`Block ${focus.author.full_name}`} variant="secondary" onPress={() => void act(() => api(`/users/${focus.author.id}/block`, { method: "POST" }), "Blocked. You won't see their posts.")} />
              </>
            ) : null}
          </View>
        ) : null}
      </FilterBottomSheet>
      <PromptModal visible={reporting} title="Report this post" body="Moderators review reports. Posts reported by several members are hidden until reviewed." placeholder="What's wrong with it?" minLength={3} confirm="Report"
        onCancel={() => setReporting(false)} onSubmit={(reason) => { setReporting(false); if (focus) void act(() => api(`/communities/${com.id}/posts/${focus.id}/report`, { method: "POST", body: { reason } }), "Thanks, moderators will review it."); }} />
    </View>
  );
}

function EventCard({ p }: { p: Post }) {
  const at = p.event_at ?? p.created_at;
  const d = new Date(at);
  return (
    <Card style={{ flexDirection: "row", gap: 14, alignItems: "center" }}>
      <View style={{ width: 52, alignItems: "center" }}>
        <Txt v="micro" color={T.primaryDark}>{d.toLocaleDateString("en-IN", { month: "short", timeZone: "Asia/Kolkata" })}</Txt>
        <Txt v="display" style={{ fontSize: 26, lineHeight: 30 }}>{d.toLocaleDateString("en-IN", { day: "2-digit", timeZone: "Asia/Kolkata" })}</Txt>
      </View>
      <View style={{ width: 1, alignSelf: "stretch", backgroundColor: T.line }} />
      <View style={{ flex: 1, gap: 3 }}>
        <Txt v="h3" numberOfLines={2}>{p.body}</Txt>
        <Txt v="small" color={T.muted}>{p.event_at ? when(p.event_at, { weekday: "short", hour: "numeric", minute: "2-digit" }) : `Posted ${when(p.created_at, { day: "numeric", month: "short" })}`} · {p.type === "tournament" ? "Tournament" : "Match"}</Txt>
        <Txt v="small" color={T.faint}>By {p.author.full_name}</Txt>
      </View>
    </Card>
  );
}

function Members({ com }: { com: Community }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<"active" | "pending">("active");
  const q = useQuery({ queryKey: ["community", com.id, "members", status], queryFn: () => api<S<"CommunityMemberOut">[]>(`/communities/${com.id}/members`, { query: { status } }) });
  const [focus, setFocus] = useState<S<"CommunityMemberOut"> | null>(null);
  const sheet = useRef<BottomSheetModal>(null);
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); sheet.current?.dismiss(); void qc.invalidateQueries({ queryKey: ["community", com.id] }); } catch (e) { Alert.alert("Couldn't do that", errorText(e)); }
  };
  const rank: Record<string, number> = { owner: 4, admin: 3, moderator: 2, member: 1 };
  const myRank = rank[com.my_role ?? ""] ?? 0;
  return (
    <View style={{ gap: SP.md }}>
      {com.can_moderate ? <Segmented value={status} onChange={setStatus} options={[{ v: "active", l: "Members" }, { v: "pending", l: "Requests" }]} /> : null}
      {q.isPending ? <LoadingSkeleton rows={4} /> : q.isError ? <ErrorBox error={q.error} /> : !q.data.length ? <EmptyState title={status === "pending" ? "No pending requests" : "No members"} /> : q.data.map((m) => (
        <Card key={m.user.id} onPress={() => (status === "active" && myRank > (rank[m.role] ?? 0) ? (setFocus(m), sheet.current?.present()) : router.push({ pathname: "/player/[id]", params: { id: m.user.id } }))} label={m.user.full_name}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Avatar uri={m.user.profile_image} name={m.user.full_name} size={40} />
            <Txt v="h3" style={{ flex: 1 }}>{m.user.full_name}</Txt>
            {m.role !== "member" ? <Badge status={m.role === "owner" ? "lime" : "info"} label={m.role} /> : null}
          </View>
          {status === "pending" ? (
            <View style={{ flexDirection: "row", gap: SP.sm }}>
              <Button title="Approve" size="sm" onPress={() => void act(() => api(`/communities/${com.id}/members/${m.user.id}/approve`, { method: "POST" }))} style={{ flex: 1 }} />
              <Button title="Decline" size="sm" variant="secondary" onPress={() => void act(() => api(`/communities/${com.id}/members/${m.user.id}/decline`, { method: "POST" }))} style={{ flex: 1 }} />
            </View>
          ) : null}
        </Card>
      ))}
      <FilterBottomSheet ref={sheet} title={focus?.user.full_name ?? ""} snap={["55%"]}>
        {focus ? (
          <View style={{ gap: SP.sm }}>
            <Button title="View profile" variant="secondary" onPress={() => { sheet.current?.dismiss(); router.push({ pathname: "/player/[id]", params: { id: focus.user.id } }); }} />
            {com.can_admin && focus.role === "member" ? <Button title="Make moderator" variant="secondary" onPress={() => void act(() => api(`/communities/${com.id}/members/${focus.user.id}/role`, { method: "PUT", body: { role: "moderator" } }))} /> : null}
            {com.my_role === "owner" && focus.role !== "admin" ? <Button title="Make admin" variant="secondary" onPress={() => void act(() => api(`/communities/${com.id}/members/${focus.user.id}/role`, { method: "PUT", body: { role: "admin" } }))} /> : null}
            {com.can_admin && focus.role !== "member" && (focus.role !== "admin" || com.my_role === "owner") ? <Button title="Make regular member" variant="secondary" onPress={() => void act(() => api(`/communities/${com.id}/members/${focus.user.id}/role`, { method: "PUT", body: { role: "member" } }))} /> : null}
            <Button title="Remove from community" variant="danger" onPress={() => void act(() => api(`/communities/${com.id}/members/${focus.user.id}`, { method: "DELETE" }))} />
            {com.can_admin ? <Button title="Ban" variant="danger" onPress={() => void act(() => api(`/communities/${com.id}/members/${focus.user.id}`, { method: "DELETE", query: { ban: true } }))} /> : null}
          </View>
        ) : null}
      </FilterBottomSheet>
    </View>
  );
}

function Teams({ com }: { com: Community }) {
  const qc = useQueryClient();
  const myTeam = useManagedTeam();
  const q = useQuery({ queryKey: ["community", com.id, "teams"], queryFn: () => api<S<"CommunityTeamOut">[]>(`/communities/${com.id}/teams`) });
  const add = useMutation({
    mutationFn: () => api(`/communities/${com.id}/teams`, { method: "POST", body: { team_id: myTeam } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["community", com.id] }),
    onError: (e) => Alert.alert("Couldn't add team", errorText(e)),
  });
  const listed = (q.data ?? []).some((t) => t.team.id === myTeam);
  return (
    <View style={{ gap: SP.md }}>
      {com.my_role && myTeam && !listed ? <Button title="Add my team" variant="lime" loading={add.isPending} onPress={() => add.mutate()} /> : null}
      {q.isPending ? <LoadingSkeleton rows={3} /> : q.isError ? <ErrorBox error={q.error} /> : !q.data.length ? <EmptyState title="No teams yet" body="Captains can add their team to the community." /> : q.data.map((t) => (
        <Card key={t.team.id} onPress={() => router.push({ pathname: "/team/[id]", params: { id: t.team.id } })} label={t.team.team_name}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <TeamLogo team={t.team} />
            <View style={{ flex: 1 }}><Txt v="h3">{t.team.team_name}</Txt><Txt v="small" color={T.muted}>{t.team.area} · {t.team.matches} verified matches</Txt></View>
            {t.status === "pending" ? (
              com.can_moderate ? <Button title="Approve" size="sm" onPress={async () => { await api(`/communities/${com.id}/teams/${t.team.id}/approve`, { method: "POST" }); void q.refetch(); }} /> : <Badge status="warning" label="Pending" />
            ) : <Txt v="number">{t.team.rating ? rating(t.team.rating.rating) : "—"}</Txt>}
          </View>
        </Card>
      ))}
    </View>
  );
}

function Rankings({ id }: { id: string }) {
  const { user } = useAuth();
  const q = useQuery({ queryKey: ["community", id, "lb"], queryFn: () => api<S<"CommunityLeaderboardOut">>(`/communities/${id}/leaderboard`) });
  if (q.isPending) return <LoadingSkeleton rows={4} />;
  if (q.isError) return <ErrorBox error={q.error} />;
  if (!q.data.players.length && !q.data.teams.length) return <EmptyState title="No verified matches yet" body="Rankings fill in as members play verified team matches." />;
  return (
    <View style={{ gap: SP.md }}>
      <Txt v="label" color={T.muted}>Top members</Txt>
      {q.data.players.map((e) => <PlayerLeaderboardCard key={e.user.id} e={e} me={e.user.id === user?.id} onPress={() => router.push({ pathname: "/player/[id]", params: { id: e.user.id } })} />)}
      {q.data.teams.length ? <Txt v="label" color={T.muted} style={{ marginTop: SP.md }}>Community teams</Txt> : null}
      {q.data.teams.map((t, i) => (
        <Card key={t.id} onPress={() => router.push({ pathname: "/team/[id]", params: { id: t.id } })} label={t.team_name}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <Txt v="number" style={{ width: 24 }}>{i + 1}</Txt>
            <TeamLogo team={t} size={38} />
            <Txt v="h3" style={{ flex: 1 }}>{t.team_name}</Txt>
            <Txt v="number">{t.rating ? rating(t.rating.rating) : "—"}</Txt>
          </View>
        </Card>
      ))}
    </View>
  );
}
