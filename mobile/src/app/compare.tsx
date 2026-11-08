import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";

import { RatingConfidenceBadge } from "@/components/cricket";
import { Avatar, Card, ErrorBox, LoadingSkeleton, Section, Txt } from "@/components/ui";
import { CompareBar, RadarChart, Sparkline } from "@/components/viz";
import { api } from "@/lib/api";
import { rating } from "@/lib/format";
import type { PlayerRating } from "@/lib/types";
import { SP, T } from "@/theme";

const norm = (r: number) => Math.max(0, Math.min(1, (r - 1100) / 800));

export default function Compare() {
  const { a, b } = useLocalSearchParams<{ a: string; b: string }>();
  const q = useQuery({ queryKey: ["compare", a, b], queryFn: () => api<{ a: PlayerRating; b: PlayerRating }>("/players/compare", { query: { a, b } }) });
  if (q.isPending) return <View style={{ padding: SP.page }}><LoadingSkeleton rows={4} /></View>;
  if (q.isError) return <View style={{ padding: SP.page }}><ErrorBox error={q.error} /></View>;
  const { a: pa, b: pb } = q.data;
  const avg = (v: number[]) => (v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0);
  const radar = (p: PlayerRating) => [norm(p.batting.rating), norm(p.bowling.rating), norm(p.fielding.rating), norm(p.impact.rating), p.consistency ?? 0.3, Math.min(1, p.verified_matches / 30)];
  return (
    <ScrollView contentContainerStyle={{ padding: SP.page, gap: SP.xl, paddingBottom: 60 }}>
      <View style={{ flexDirection: "row", gap: SP.md }}>
        {[pa, pb].map((p, i) => (
          <Card key={p.user.id} style={{ flex: 1, alignItems: "center", gap: 6 }}>
            <Avatar uri={p.user.profile_image} name={p.user.full_name} size={58} />
            <Txt v="h3" numberOfLines={1}>{p.user.full_name}</Txt>
            <Txt v="stat">{p.verified_matches ? rating(p.overall.rating) : "—"}</Txt>
            <RatingConfidenceBadge r={p.verified_matches ? p.overall : null} />
            <Sparkline values={p.trend} w={90} h={26} />
          </Card>
        ))}
      </View>
      <Card style={{ alignItems: "center" }}>
        <RadarChart axes={["Batting", "Bowling", "Fielding", "Impact", "Consistency", "Experience"]} a={radar(pa)} b={radar(pb)} />
        <View style={{ flexDirection: "row", gap: SP.lg }}>
          <Txt v="smallSemi" color={T.accent}>■ {pa.user.full_name.split(" ")[0]}</Txt>
          <Txt v="smallSemi">■ {pb.user.full_name.split(" ")[0]}</Txt>
        </View>
      </Card>
      <Section title="Head to head numbers">
        <Card style={{ gap: SP.lg }}>
          <CompareBar label="Overall" a={pa.verified_matches ? pa.overall.rating : null} b={pb.verified_matches ? pb.overall.rating : null} />
          <CompareBar label="Batting" a={pa.batting.matches ? pa.batting.rating : null} b={pb.batting.matches ? pb.batting.rating : null} />
          <CompareBar label="Bowling" a={pa.bowling.matches ? pa.bowling.rating : null} b={pb.bowling.matches ? pb.bowling.rating : null} />
          <CompareBar label="Fielding" a={pa.fielding.matches ? pa.fielding.rating : null} b={pb.fielding.matches ? pb.fielding.rating : null} />
          <CompareBar label="Recent form" a={pa.recent_form.length ? avg(pa.recent_form) * 100 : null} b={pb.recent_form.length ? avg(pb.recent_form) * 100 : null} />
          <CompareBar label="Consistency" a={pa.consistency != null ? pa.consistency * 100 : null} b={pb.consistency != null ? pb.consistency * 100 : null} />
          <CompareBar label="Verified matches" a={pa.verified_matches} b={pb.verified_matches} />
          <CompareBar label="Runs" a={pa.career.runs ?? 0} b={pb.career.runs ?? 0} />
          <CompareBar label="Wickets" a={pa.career.wickets ?? 0} b={pb.career.wickets ?? 0} />
        </Card>
      </Section>
      <Txt v="small" color={T.muted}>Ratings with low confidence can move a lot. Compare confidence before drawing conclusions.</Txt>
    </ScrollView>
  );
}
