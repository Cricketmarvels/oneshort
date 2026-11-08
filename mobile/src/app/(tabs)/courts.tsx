import { useLocalSearchParams } from "expo-router";

import { HeroScreen } from "@/components/layout";
import { FindCourts } from "@/components/racket";
import { isRacket, SPORTS, useSport } from "@/lib/sports";

/** Badminton / Pickleball: Find a Court / Book a Court tab (hidden for cricket). */
export default function CourtsTab() {
  const { sport } = useSport();
  const { book } = useLocalSearchParams<{ book?: string }>();
  if (!isRacket(sport)) return null;
  return <HeroScreen title={book ? "Book a court" : "Find a court"} kicker={`${SPORTS[sport].name} courts near you`} dense><FindCourts sport={sport} booking={!!book} /></HeroScreen>;
}
