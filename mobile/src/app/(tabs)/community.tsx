/**
 * Community (refined spec §5.6): a local, sport-relevant feed — For you / Nearby / Following — with
 * hide, report and block on every post, plus your communities and ones nearby. No invented
 * engagement counts: there are no likes in the backend, so the card offers Reply (in the community) and Share.
 */
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Plus } from "lucide-react-native";
import { useRef, useState } from "react";
import { Pressable, ScrollView, Share, View } from "react-native";

import { ago, LocationOptions } from "@/components/cricket";
import { TeamCrest } from "@/components/art";
import { HeroScreen } from "@/components/layout";
import { FeedPostCard, type FeedPost, KickerChip, ReportBlockSheet, SectionHeader } from "@/components/refined";
import { FilterBottomSheet } from "@/components/sheet";
import { Button, Chip, EmptyState, ErrorBox, IconButton, LoadingSkeleton, Txt } from "@/components/ui";
import { api, errorText } from "@/lib/api";
import { useLocation } from "@/lib/location";
import type { Community } from "@/lib/types";
import { ICON, R, SP, T } from "@/theme";

type Scope = "for_you" | "nearby" | "following";
const PAGE = 15;

function CommunityPill({ c }: { c: Community }) {
  const joined = !!c.my_role;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${c.name}, ${c.member_count} members${joined ? ", joined" : ""}`} onPress={() => router.push({ pathname: "/community/[id]", params: { id: c.id } })}
      style={({ pressed }) => ({ width: 168, padding: 14, gap: 10, borderRadius: R.card, borderWidth: 1, borderColor: T.line, backgroundColor: pressed ? T.surface2 : T.surface })}>
      <TeamCrest name={c.name} size={40} />
      <View style={{ gap: 2 }}>
        <Txt v="h3" numberOfLines={1} style={{ fontSize: 14.5 }}>{c.name}</Txt>
        <Txt v="small" color={T.muted} numberOfLines={1}>{[c.area ?? c.city, `${c.member_count} members`].filter(Boolean).join(" · ")}</Txt>
      </View>
      <KickerChip label={joined ? "JOINED" : c.my_status === "pending" ? "REQUESTED" : c.visibility === "private" ? "ASK TO JOIN" : "JOIN"} tone={joined ? "success" : "aqua"} />
    </Pressable>
  );
}

export default function CommunityTab() {
  const qc = useQueryClient();
  const { lat, lng, label } = useLocation();
  const [scope, setScope] = useState<Scope>("for_you");
  const locSheet = useRef<BottomSheetModal>(null);
  const safety = useRef<BottomSheetModal>(null);
  const [focus, setFocus] = useState<FeedPost | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const mine = useQuery({ queryKey: ["communities", "mine"], queryFn: () => api<Community[]>("/communities/discover", { query: { mine: true } }) });
  const near = useQuery({ queryKey: ["communities", "near", lat, lng], queryFn: () => api<Community[]>("/communities/discover", { query: { lat, lng, radius_km: 25 } }) });
  const feed = useInfiniteQuery({
    queryKey: ["community-feed", scope, lat, lng],
    initialPageParam: undefined as string | undefined,
    // api() unwraps the envelope to the posts array; a full page means there may be more.
    queryFn: ({ pageParam }) => api<FeedPost[]>("/communities/feed", { query: { scope, lat, lng, radius_km: 25, before: pageParam, limit: PAGE } }),
    getNextPageParam: (last) => (last.length === PAGE ? last[last.length - 1]?.id : undefined),
  });
  const posts = feed.data?.pages.flat() ?? [];
  const joined = (mine.data ?? []).filter((c) => c.my_role);
  const others = (near.data ?? []).filter((c) => !joined.some((j) => j.id === c.id));

  const act = useMutation({
    mutationFn: async (a: { kind: "hide" | "report" | "block"; reason?: string }) => {
      if (!focus) return;
      if (a.kind === "hide") await api(`/communities/posts/${focus.id}/hide`, { method: "POST" });
      if (a.kind === "report") await api(`/communities/${focus.community_id}/posts/${focus.id}/report`, { method: "POST", body: { reason: a.reason } });
      if (a.kind === "block") await api(`/users/${focus.author.id}/block`, { method: "POST" });
    },
    onSuccess: (_r, a) => {
      setResult(a.kind === "hide" ? "Hidden from your feeds." : a.kind === "report" ? "Thanks — moderators will review it." : `Blocked. You won't see ${focus?.author.full_name.split(" ")[0]}'s posts.`);
      void qc.invalidateQueries({ queryKey: ["community-feed"] });
      setTimeout(() => safety.current?.dismiss(), 1200);
    },
    onError: (e) => setResult(errorText(e)),
  });
  const vote = useMutation({
    mutationFn: ({ p, i }: { p: FeedPost; i: number }) => api(`/communities/${p.community_id}/posts/${p.id}/vote`, { method: "POST", body: { option: i } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["community-feed"] }),
  });
  const open = (p: FeedPost) => router.push({ pathname: "/community/[id]", params: { id: p.community_id } });
  const share = (p: FeedPost) => void Share.share({ message: `${p.author.full_name} in ${p.community_name ?? "GoFindr"}: ${p.body}` });
  const compose = () => (joined[0] ? router.push({ pathname: "/community/[id]", params: { id: joined[0].id } }) : router.push("/community/new"));

  return (
    <>
      <HeroScreen title="Community" kicker="Local games, teams and match moments" subtitle={`${label} · 25 km`} onSubtitle={() => locSheet.current?.present()} dense
        refreshing={feed.isRefetching} onRefresh={() => { void feed.refetch(); void mine.refetch(); void near.refetch(); }}
        right={<IconButton filled label={joined[0] ? "Write a post" : "Create a community"} icon={<Plus size={22} color={T.ink} strokeWidth={ICON.stroke} />} onPress={compose} />}>
        <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="tablist">
          {([["for_you", "For You"], ["following", "Following"], ["nearby", "Nearby"]] as const).map(([v, l]) => <Chip key={v} label={l} active={scope === v} onPress={() => setScope(v)} />)}
        </View>

        {joined.length || others.length ? (
          <View style={{ gap: SP.md }}>
            <SectionHeader title={joined.length ? "Your communities" : "Communities near you"} action="Create" onAction={() => router.push("/community/new")} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -SP.page, flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: SP.page, gap: 10 }}>
              {[...joined, ...others].slice(0, 10).map((c) => <CommunityPill key={c.id} c={c} />)}
            </ScrollView>
          </View>
        ) : null}

        <View style={{ gap: SP.md }}>
          <SectionHeader title={{ for_you: "For you", nearby: "Nearby", following: "Following" }[scope]} />
          {feed.isPending ? <LoadingSkeleton rows={4} /> : feed.isError ? <ErrorBox error={feed.error} onRetry={() => void feed.refetch()} /> : !posts.length ? (
            scope === "following" ? (
              <EmptyState title="Nothing from your communities yet" body="Join a community to follow its match days, player requests and announcements." action="See nearby" onAction={() => setScope("nearby")} />
            ) : (
              <EmptyState title="It's quiet around here" body="No public posts within 25 km yet. Start a community for your sector, society or office." action="Create a community" onAction={() => router.push("/community/new")} />
            )
          ) : (
            <>
              {posts.map((p) => (
                <FeedPostCard key={p.id} p={p} ago={ago(p.created_at)} onOpen={() => open(p)} onShare={() => share(p)}
                  onVote={p.community_joined ? (i) => vote.mutate({ p, i }) : undefined}
                  onMore={() => { setFocus(p); setResult(null); safety.current?.present(); }} />
              ))}
              {feed.hasNextPage ? <Button title="Load more" variant="secondary" loading={feed.isFetchingNextPage} onPress={() => void feed.fetchNextPage()} /> : null}
            </>
          )}
        </View>
        <Txt v="small" color={T.muted}>Be respectful — community guidelines apply. GoFindr doesn't verify posts; report anything that looks wrong.</Txt>
      </HeroScreen>
      <FilterBottomSheet ref={safety} title="Post options" snap={["78%"]}>
        {focus ? <ReportBlockSheet post={focus} busy={act.isPending} result={result} onHide={() => act.mutate({ kind: "hide" })} onReport={(reason) => act.mutate({ kind: "report", reason })} onBlock={() => act.mutate({ kind: "block" })} /> : null}
      </FilterBottomSheet>
      <FilterBottomSheet ref={locSheet} title="Search near" snap={["75%"]}><LocationOptions onDone={() => locSheet.current?.dismiss()} /></FilterBottomSheet>
    </>
  );
}
