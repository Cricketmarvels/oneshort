/**
 * The four home actions per role, with their existing routes. Keeping them here means the grid stays
 * configurable through data and the routes live in one place. Role protection is unchanged: the
 * captain set is only rendered in the captain context, and the two team actions need a managed team
 * (without one they go to Teams, where a captain creates one).
 */
import { router } from "expo-router";

import type { ActionCard } from "@/components/dashboard/ThreeDActionCard";

/** Player context: discovery and money, in the reference's mint → ice → peach → lavender order. */
/**
 * Player context. A player doesn't recruit or book: they say when they're free (and whether they'll
 * pay their share), look for a team, and keep track of what they owe each captain.
 */
export function playerActions(): ActionCard[] {
  return [
    { action: "shareAvailability", title: "Share Availability", tone: "mint", onPress: () => router.push("/availability") },
    { action: "findTeams", title: "Find Teams", tone: "aqua", onPress: () => router.push("/find/teams") },
    { action: "manageFees", title: "Manage Fees", tone: "lilac", onPress: () => router.push("/payments") },
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
