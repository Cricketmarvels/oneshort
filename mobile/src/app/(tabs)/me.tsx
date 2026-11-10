/** Profile tab (starter v2): avatar, name, role · sport, verified stat strip, and links to everything personal. */
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, View } from "react-native";

import { SportSwitcher } from "@/components/sports";
import { CricHeroesCard, CricHeroesEditor } from "@/components/cricheroes-link";
import { CameraBadge } from "@/components/premium";
import { LinkCard, StarterScreen, StatStrip } from "@/components/starter";
import { savePlayerCricHeroes } from "@/lib/cricheroes";
import { useState } from "react";
import { Avatar, Txt } from "@/components/ui";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useHomeContext } from "@/lib/context";
import { rating, roleLabel } from "@/lib/format";
import { useHome } from "@/lib/hooks";
import { useProfilePhoto } from "@/lib/profile-photo";
import { SPORTS, useSport } from "@/lib/sports";
import { T } from "@/theme";

export default function Me() {
  const { user } = useAuth();
  const { sport } = useSport();
  const home = useHome();
  const ctx = useHomeContext((s) => s.ctx);
  const r = useQuery({ enabled: !!user, queryKey: ["rating", user?.id], queryFn: () => api<S<"PlayerRatingOut">>(`/ratings/players/${user!.id}`) });
  const p = r.data;
  const captain = !!home.data?.managed_team_ids.length && ctx !== "player";
  const verified = !!p && p.verified_matches > 0;
  const [chEdit, setChEdit] = useState(false);
  const photo = useProfilePhoto();
  return (
    <StarterScreen safeTop refreshing={r.isRefetching} onRefresh={() => void r.refetch()}>
      <View style={{ alignItems: "flex-end", marginBottom: -40 }}><SportSwitcher /></View>
      <View style={{ alignItems: "center", gap: 6, marginTop: 14, marginBottom: 6 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={user?.profile_image ? "Change profile photo" : "Add profile photo"} disabled={photo.busy} onPress={() => void photo.upload()}>
          <View style={{ opacity: photo.busy ? 0.5 : 1 }}><Avatar uri={user?.profile_image} name={user?.full_name ?? "Me"} size={86} /></View>
          <CameraBadge size={30} />
        </Pressable>
        {!user?.profile_image ? <Txt v="small" color={T.primaryDark}>Add a photo so captains recognise you</Txt> : null}
        <Txt v="h1" style={{ fontSize: 25, fontFamily: "Inter_800ExtraBold", marginTop: 6 }}>{user?.full_name}{verified ? " ✓" : ""}</Txt>
        <Txt v="small" color={T.muted} style={{ fontSize: 14 }}>{captain ? "Captain" : "Player"}{p?.primary_role ? ` · ${roleLabel(p.primary_role)}` : ""} · {sport ? SPORTS[sport].name : "Cricket"}</Txt>
      </View>
      <StatStrip items={[
        { value: verified ? rating(p!.overall.rating) : "New", label: verified && p!.overall.provisional ? "Rating (provisional)" : "Rating" },
        { value: String(p?.verified_matches ?? 0), label: "Matches" },
        { value: String(p?.career?.wickets ?? 0), label: "Wkts" },
      ]} />
      {chEdit ? (
        <CricHeroesEditor kind="player" current={p?.cricheroes_profile_url} currentStats={p?.cricheroes_stats} save={async (u, st) => { await savePlayerCricHeroes(u, st); await r.refetch(); }} onClose={() => setChEdit(false)} />
      ) : (
        <CricHeroesCard kind="player" url={p?.cricheroes_profile_url} stats={p?.cricheroes_stats} onEdit={() => setChEdit(true)} compact />
      )}
      <View style={{ gap: 12 }}>
        <LinkCard icon="calendar" title="My Games & History" onPress={() => router.push("/games")} />
        <LinkCard icon="trophy" title="Leaderboard" onPress={() => router.push("/leaderboard")} />
        <LinkCard icon="profile" title="My player profile" onPress={() => user && router.push({ pathname: "/player/[id]", params: { id: user.id } })} />
        <LinkCard icon="week" title="Availability" sub="When captains can find you" onPress={() => router.push("/availability")} />
        <LinkCard icon="shield" title="My teams" onPress={() => router.push("/teams")} />
        <LinkCard icon="receipt" title="Payments & Split Fees" onPress={() => router.push("/payments")} />
        <LinkCard icon="bell" title="Notifications" onPress={() => router.push("/notifications")} />
        <LinkCard icon="settings" title="Settings" sub="Appearance (light/dark), WhatsApp, privacy, blocked people, log out" onPress={() => router.push("/profile")} />
      </View>
      <Txt v="small" color={T.muted}>Stats come only from captain-verified matches.</Txt>
    </StarterScreen>
  );
}
