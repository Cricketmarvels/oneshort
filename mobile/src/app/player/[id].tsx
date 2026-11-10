import { useQuery } from "@tanstack/react-query";
import { router, Stack, useLocalSearchParams } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useRef, useState } from "react";
import { BadgeCheck, ChevronRight, Info, Sparkles, Swords, UserPlus } from "lucide-react-native";
import { Alert, ScrollView, useWindowDimensions, View } from "react-native";

import { DemoBanner, TeamLogo } from "@/components/cricket";
import { ShareButton } from "@/components/identity";
import { Avatar, Button, Card, ErrorBox, LoadingSkeleton, Section, Stat, Txt, UnderlineTabs } from "@/components/ui";
import { ConfidenceBar, FormBars, FormPills, PlayerPerformanceChart } from "@/components/viz";
import { api, errorText } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { day, formatLabel, rating, roleLabel } from "@/lib/format";
import { useHome, useManagedTeam } from "@/lib/hooks";
import { InviteToMatch } from "@/components/find";
import { AchievementBadge, KickerChip, SectionHeader } from "@/components/refined";
import { FilterBottomSheet } from "@/components/sheet";
import { CricHeroesCard, CricHeroesEditor } from "@/components/cricheroes-link";
import { savePlayerCricHeroes } from "@/lib/cricheroes";
import type { PlayerRating, RatingHistory } from "@/lib/types";
import { R, shadow, SP, T } from "@/theme";

const STYLE: Record<string, string> = {
  right_hand: "Right-hand bat", left_hand: "Left-hand bat", right_arm_fast: "Right-arm fast", right_arm_medium: "Right-arm medium", left_arm_fast: "Left-arm fast",
  left_arm_medium: "Left-arm medium", off_spin: "Off spin", leg_spin: "Leg spin", left_arm_orthodox: "Left-arm orthodox", left_arm_wrist_spin: "Left-arm wrist spin",
};

function DisciplineRow({ label, d }: { label: string; d: PlayerRating["batting"] }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 }}>
      <Txt v="bodyMed" style={{ width: 96 }}>{label}</Txt>
      <View style={{ flex: 1, gap: 5 }}>
        <View style={{ height: 8, borderRadius: 4, backgroundColor: T.track, overflow: "hidden" }}>
          <View style={{ width: `${Math.min(100, Math.max(4, ((d.rating - 1100) / 800) * 100))}%`, height: "100%", borderRadius: 4, backgroundColor: d.matches ? T.ink : T.trackStrong }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <ConfidenceBar value={d.confidence} w={40} />
          <Txt v="small" color={T.muted} style={{ fontSize: 11 }}>{d.matches ? `${d.matches} matches · ±${Math.round(d.rd)}` : "No verified data"}</Txt>
        </View>
      </View>
      <Txt v="number" color={d.matches ? T.text : T.muted}>{d.matches ? rating(d.rating) : "—"}</Txt>
    </View>
  );
}

export default function PlayerProfile() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const myTeam = useManagedTeam();
  const { width } = useWindowDimensions();
  const [disc, setDisc] = useState<"batting" | "bowling" | "fielding">("batting");
  const [showHistory, setShowHistory] = useState(false);
  const inviteSheet = useRef<BottomSheetModal>(null);
  const [chEdit, setChEdit] = useState(false);
  const home = useHome();
  const isCaptain = !!home.data?.managed_team_ids.length;
  const q = useQuery({ queryKey: ["rating", id], queryFn: () => api<PlayerRating>(`/ratings/players/${id}`) });
  const hist = useQuery({ queryKey: ["rating", id, "history"], queryFn: () => api<{ data: RatingHistory[] }>(`/ratings/players/${id}/history`, { query: { page_size: 10 } }) });
  if (q.isPending) return <View style={{ flex: 1, backgroundColor: T.paper, padding: SP.page }}><LoadingSkeleton rows={5} /></View>;
  if (q.isError) return <View style={{ padding: SP.page }}><ErrorBox error={q.error} onRetry={() => void q.refetch()} /></View>;
  const p = q.data;
  const me = user?.id === p.user.id;
  const c = p.career;
  const invite = async () => {
    try { await api(`/teams/${myTeam}/members`, { method: "POST", body: { user_id: p.user.id } }); Alert.alert("Invitation sent"); }
    catch (e) { Alert.alert("Couldn't invite", errorText(e)); }
  };
  const form = (hist.data?.data ?? []).slice(0, 5).map((h) => (h.result === "won" ? "W" : h.result === "lost" ? "L" : "T"));
  const verified = p.verified_matches > 0 && !p.overall.provisional;
  const stats: Record<typeof disc, [string, string][]> = {
    batting: [[String(c.batting_average ?? "—"), "Avg"], [String(c.runs ?? 0), "Runs"], [String(c.strike_rate ?? "—"), "SR"]],
    bowling: [[String(c.wickets ?? 0), "Wickets"], [String(c.economy ?? "—"), "Economy"], [p.bowling.matches ? rating(p.bowling.rating) : "—", "Rating"]],
    fielding: [[String(c.catches ?? 0), "Catches"], [String(c.run_outs ?? 0), "Run-outs"], [p.fielding.matches ? rating(p.fielding.rating) : "—", "Rating"]],
  };
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ paddingBottom: 60 }}>
      <Stack.Screen options={{ title: "Player Profile", headerTitleAlign: "left", headerRight: () => <ShareButton message={`${p.user.full_name} on GoFindr — ${roleLabel(p.primary_role)}, rating ${p.verified_matches ? rating(p.overall.rating) : "new"}`} /> }} />
      {/* identity (refined spec §5.13) */}
      <View style={{ paddingHorizontal: SP.page, paddingTop: SP.lg, gap: SP.lg }}>
        <View style={{ alignItems: "center", gap: 6 }}>
          <View style={{ borderRadius: 60, borderWidth: 4, borderColor: T.surface, ...shadow(1) }}>
            <Avatar uri={p.user.profile_image} name={p.user.full_name} size={104} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 }}>
            <Txt v="hero" style={{ fontSize: 24 }}>{p.user.full_name}</Txt>
            {verified ? <BadgeCheck size={20} color={T.surface} fill={T.primary} strokeWidth={2} accessibilityLabel="Has verified match history" /> : null}
          </View>
          <Txt v="body" color={T.muted}>{[roleLabel(p.primary_role), p.locality ?? p.user.city].filter(Boolean).join(" · ")}</Txt>
          <KickerChip label="PLAYER PROFILE" />
        </View>
        <View style={{ flexDirection: "row", gap: 10 }}>
          {([
            [String(p.verified_matches), "Verified matches"],
            [p.verified_matches && !p.overall.provisional ? rating(p.overall.rating) : p.verified_matches ? `${rating(p.overall.rating)}*` : "New", p.verified_matches && p.overall.provisional ? "Provisional rating" : "Rating"],
            [p.attendance?.rate != null ? `${Math.round(p.attendance.rate * 100)}%` : "—", p.attendance?.rate != null ? "Attendance" : "Attendance (needs 3 games)"],
          ] as const).map(([v, l]) => (
            <View key={l} style={{ flex: 1, alignItems: "center", gap: 2, paddingVertical: 14, borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }}>
              <Txt v="stat" style={{ fontSize: 21 }}>{v}</Txt>
              <Txt v="small" color={T.muted} style={{ fontSize: 11.5, textAlign: "center" }}>{l}</Txt>
            </View>
          ))}
        </View>
        {p.batting_style || (p.bowling_style && p.bowling_style !== "none") ? (
          <Txt v="small" color={T.muted} style={{ textAlign: "center" }}>Style: {[p.batting_style ? STYLE[p.batting_style] ?? p.batting_style : null, p.bowling_style && p.bowling_style !== "none" ? STYLE[p.bowling_style] ?? p.bowling_style : null].filter(Boolean).join(" · ")}</Txt>
        ) : null}
        {!me && (myTeam || isCaptain) ? (
          <Button title="Invite to a match" size="lg" onPress={() => inviteSheet.current?.present()} />
        ) : null}
        {chEdit && me ? (
          <CricHeroesEditor kind="player" current={p.cricheroes_profile_url} currentStats={p.cricheroes_stats} save={async (u, st) => { await savePlayerCricHeroes(u, st); await q.refetch(); }} onClose={() => setChEdit(false)} />
        ) : (
          <CricHeroesCard kind="player" url={p.cricheroes_profile_url} stats={p.cricheroes_stats} onEdit={me ? () => setChEdit(true) : undefined} />
        )}
        {p.bio ? (
          <View style={{ gap: 6, padding: SP.lg, borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }}>
            <Txt v="h3">About {me ? "me" : p.user.full_name.split(" ")[0]}</Txt>
            <Txt v="body" style={{ lineHeight: 22 }}>{p.bio}</Txt>
          </View>
        ) : null}
        {p.achievements?.length ? (
          <View style={{ gap: SP.sm }}>
            <SectionHeader title="Achievements" action="How they're earned" onAction={() => router.push("/about-ratings")} />
            {(p.achievements ?? []).slice(0, 6).map((a) => <AchievementBadge key={a.id} {...a} />)}
          </View>
        ) : (
          <Txt v="small" color={T.muted} style={{ textAlign: "center" }}>Achievements appear after verified matches and attended games.</Txt>
        )}
        <Card style={{ padding: 0, gap: 0 }}>
          <View style={{ paddingHorizontal: SP.lg }}>
            <UnderlineTabs value={disc} onChange={setDisc} options={[{ v: "batting", l: "Batting" }, { v: "bowling", l: "Bowling" }, { v: "fielding", l: "Fielding" }]} />
          </View>
          <View style={{ flexDirection: "row", paddingVertical: SP.lg }}>
            {stats[disc].map(([v, l]) => (
              <View key={l} style={{ flex: 1, alignItems: "center", gap: 2 }}>
                <Txt v="stat" style={{ fontSize: 21 }}>{v}</Txt>
                <Txt v="small" color={T.muted}>{l}</Txt>
              </View>
            ))}
          </View>
          {!c.matches ? <Txt v="small" color={T.muted} style={{ textAlign: "center", paddingBottom: SP.md }}>Career stats appear after the first verified match.</Txt> : null}
        </Card>
        {form.length ? (
          <Card style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Txt v="h3">Recent form</Txt>
            <FormPills form={form} />
          </Card>
        ) : null}
        <Card onPress={() => setShowHistory(!showHistory)} label="Verified match history" style={{ flexDirection: "row", alignItems: "center" }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Txt v="h3">Verified match history</Txt>
            <Txt v="small" color={T.muted}>{p.verified_matches} matches • {c.runs ?? 0} runs • {c.wickets ?? 0} wickets</Txt>
          </View>
          <ChevronRight size={20} color={T.muted} strokeWidth={2} style={{ transform: [{ rotate: showHistory ? "90deg" : "0deg" }] }} />
        </Card>
        {showHistory ? (
          <View style={{ gap: 10 }}>
            {hist.isPending ? <LoadingSkeleton rows={2} /> : !hist.data?.data.length ? <Txt v="small" color={T.muted}>No verified matches yet.</Txt> : hist.data.data.map((h) => {
              const delta = (h.after.overall ?? 0) - (h.before.overall ?? 0);
              return (
                <Card key={h.fixture_id} onPress={() => router.push({ pathname: "/fixture/[id]", params: { id: h.fixture_id } })} label={`Match against ${h.opponent?.team_name}`}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <FormPills form={[h.result === "won" ? "W" : h.result === "lost" ? "L" : "T"]} size={24} />
                    <Txt v="smallSemi" style={{ flex: 1 }} numberOfLines={1}>vs {h.opponent?.team_name} · {formatLabel(h.format)} · {day(h.at)}</Txt>
                    <Txt v="number" color={delta >= 0 ? T.up : T.down}>{delta >= 0 ? "+" : "−"}{Math.abs(Math.round(delta))}</Txt>
                  </View>
                  {h.reasons.map((r, i) => <Txt key={i} v="small" color={T.muted}>{r}</Txt>)}
                </Card>
              );
            })}
          </View>
        ) : null}
        {!me ? (
          <View style={{ gap: 10 }}>
            {myTeam ? <Button title="Invite to my team" variant="secondary" icon={<UserPlus size={18} color={T.ink} strokeWidth={2} />} onPress={() => void invite()} /> : null}
            {user ? <Button title="Compare with me" variant="secondary" icon={<Swords size={17} color={T.ink} strokeWidth={1.8} />} onPress={() => router.push({ pathname: "/compare", params: { a: user.id, b: p.user.id } })} /> : null}
          </View>
        ) : null}
      </View>

      <View style={{ padding: SP.page, paddingTop: SP.xl, gap: SP.xl }}>
        <DemoBanner show={p.includes_demo_data} />
        <Card style={{ gap: SP.md }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Sparkles size={17} color={T.accent} strokeWidth={1.5} />
            <Txt v="h3" style={{ flex: 1 }}>Why {me ? "your" : "this"} rating moved</Txt>
            <Info size={16} color={T.muted} onPress={() => router.push("/about-ratings")} accessibilityLabel="How ratings work" />
          </View>
          {p.summary.map((line, i) => <Txt key={i} v="small" color={T.text2}>• {line}</Txt>)}
          <Txt v="small" color={T.muted} style={{ fontSize: 11 }}>Built from verified scorecards only. No AI writes these numbers.</Txt>
        </Card>

        <Section title="Skill ratings">
          <Card style={{ gap: 0 }}>
            <DisciplineRow label="Batting" d={p.batting} />
            <DisciplineRow label="Bowling" d={p.bowling} />
            <DisciplineRow label="Fielding" d={p.fielding} />
            <DisciplineRow label="Match impact" d={p.impact} />
            <View style={{ flexDirection: "row", gap: SP.md, marginTop: SP.md }}>
              <Stat label="All-round" value={p.all_rounder_rating ? rating(p.all_rounder_rating) : "—"} />
              <Stat label="Consistency" value={p.consistency != null ? `${Math.round(p.consistency * 100)}` : "—"} />
            </View>
          </Card>
        </Section>

        {p.trend.length > 1 ? (
          <Section title="Rating trend">
            <Card><PlayerPerformanceChart values={p.trend} w={width - SP.lg * 4} /></Card>
          </Section>
        ) : null}

        {p.recent_form.length ? (
          <Section title="Recent form">
            <Card style={{ flexDirection: "row", alignItems: "center", gap: SP.lg }}>
              <FormBars values={p.recent_form} w={170} />
              <Txt v="small" color={T.muted} style={{ flex: 1 }}>Match impact in the last {p.recent_form.length} verified matches. The dashed line is par.</Txt>
            </Card>
          </Section>
        ) : null}

        {Object.keys(p.formats).length ? (
          <Section title="By format">
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {Object.entries(p.formats).map(([f, r]) => (
                <Card key={f} style={{ minWidth: 100, flexGrow: 1 }}>
                  <Txt v="label" color={T.muted}>{formatLabel(f)}</Txt>
                  <Txt v="stat">{rating(r.rating)}</Txt>
                  <Txt v="small" color={r.provisional ? T.warn : T.muted} style={{ fontSize: 11 }}>{r.provisional ? "Provisional" : `${Math.round(r.confidence * 100)}% confidence`}</Txt>
                </Card>
              ))}
            </View>
          </Section>
        ) : null}

        {c.matches ? (
          <Section title="Verified career">
            <Card style={{ gap: SP.lg }}>
              <View style={{ flexDirection: "row", gap: SP.md }}>
                <Stat label="Runs" value={c.runs ?? 0} /><Stat label="Average" value={c.batting_average ?? "—"} /><Stat label="Strike rate" value={c.strike_rate ?? "—"} />
              </View>
              <View style={{ flexDirection: "row", gap: SP.md }}>
                <Stat label="Wickets" value={c.wickets ?? 0} /><Stat label="Economy" value={c.economy ?? "—"} /><Stat label="Catches" value={c.catches ?? 0} />
              </View>
              <View style={{ flexDirection: "row", gap: SP.md }}>
                <Stat label="Highest" value={c.highest ?? 0} /><Stat label="4s / 6s" value={`${c.fours ?? 0}/${c.sixes ?? 0}`} /><Stat label="Run-outs" value={c.run_outs ?? 0} />
              </View>
            </Card>
          </Section>
        ) : null}

        {p.teams.length ? (
          <Section title="Teams">
            {p.teams.map((t) => (
              <Card key={t.id} onPress={() => router.push({ pathname: "/team/[id]", params: { id: t.id } })} label={t.team_name}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <TeamLogo team={t} size={38} />
                  <Txt v="h3" style={{ flex: 1 }}>{t.team_name}</Txt>
                  <Txt v="number">{t.rating ? rating(t.rating.rating) : "—"}</Txt>
                </View>
              </Card>
            ))}
          </Section>
        ) : null}

        <Txt v="small" color={T.muted}>Think a result is wrong? Ask your captain to dispute it from the match page. Disputed results never count.</Txt>
      </View>
      <FilterBottomSheet ref={inviteSheet} title={`Invite ${p.user.full_name.split(" ")[0]} to a match`} snap={["78%"]}>
        <InviteToMatch player={p} onDone={() => inviteSheet.current?.dismiss()} onBack={() => inviteSheet.current?.dismiss()} />
      </FilterBottomSheet>
    </ScrollView>
  );
}
