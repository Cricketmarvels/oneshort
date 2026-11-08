import { router, Stack, useLocalSearchParams } from "expo-router";
import { ScrollView, View } from "react-native";

import { RacketProfileForm, useRacketProfile } from "@/components/racket";
import { LoadingSkeleton, Txt } from "@/components/ui";
import { isRacket, SPORTS, type RacketSport, useSport } from "@/lib/sports";
import { SP, T } from "@/theme";

export default function RacketProfileScreen() {
  const params = useLocalSearchParams<{ sport?: string }>();
  const { sport: current } = useSport();
  const sport = (isRacket(params.sport as RacketSport) ? params.sport : current) as RacketSport;
  const q = useRacketProfile(sport);
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.lg, paddingBottom: 60 }}>
      <Stack.Screen options={{ title: `${SPORTS[sport].name} profile` }} />
      <Txt v="body" color={T.muted}>Tell nearby {SPORTS[sport].name.toLowerCase()} players how and when you play.</Txt>
      {q.isPending ? <LoadingSkeleton rows={3} /> : <View><RacketProfileForm sport={sport} initial={q.data ?? null} onSaved={() => (router.canGoBack() ? router.back() : router.replace("/"))} /></View>}
    </ScrollView>
  );
}
