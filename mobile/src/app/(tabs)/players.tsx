import { FindRacketPlayers } from "@/components/racket";
import { HeroScreen } from "@/components/layout";
import { isRacket, SPORTS, useSport } from "@/lib/sports";

/** Badminton / Pickleball: Find a Player tab (hidden for cricket). */
export default function PlayersTab() {
  const { sport } = useSport();
  if (!isRacket(sport)) return null;
  return <HeroScreen title="Players near you" kicker={`${SPORTS[sport].name} players to play with`} dense><FindRacketPlayers sport={sport} /></HeroScreen>;
}
