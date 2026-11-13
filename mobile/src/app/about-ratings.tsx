import { ScrollView, View } from "react-native";

import { Card, Txt } from "@/components/ui";
import { SP, T } from "@/theme";

const SECTIONS: [string, string][] = [
  ["Only verified matches count", "A result updates ratings only after the opposing team's captain or vice-captain confirms it, or a OneShort admin resolves a dispute. Disputed or unconfirmed results never change anyone's rating. Stats imported from other apps are shown as \"provided by the team\" and are never ranked."],
  ["Skill ratings (Glicko-2)", "Every player has separate batting, bowling, fielding and match-impact ratings, plus an uncertainty (±). Ratings start at 1500 ±350 and settle as verified matches add up. A long break makes a rating less certain again."],
  ["Cricket-aware scoring", "Each match turns your scorecard line into a performance score against a par for the format: 30 runs in a T10 counts for more than 30 in a 40-over game. Batting looks at runs, strike rate, share of the team total and boundaries. Bowling looks at wickets and economy against the format's par. Fielding counts catches, run-outs and stumpings."],
  ["Quality of opposition", "The same performance earns more against a stronger team, and less against a weaker one."],
  ["Role-aware overall rating", "The overall rating blends your disciplines by playing role. All-rounders weigh batting 35%, bowling 35%, fielding 15% and match impact 15%. A specialist bowler's overall rating leans on bowling. These starting weights will be tuned against real match data."],
  ["Confidence and provisional ratings", "A rating is provisional until you have at least 5 verified matches and low uncertainty. Leaderboards rank by a conservative estimate (rating − 2 × uncertainty), so two lucky matches can't outrank fifty proven ones."],
  ["Explanations", "Every \"why your rating moved\" line is filled in from your actual scorecard and the actual rating change. A language model never writes or assigns ratings."],
  ["How leaderboards rank", "Leaderboards use proven rating (rating − 2 × uncertainty) inside the area you pick (5–50 km, city, state or national). Players without a verified match aren't ranked; format views need 3+ verified matches in that format. Most Consistent and Rising Stars reward regular play and improvement, not just one big score."],
  ["Achievements", "Badges such as Debut, Consistent Player, Half-century or Three-for come only from verified scorecards and attendance marked by the captain. Nothing is self-reported. Profiles show earned badges and real progress towards the next one."],
  ["Attendance", "Attendance is the share of pickup games a player turned up for (present or late) out of those the captain marked. It's shown only after 3 marked games."],
  ["Disputes and corrections", "If a result is wrong, the opposing captain disputes it and it's held. If a confirmed result later turns out to be wrong, an admin can void it, and every rating is recalculated without it."],
];

export default function AboutRatings() {
  return (
    <ScrollView style={{ backgroundColor: T.bg }} contentContainerStyle={{ padding: SP.page, gap: SP.md, paddingBottom: 60 }}>
      <View style={{ padding: SP.xl, borderRadius: 22, backgroundColor: T.heroInk, gap: 6 }}>
        <Txt v="h1" color="#FFFFFF">Earned, not claimed.</Txt>
        <Txt v="body" color="rgba(255,255,255,0.8)">OneShort ratings come only from verified results, and every rating shows how sure we are about it.</Txt>
      </View>
      {SECTIONS.map(([h, b]) => (
        <Card key={h}><Txt v="h3">{h}</Txt><Txt v="small" color={T.text2}>{b}</Txt></Card>
      ))}
    </ScrollView>
  );
}
