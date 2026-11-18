/**
 * The illustrated captain cards change only the look: each still opens the same screen as before,
 * deep-linking to the selected team or next match when there is one.
 */
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

import { captainActions, playerActions } from "../components/dashboard/dashboardActions";
import { CRICKET_CAPTAIN_CARDS, CRICKET_PLAYER_CARDS, illustrate } from "../components/dashboard/sportsCards";

beforeEach(() => mockPush.mockClear());

function open(teamId: string | null, matchId: string | null, key: string) {
  const cards = illustrate(captainActions({ teamId, matchId }), CRICKET_CAPTAIN_CARDS);
  expect(cards).not.toBeNull();
  cards!.find((c) => c.key === key)!.onPress();
  return mockPush.mock.calls[0]![0];
}

test("captain gets four illustrated cards in order, with the new names", () => {
  const cards = illustrate(captainActions({ teamId: "t1", matchId: "m1" }), CRICKET_CAPTAIN_CARDS)!;
  expect(cards.map((c) => c.title)).toEqual(["Create Match", "Find Players", "My Team", "Challenge Team"]);
  expect(cards.every((c) => c.subtitle && c.illustration && c.colors.base.length === 2 && c.colors.accent)).toBe(true);
});

test("Create Match opens a new match for the selected team", () => {
  expect(open("t1", null, "createMatch")).toEqual({ pathname: "/match/new", params: { team: "t1" } });
  mockPush.mockClear();
  expect(open(null, null, "createMatch")).toBe("/match/new");
});

test("Find Players opens player search for the next match", () => {
  expect(open("t1", "m1", "findPlayers")).toEqual({ pathname: "/match/players", params: { match: "m1" } });
  mockPush.mockClear();
  expect(open("t1", null, "findPlayers")).toBe("/match/players");
});

test("My Team opens the team page, or Teams without one", () => {
  expect(open("t1", null, "manageTeam")).toEqual({ pathname: "/team/[id]", params: { id: "t1" } });
  mockPush.mockClear();
  expect(open(null, null, "manageTeam")).toBe("/teams");
});

test("Challenge Team opens a challenge from the team, or Teams without one", () => {
  expect(open("t1", null, "challenge")).toEqual({ pathname: "/challenge/new", params: { from: "t1" } });
  mockPush.mockClear();
  expect(open(null, null, "challenge")).toBe("/teams");
});

test("players get their own three illustrated cards, never the captain's", () => {
  expect(illustrate(playerActions(), CRICKET_CAPTAIN_CARDS)).toBeNull();
  const cards = illustrate(playerActions(), CRICKET_PLAYER_CARDS)!;
  expect(cards.map((c) => c.title)).toEqual(["Share Availability", "Find Teams", "Manage Fees"]);
  const routes = cards.map((c) => { mockPush.mockClear(); c.onPress(); return mockPush.mock.calls[0]![0]; });
  expect(routes).toEqual(["/availability", "/find/teams", "/payments"]);
  expect(illustrate(captainActions({ teamId: "t1", matchId: null }), CRICKET_PLAYER_CARDS)).toBeNull();
});
