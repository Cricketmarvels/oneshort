/**
 * One row of 3D action cards. Data-driven: the home screen supplies the actions, this file owns the
 * composition so no card repeats a style.
 */
import { View } from "react-native";

import { CARD } from "@/components/dashboard/cardTokens";
import { ThreeDActionCard, type ActionCard } from "@/components/dashboard/ThreeDActionCard";

export function ActionCardGrid({ cards }: { cards: ActionCard[] }) {
  return (
    <View style={{ flexDirection: "row", gap: CARD.gapX, alignItems: "stretch" }}>
      {cards.map((c) => <ThreeDActionCard key={c.title} {...c} />)}
    </View>
  );
}
