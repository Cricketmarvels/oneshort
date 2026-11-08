import { HeroScreen } from "@/components/layout";
import { RacketRequests } from "@/components/racket";
import { isRacket, SPORTS, useSport } from "@/lib/sports";

/** Badminton / Pickleball: play requests (received / sent). Hidden for cricket. */
export default function RequestsTab() {
  const { sport } = useSport();
  if (!isRacket(sport)) return null;
  return <HeroScreen title="Play requests" kicker={`Your ${SPORTS[sport].name.toLowerCase()} requests`} dense><RacketRequests sport={sport} /></HeroScreen>;
}
