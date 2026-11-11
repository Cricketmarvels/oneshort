import { useState } from "react";
/** GoFindr domain components (aqua/teal system): game cards, ranked rows, team/community cards, feed items. */
import { formatPaise, type S } from "@cm/shared";
import { router } from "expo-router";
import { Check, Crown, MapPin, MoreHorizontal, MoreVertical, Swords } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

import { initialsOf, kitFor, TeamBanner, TeamCrest } from "@/components/art";
import { Avatar, Badge, Button, Chip, DateBlock, Row, Txt } from "@/components/ui";
import { CHALLENGE_LABEL, formatLabel, overs, rating, roleLabel, when } from "@/lib/format";
import { PLACES, RADII, useLocation } from "@/lib/location";
import type { Challenge, Community, Fixture, PlayerEntry, Post, RatingBrief, TeamBrief, TeamEntry } from "@/lib/types";
import { FW, ICON, R, shadow, SIZE, SP, T } from "@/theme";

const NUM = { fontVariant: ["tabular-nums" as const] };

// ---------------------------------------------------------------- small text badges
export function SkillBadge({ role }: { role?: string | null; dark?: boolean }) {
  return <Txt v="small" color={T.muted}>{roleLabel(role)}</Txt>;
}

export function RatingConfidenceBadge({ r }: { r: Pick<RatingBrief, "confidence" | "provisional"> | null | undefined; dark?: boolean }) {
  if (!r) return <Txt v="small" color={T.muted}>Unrated</Txt>;
  return <Txt v="small" color={T.muted} style={NUM}>{r.provisional ? "Provisional" : "Verified"} · {Math.round(r.confidence * 100)}% confidence</Txt>;
}

export function ChallengeStatusBadge({ status }: { status: string }) {
  const active = ["pending", "accepted", "counter_proposed", "confirmed"].includes(status);
  return <Badge status={active ? "brand" : "neutral"} label={CHALLENGE_LABEL[status] ?? status} />;
}

export function DemoBanner({ show }: { show?: boolean; dark?: boolean }) {
  if (!show) return null;
  return <Txt v="small" color={T.muted} style={{ fontSize: 12 }}>Includes demo matches for testing. Real rankings use captain-verified results only.</Txt>;
}

// ---------------------------------------------------------------- location
export function LocationSelector({ onPress }: { onPress: () => void; dark?: boolean }) {
  const { label, radius } = useLocation();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Location: ${label}, ${radius} km. Change`} onPress={onPress} hitSlop={8} style={{ alignSelf: "flex-start", minHeight: 28, justifyContent: "center" }}>
      <Txt v="small" color={T.muted} style={{ fontSize: 14 }}>{label} · {radius} km ⌄</Txt>
    </Pressable>
  );
}

/** Sheet content: distance, current location, or a named area. */
export function LocationOptions({ onDone }: { onDone: () => void }) {
  const { pick, useDevice, label, radius, setRadius, source } = useLocation();
  const [locating, setLocating] = useState(false);
  const [locErr, setLocErr] = useState<string | null>(null);
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 8 }}>
        <Txt v="label" color={T.muted}>Distance</Txt>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>{RADII.map((r) => <Chip key={r} label={`${r} km`} active={radius === r} onPress={() => setRadius(r)} />)}</View>
      </View>
      <View>
        <Txt v="label" color={T.muted}>Search near</Txt>
        <Row onPress={async () => { setLocating(true); const r = await useDevice(); setLocating(false); if (r === true) onDone(); else setLocErr(r); }} label="Use my current location">
          <MapPin size={18} color={T.accent} strokeWidth={ICON.stroke} /><Txt v="body" color={T.accent} style={{ flex: 1 }}>{locating ? "Finding you…" : source === "device" ? `Current location: ${label}` : "Use my current location"}</Txt>
          {source === "device" ? <Check size={18} color={T.accent} strokeWidth={ICON.navActive} /> : null}
        </Row>
        {locErr ? <Txt v="small" color={T.dangerText} style={{ paddingVertical: 6 }} accessibilityLiveRegion="polite">{locErr}</Txt> : null}
        {PLACES.map((p, i) => (
          <Row key={p.label} onPress={() => { pick(p); onDone(); }} label={p.label} last={i === PLACES.length - 1}>
            <Txt v="body" style={{ flex: 1 }}>{p.label}</Txt>
            {label === p.label ? <Check size={18} color={T.accent} strokeWidth={ICON.navActive} /> : null}
          </Row>
        ))}
      </View>
      <Txt v="small" color={T.muted} style={{ fontSize: 12 }}>Your coordinates only measure distance. Others see approximate distance, never your location.</Txt>
    </View>
  );
}

// ---------------------------------------------------------------- leaderboard
function Delta({ value }: { value: number | null | undefined }) {
  if (value == null) return <Txt v="small" color={T.faint} style={{ fontSize: 12 }}>New</Txt>;
  if (value === 0) return <Txt v="small" color={T.faint} style={{ fontSize: 12 }}>–</Txt>;
  return <Txt v="smallSemi" color={value > 0 ? T.up : T.down} style={[{ fontSize: 12 }, NUM]} accessibilityLabel={`${value > 0 ? "Up" : "Down"} ${Math.abs(value)} places`}>{value > 0 ? "▲" : "▼"} {Math.abs(value)}</Txt>;
}

function Rank({ n }: { n: number }) {
  const top = n <= 3;
  return (
    <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: top ? T.tint : "transparent" }}>
      <Txt v="smallSemi" color={top ? T.primaryDark : T.muted} style={[{ fontSize: 13.5 }, NUM]}>{n}</Txt>
    </View>
  );
}

/** Top three (reference "Local leaderboard"): #1 centred on a raised soft-lime card with a gold crown; #2/#3 either side. */
export function Podium({ top, onPress }: { top: PlayerEntry[]; onPress: (e: PlayerEntry) => void }) {
  const [first, second, third] = top;
  const crown = ["#E2B93B", "#AEB8BE", "#D9925B"];
  const col = (e: PlayerEntry | undefined, place: 1 | 2 | 3) => e ? (
    <Pressable key={e.user.id} accessibilityRole="button" accessibilityLabel={`Rank ${e.rank}, ${e.user.full_name}, rating ${Math.round(e.rating)}`} onPress={() => onPress(e)}
      style={({ pressed }) => [{ flex: place === 1 ? 1.2 : 1, alignItems: "center", gap: 4, paddingTop: place === 1 ? 14 : 30, paddingBottom: 14, paddingHorizontal: 6, borderRadius: R.card,
        backgroundColor: place === 1 ? T.primarySoft : pressed ? T.surface2 : "transparent", marginTop: place === 1 ? 0 : 18 }]}>
      <Crown size={place === 1 ? 24 : 18} color={crown[place - 1]} fill={crown[place - 1]} strokeWidth={1.6} />
      <View style={{ borderRadius: 60, borderWidth: 3, borderColor: place === 1 ? T.limeAccent : T.surface, ...shadow(1) }}>
        <Avatar uri={e.user.profile_image} name={e.user.full_name} size={place === 1 ? 72 : 56} />
      </View>
      <Txt v={place === 1 ? "h3" : "smallSemi"} numberOfLines={1} style={{ maxWidth: "100%", marginTop: 4 }}>{e.user.full_name}</Txt>
      <Txt v="stat" style={{ fontSize: place === 1 ? 22 : 17, lineHeight: place === 1 ? 26 : 21 }}>{rating(e.rating)}</Txt>
    </Pressable>
  ) : <View style={{ flex: 1 }} />;
  return <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 4 }}>{col(second, 2)}{col(first, 1)}{col(third, 3)}</View>;
}

export function PlayerLeaderboardCard({ e, me, onPress, onMore, last }: { e: PlayerEntry; me?: boolean; onPress: () => void; onMore?: () => void; last?: boolean }) {
  const isScore = e.rating_label === "Consistency" || e.rating_label.startsWith("Gain");
  return (
    <Row onPress={onPress} last={last} height={62} label={`Rank ${e.rank}, ${e.user.full_name}, ${Math.round(e.rating)}`} style={me ? { backgroundColor: T.tint, marginHorizontal: -SP.lg, paddingHorizontal: SP.lg } : undefined}>
      <Rank n={e.rank} />
      <Avatar uri={e.user.profile_image} name={e.user.full_name} size={SIZE.avatarSm} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="h3" numberOfLines={1}>{e.user.full_name}{me ? " (you)" : ""}</Txt>
        <Txt v="small" color={T.muted} numberOfLines={1}>{[roleLabel(e.primary_role), e.distance_km != null ? `~${e.distance_km} km` : e.locality ?? e.user.city].filter(Boolean).join(" · ")}{e.provisional ? <Txt v="small" color={T.warningText}> · provisional</Txt> : null}</Txt>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Txt v="number" style={{ fontSize: 16 }}>{isScore ? `${e.rating_label.startsWith("Gain") ? "+" : ""}${Math.round(e.rating)}` : rating(e.rating)}</Txt>
        <Delta value={e.movement} />
      </View>
      {onMore ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`More actions for ${e.user.full_name}`} onPress={onMore} hitSlop={10} style={{ width: 28, height: SIZE.touch, alignItems: "flex-end", justifyContent: "center" }}>
          <MoreVertical size={18} color={T.muted} strokeWidth={ICON.stroke} />
        </Pressable>
      ) : null}
    </Row>
  );
}

export function TeamLogo({ team, size = 40 }: { team: Pick<TeamBrief, "team_name" | "logo">; size?: number }) {
  return <TeamCrest name={team.team_name} size={size} />;
}

/** League-table row: rank, crest + name, W/L · win % · form, rating + movement. */
export function TeamLeaderboardCard({ e, onPress, onChallenge, last }: { e: TeamEntry; onPress: () => void; onChallenge?: () => void; last?: boolean }) {
  const played = e.won + e.lost + (e.tied ?? 0);
  const pct = played ? Math.round((e.won / played) * 100) : null;
  return (
    <Row onPress={onPress} last={last} height={66} label={`Rank ${e.rank}, ${e.team.team_name}, rating ${Math.round(e.rating)}`}>
      <Rank n={e.rank} />
      <TeamCrest name={e.team.team_name} size={38} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Txt v="h3" numberOfLines={1}>{e.team.team_name}</Txt>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Txt v="small" color={T.muted} style={NUM} numberOfLines={1}>{e.won}W {e.lost}L{pct != null ? ` · ${pct}%` : ""}</Txt>
          <Form form={e.form.slice(-5)} />
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Txt v="number" style={{ fontSize: 16 }}>{rating(e.rating)}</Txt>
        <Delta value={e.movement} />
      </View>
      {onChallenge ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`Challenge ${e.team.team_name}`} onPress={onChallenge} hitSlop={6} style={{ width: 30, minHeight: SIZE.touch, alignItems: "flex-end", justifyContent: "center" }}>
          <Swords size={18} color={T.primaryDark} strokeWidth={ICON.stroke} />
        </Pressable>
      ) : null}
    </Row>
  );
}

function Form({ form }: { form: string[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 2 }} accessibilityLabel={`Recent form ${form.join(" ")}`}>
      {form.map((r, i) => <View key={i} style={{ width: 14, height: 14, borderRadius: 4, alignItems: "center", justifyContent: "center", backgroundColor: r === "W" ? T.successBackground : r === "L" ? T.dangerBackground : T.surface2 }}>
        <Text style={{ ...FW.bold, fontSize: 8.5, color: r === "W" ? T.successText : r === "L" ? T.dangerText : T.muted }}>{r}</Text>
      </View>)}
    </View>
  );
}

// ---------------------------------------------------------------- matches & challenges
function vs(a: TeamBrief, b: TeamBrief) {
  return `${a.team_name} vs ${b.team_name}`;
}

type Tone = "success" | "warning" | "danger" | "info" | "neutral";
/** The "Your games" card: date block, title, opponent line, format · time · venue, people, status chip, overflow. */
/** Overlapping coloured initials circles (teams or people) with an optional "+N". */
export function PeopleStack({ names, team, extra = 0, extraLabel }: { names: string[]; team?: boolean; extra?: number; extraLabel?: string }) {
  const size = 32;
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }} accessibilityLabel={extraLabel ?? names.join(", ")}>
      {names.slice(0, 3).map((n, i) => {
        const [strong, soft] = kitFor(n);
        const ini = team ? initialsOf(n) : n.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
        return (
          <View key={n + i} style={{ marginLeft: i ? -9 : 0, width: size + 4, height: size + 4, borderRadius: (size + 4) / 2, borderWidth: 2, borderColor: T.surface, backgroundColor: soft, alignItems: "center", justifyContent: "center" }}>
            <Text style={{ ...FW.semibold, fontSize: ini.length > 2 ? 9.5 : 11, color: strong }}>{ini}</Text>
          </View>
        );
      })}
      {extra > 0 ? (
        <View style={{ marginLeft: -9, minWidth: size + 4, height: size + 4, paddingHorizontal: 4, borderRadius: (size + 4) / 2, borderWidth: 2, borderColor: T.surface, backgroundColor: T.successBackground, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ ...FW.semibold, fontSize: 11, color: T.successText }}>+{extra}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** The "Your games" card (reference "Cool 1 · Aqua"): date column | divider | title + meta + ··· ; full-width people row with a status chip.
 *  `highlight` adds the teal accent edge (used for the next game). */
export function GameCard({ iso, title, meta, people, crests, extra, extraLabel, status, onPress, onMore, action, highlight }: {
  iso: string; title: string; sub?: string; meta: string; people?: string[]; crests?: string[]; extra?: number; extraLabel?: string; status?: { label: string; tone: Tone }; onPress: () => void; onMore?: () => void; action?: ReactNode; highlight?: boolean;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${meta}${status ? `. ${status.label}` : ""}`} onPress={onPress}
      style={({ pressed }) => [{ paddingVertical: 16, paddingLeft: highlight ? 18 : 16, paddingRight: 14, gap: 14, borderRadius: 22, overflow: "hidden", backgroundColor: pressed ? T.surface2 : T.surface }, shadow(2)]}>
      {highlight ? <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 4, backgroundColor: T.primary }} /> : null}
      <View style={{ flexDirection: "row", alignItems: "stretch", gap: 14 }}>
        <DateBlock iso={iso} />
        <View style={{ width: 1, backgroundColor: T.line }} />
        <View style={{ flex: 1, minWidth: 0, gap: 3, justifyContent: "center" }}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
            <Txt v="h3" numberOfLines={2} style={{ flex: 1, fontSize: 16, lineHeight: 21 }}>{title}</Txt>
            {onMore ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`More actions for ${title}`} onPress={onMore} hitSlop={12} style={{ width: 28, height: 22, marginRight: -4, alignItems: "center", justifyContent: "center" }}>
                <MoreHorizontal size={18} color={T.faint} strokeWidth={2} />
              </Pressable>
            ) : null}
          </View>
          <Txt v="small" color={T.muted} numberOfLines={1} style={{ fontSize: 13.5 }}>{meta}</Txt>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        {crests?.length ? <PeopleStack names={crests} team extra={extra} extraLabel={extraLabel} /> : people?.length ? <PeopleStack names={people} extra={extra} extraLabel={extraLabel} /> : <View />}
        {action ?? (status ? <StatusPill status={status} /> : null)}
      </View>
    </Pressable>
  );
}

/** Rounder, slightly larger status chip used on game cards. */
function StatusPill({ status }: { status: { label: string; tone: Tone } }) {
  const tone = { success: [T.successBackground, T.successText], warning: [T.warningBackground, T.warningText], danger: [T.dangerBackground, T.dangerText], info: [T.tint, T.primaryDark], neutral: [T.surface2, T.muted] }[status.tone];
  return (
    <View style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: R.pill, backgroundColor: tone[0] }}>
      <Txt v="smallSemi" color={tone[1]} style={{ fontSize: 13 }}>{status.label}</Txt>
    </View>
  );
}

export function fixtureStatus(f: Fixture): { label: string; tone: Tone } {
  const r = f.result;
  if (f.actions.includes("verify")) return { label: "Verify result", tone: "warning" };
  if (f.actions.includes("submit_result")) return { label: "Add result", tone: "warning" };
  if (f.status === "cancelled") return { label: "Cancelled", tone: "neutral" };
  if (r?.status === "submitted") return { label: "Pending verification", tone: "warning" };
  if (r?.status === "disputed") return { label: "Disputed", tone: "danger" };
  if (r?.status === "voided") return { label: "Voided", tone: "neutral" };
  if (r?.status === "confirmed" || f.status === "completed") return { label: "Completed", tone: "success" };
  return { label: "Confirmed", tone: "info" };
}

export function MatchCard({ f, onPress, onMore, highlight }: { f: Fixture; onPress?: () => void; onMore?: () => void; last?: boolean; highlight?: boolean }) {
  const r = f.result;
  const time = when(f.start_at, { hour: "numeric", minute: "2-digit" });
  const score = r && r.innings.length ? r.innings.map((i) => `${i.runs}/${i.wickets} (${overs(i.balls)})`).join(" · ") : null;
  return (
    <GameCard iso={f.start_at} title={vs(f.home_team, f.away_team)} highlight={highlight}
      meta={r ? `${r.summary}${score ? ` · ${score}` : ""}` : `${formatLabel(f.format)} · ${time} · ${f.venue.name}${f.is_demo ? " · demo" : ""}`}
      crests={[f.home_team.team_name, f.away_team.team_name]} status={fixtureStatus(f)}
      onPress={onPress ?? (() => router.push(`/fixture/${f.id}`))} onMore={onMore} />
  );
}
export const MatchScheduleCard = MatchCard;

export const CHALLENGE_TONES: Record<string, Tone> = { draft: "neutral", pending: "warning", accepted: "info", counter_proposed: "warning", confirmed: "success", rejected: "danger", cancelled: "neutral", completed: "success" };

export function TeamChallengeCard({ c, onPress, last }: { c: Challenge; onPress?: () => void; last?: boolean }) {
  const waitingOnMe = c.actions.some((a) => a !== "cancel");
  const other = c.my_side === "from" ? c.to_team : c.from_team;
  return (
    <Row onPress={onPress ?? (() => router.push(`/challenge/${c.id}`))} last={last} height={SIZE.rowPerson} label={`Challenge ${vs(c.from_team, c.to_team)}`}>
      <TeamCrest name={other.team_name} size={40} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Txt v="h3" numberOfLines={1}>{c.my_side === "to" ? `${other.team_name} challenged you` : c.my_side === "from" ? `You challenged ${other.team_name}` : vs(c.from_team, c.to_team)}</Txt>
        <Txt v="small" color={T.muted} numberOfLines={1}>{when(c.proposal.start_at, { weekday: "short", day: "numeric", month: "short" })} · {formatLabel(c.proposal.format)}</Txt>
      </View>
      <Badge status={waitingOnMe ? "warning" : CHALLENGE_TONES[c.status] ?? "neutral"} label={waitingOnMe ? "Your move" : CHALLENGE_LABEL[c.status] ?? c.status} />
    </Row>
  );
}

export function HeadToHeadCard({ h }: { h: { team_a: TeamBrief; team_b: TeamBrief; played: number; a_wins: number; b_wins: number; tied: number } }) {
  return (
    <Row height={60}>
      <TeamCrest name={h.team_b.team_name} size={36} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v="h3" numberOfLines={1}>vs {h.team_b.team_name}</Txt>
        <Txt v="small" color={T.muted} style={NUM}>{h.played} played · {h.a_wins} won · {h.b_wins} lost{h.tied ? ` · ${h.tied} tied` : ""}</Txt>
      </View>
    </Row>
  );
}

// ---------------------------------------------------------------- community
export const coverFor = (_id: string) => "stadium" as const;

export function CommunityCard({ c }: { c: Community; compact?: boolean; cover?: number; last?: boolean }) {
  const status = c.my_role ? (c.my_role === "member" ? "Joined" : c.my_role.charAt(0).toUpperCase() + c.my_role.slice(1)) : c.my_status === "pending" ? "Requested" : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.member_count} members`} onPress={() => router.push(`/community/${c.id}`)}
      style={({ pressed }) => [{ borderRadius: R.card, backgroundColor: pressed ? T.surface2 : T.surface, borderWidth: 1, borderColor: T.line, overflow: "hidden" }, shadow(1)]}>
      <TeamBanner name={c.name} height={36} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
        <TeamCrest name={c.name} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Txt v="h3" numberOfLines={1}>{c.name}</Txt>
          <Txt v="small" color={T.muted} numberOfLines={1}>{[c.area ?? c.city, `${c.member_count} members`, c.distance_km != null ? `~${c.distance_km} km` : null].filter(Boolean).join(" · ")}</Txt>
        </View>
        {status ? <Badge status={status === "Requested" ? "warning" : "success"} label={status} /> : <Badge status="info" label={c.visibility === "private" ? "Request to join" : "Join"} />}
      </View>
    </Pressable>
  );
}

export function CommunityFeedItem({ p, community, onVote, onMore }: { p: Post; community?: string; onVote?: (i: number) => void; onMore?: () => void }) {
  const totalVotes = p.poll?.reduce((a, o) => a + o.votes, 0) ?? 0;
  const tag: Record<string, string> = { announcement: "Announcement", poll: "Poll", match: "Match", tournament: "Tournament" };
  return (
    <View style={[{ padding: SP.lg, gap: 10, borderRadius: R.card, backgroundColor: T.surface, borderWidth: 1, borderColor: T.line }, shadow(1)]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar uri={p.author.profile_image} name={p.author.full_name} size={SIZE.avatarSm} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Txt v="bodyMed" numberOfLines={1} style={{ fontSize: 14 }}>{p.author.full_name}{p.author_role && p.author_role !== "member" ? <Txt v="small" color={T.muted}> · {p.author_role}</Txt> : null}</Txt>
          <Txt v="small" color={T.muted} numberOfLines={1}>{[tag[p.type], community, when(p.created_at, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })].filter(Boolean).join(" · ")}</Txt>
        </View>
        {onMore ? <Pressable accessibilityRole="button" accessibilityLabel="Post actions" onPress={onMore} hitSlop={10} style={{ width: SIZE.touch, height: SIZE.touch, alignItems: "flex-end", justifyContent: "center" }}><MoreHorizontal size={18} color={T.muted} strokeWidth={ICON.stroke} /></Pressable> : null}
      </View>
      <Txt v="body">{p.body}</Txt>
      {p.poll ? (
        <View style={{ gap: 6 }}>
          {p.poll.map((o, i) => {
            const share = totalVotes ? o.votes / totalVotes : 0;
            const mine = p.my_vote === i;
            return (
              <Pressable key={i} accessibilityRole="button" accessibilityLabel={`Vote ${o.text}`} disabled={p.my_vote != null || !onVote} onPress={() => onVote?.(i)}
                style={{ minHeight: SIZE.touch, borderRadius: 12, overflow: "hidden", backgroundColor: T.surface, justifyContent: "center" }}>
                <View style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${Math.round(share * 100)}%`, backgroundColor: p.my_vote != null ? T.tint : "transparent" }} />
                <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 14 }}>
                  <Txt v="body" color={mine ? T.accent : T.ink} style={{ fontSize: 14 }}>{o.text}</Txt>
                  {p.my_vote != null ? <Txt v="small" color={T.muted} style={NUM}>{Math.round(share * 100)}%</Txt> : null}
                </View>
              </Pressable>
            );
          })}
          <Txt v="small" color={T.muted} style={{ fontSize: 12 }}>{totalVotes} vote{totalVotes === 1 ? "" : "s"}</Txt>
        </View>
      ) : null}
      {p.report_count ? <Txt v="small" color={T.down}>{p.report_count} report{p.report_count === 1 ? "" : "s"}: review this post</Txt> : null}
    </View>
  );
}

// ---------------------------------------------------------------- notifications
export function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : when(iso, { day: "numeric", month: "short" });
}

export function NotificationItem({ title, body, at, unread, icon, onPress, last, tone }: { title: string; body: string; at: string; unread: boolean; icon?: ReactNode; onPress?: () => void; last?: boolean; tone?: string }) {
  return (
    <Row onPress={onPress} last={last} height={SIZE.rowPerson} label={`${unread ? "Unread. " : ""}${title}. ${body}`} style={{ alignItems: "flex-start", paddingVertical: 14 }}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: tone ?? (unread ? T.tint : T.surface2), alignItems: "center", justifyContent: "center" }}>{icon}</View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt v={unread ? "h3" : "bodyMed"} style={{ fontSize: 14.5 }}>{title}</Txt>
        <Txt v="small" color={T.muted}>{body}</Txt>
      </View>
      <View style={{ alignItems: "flex-end", gap: 8, minWidth: 54 }}>
        <Txt v="small" color={T.faint} style={{ fontSize: 11.5 }}>{ago(at)}</Txt>
        {unread ? <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: T.primary }} accessibilityLabel="Unread" /> : null}
      </View>
    </Row>
  );
}

// ---------------------------------------------------------------- open pickup match
export function OpenMatchCard({ o, joining, onJoin }: { o: S<"OpportunityOut">; i?: number; width?: number; joining?: boolean; onJoin: () => void; last?: boolean }) {
  return (
    <GameCard iso={o.start_at} title={`${o.team.team_name} · open match`}
      meta={`${o.format} · ~${o.approx_distance_km} km · ${o.squad_capacity - o.vacancies} players in${o.per_head_fee_paise ? ` · ~${formatPaise(o.per_head_fee_paise)} each` : ""}`}
      crests={[o.team.team_name]} extra={o.squad_capacity - o.vacancies} extraLabel={`${o.squad_capacity - o.vacancies} players in`} onPress={() => router.push(`/match/${o.match_id}`)}
      action={o.my_status ? <Badge status="warning" label="Requested" /> : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Badge status="success" label={`${o.vacancies} spot${o.vacancies === 1 ? "" : "s"} open`} />
          <Button title={joining ? "Sending…" : "Join"} size="sm" variant="secondary" onPress={onJoin} style={{ minHeight: 34, paddingHorizontal: 12 }} />
        </View>
      )} />
  );
}

