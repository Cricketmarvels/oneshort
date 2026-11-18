/**
 * Look of the illustrated captain cards, per sport. Navigation and who sees which card stay in
 * dashboardActions; this file only says how each action looks (copy, artwork, colours). A sport without
 * an entry keeps the classic 3D action tiles, so badminton and pickleball can get their own artwork later.
 *
 * Artwork: original OneShort illustrations (assets/images/art/cricket/, see assets/images/CREDITS.md).
 */
import type { ImageSource } from "expo-image";

import type { AuroraColors } from "@/components/dashboard/SportsIllustrationCard";
import type { ActionCard } from "@/components/dashboard/ThreeDActionCard";
import type { SportsAction } from "@/components/icons";

export type IllustrationStyle = {
  title: string;
  subtitle: string;
  illustration: ImageSource | number;
  /** "Aurora" mesh: base wash plus glows; see SportsIllustrationCard. */
  colors: AuroraColors;
};

export type IllustratedCard = IllustrationStyle & { key: SportsAction; onPress: () => void };

export const CRICKET_CAPTAIN_CARDS: Partial<Record<SportsAction, IllustrationStyle>> = {
  createMatch: {
    title: "Create Match", subtitle: "Organize a game",
    illustration: require("../../../assets/images/art/cricket/create-match.png"),
    colors: { base: ["#D5F5E3", "#BDEBD3"], glow: "#A8EBC9", deep: "#7FD8B0", accent: "#1E8E57" },
  },
  findPlayers: {
    title: "Find Players", subtitle: "Discover & connect",
    illustration: require("../../../assets/images/art/cricket/find-players.png"),
    colors: { base: ["#DCEEFF", "#C5E2FA"], glow: "#B8DBFF", deep: "#9CC7F5", accent: "#1F74B0" },
  },
  manageTeam: {
    title: "My Team", subtitle: "Manage your squad",
    illustration: require("../../../assets/images/art/cricket/my-team.png"),
    colors: { base: ["#FFEEDD", "#FFE0C2"], glow: "#FFD3B0", deep: "#FFC48E", accent: "#C46A1C" },
  },
  challenge: {
    title: "Challenge Team", subtitle: "Compete & win",
    illustration: require("../../../assets/images/art/cricket/challenge-team.png"),
    colors: { base: ["#EEE8FF", "#DDD3FA"], glow: "#D9CCFF", deep: "#C2B1F5", accent: "#6A4FC4" },
  },
};

export const CRICKET_PLAYER_CARDS: Partial<Record<SportsAction, IllustrationStyle>> = {
  shareAvailability: {
    title: "Share Availability", subtitle: "Tell captains you're free",
    illustration: require("../../../assets/images/art/cricket/share-availability.png"),
    colors: { base: ["#D5F5E3", "#BDEBD3"], glow: "#A8EBC9", deep: "#7FD8B0", accent: "#1E8E57" },
  },
  findTeams: {
    title: "Find Teams", subtitle: "Discover & join a side",
    illustration: require("../../../assets/images/art/cricket/find-teams.png"),
    colors: { base: ["#DCEEFF", "#C5E2FA"], glow: "#B8DBFF", deep: "#9CC7F5", accent: "#1F74B0" },
  },
  manageFees: {
    title: "Manage Fees", subtitle: "Track & pay your fees",
    illustration: require("../../../assets/images/art/cricket/manage-fees.png"),
    colors: { base: ["#EEE8FF", "#DDD3FA"], glow: "#D9CCFF", deep: "#C2B1F5", accent: "#6A4FC4" },
  },
};

/** Dress the role's actions (routes unchanged) in illustrated styles. Null if any action has no artwork. */
export function illustrate(actions: ActionCard[], styles: Partial<Record<SportsAction, IllustrationStyle>>): IllustratedCard[] | null {
  const out: IllustratedCard[] = [];
  for (const a of actions) {
    const s = styles[a.action];
    if (!s) return null;
    out.push({ ...s, key: a.action, onPress: a.onPress });
  }
  return out;
}
