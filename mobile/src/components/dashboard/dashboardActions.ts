/**
 * The four home actions per role, with their existing routes. Keeping them here means the grid stays
 * configurable through data and the routes live in one place. Role protection is unchanged: the
 * captain set is only rendered in the captain context, and the two team actions need a managed team
 * (without one they go to Teams, where a captain creates one).
 */
import { router } from "expo-router";

import type { ActionCard } from "@/components/dashboard/ThreeDActionCard";

/** Player context: discovery and money, in the reference's mint → ice → peach → lavender order. */
export function playerActions(): ActionCard[] {
  return [
    { action: "findPlayers", title: "Find Players", tone: "mint", onPress: () => router.push("/find/players") },
    { action: "findTeams", title: "Find Teams", tone: "aqua", onPress: () => router.push("/find/teams") },
    { action: "bookGround", title: "Book Ground", tone: "peach", onPress: () => router.push("/grounds") },
    { action: "splitFees", title: "Split Fees", tone: "lilac", onPress: () => router.push("/payments") },
  ];
}

/** Captain context: the reference's own four cards. `teamId` and `matchId` deep-link where they exist. */
export function captainActions({ teamId, matchId }: { teamId?: string | null; matchId?: string | null }): ActionCard[] {
  return [
    { action: "createMatch", title: "Create Match", tone: "mint", onPress: () => router.push(teamId ? { pathname: "/match/new", params: { team: teamId } } : "/match/new") },
    { action: "findPlayers", title: "Find Players", tone: "aqua", onPress: () => router.push(matchId ? { pathname: "/match/players", params: { match: matchId } } : "/match/players") },
    { action: "manageTeam", title: "Manage Team", tone: "peach", onPress: () => router.push(teamId ? { pathname: "/team/[id]", params: { id: teamId } } : "/teams") },
    { action: "challenge", title: "Challenge", tone: "lilac", onPress: () => router.push(teamId ? { pathname: "/challenge/new", params: { from: teamId } } : "/teams") },
  ];
}
