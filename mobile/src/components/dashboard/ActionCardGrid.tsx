/**
 * Two-column grid of 3D action cards. Data-driven: the home screen supplies the four actions, this
 * file owns the composition (14 px across, 18 px down) so no card repeats a style.
 */
import { View } from "react-native";

import { CARD } from "@/components/dashboard/cardTokens";
import { ThreeDActionCard, type ActionCard } from "@/components/dashboard/ThreeDActionCard";

export function ActionCardGrid({ cards }: { cards: ActionCard[] }) {
  const rows: ActionCard[][] = [];
  for (let i = 0; i < cards.length; i += 2) rows.push(cards.slice(i, i + 2));
  return (
    <View style={{ gap: CARD.gapY }}>
      {rows.map((row) => (
        <View key={row.map((c) => c.title).join("|")} style={{ flexDirection: "row", gap: CARD.gapX, alignItems: "stretch" }}>
          {row.map((c) => <ThreeDActionCard key={c.title} {...c} />)}
          {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
    </View>
  );
}
