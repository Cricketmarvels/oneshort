/**
 * Sport registry + the user's selected sport. Adding a sport = one entry here (+ its icon and
 * feature screens); navigation reads `features` to decide which tabs to show.
 * The selection is chosen before login, remembered on the device, and synced to the profile
 * (`preferred_sport`) after sign-in so it follows the user to other devices.
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";

export type SportId = "cricket" | "badminton" | "pickleball";
export type RacketSport = Exclude<SportId, "cricket">;
export type Feature = "teams" | "rankings" | "matches" | "communities" | "find_player" | "find_court" | "book_court" | "play_requests";

export const SPORTS: Record<SportId, { id: SportId; name: string; tagline: string; features: Feature[] }> = {
  cricket: { id: "cricket", name: "Cricket", tagline: "Teams · players · grounds", features: ["teams", "rankings", "matches", "communities", "find_player"] },
  badminton: { id: "badminton", name: "Badminton", tagline: "Players · courts", features: ["find_player", "find_court", "book_court", "play_requests"] },
  pickleball: { id: "pickleball", name: "Pickleball", tagline: "Games · courts", features: ["find_player", "find_court", "book_court", "play_requests"] },
};
export const SPORT_ORDER: SportId[] = ["cricket", "badminton", "pickleball"];
export const isRacket = (s: SportId | null | undefined): s is RacketSport => s === "badminton" || s === "pickleball";

const KEY = "playr.sport";
const web = Platform.OS === "web";
const ls = () => (globalThis as { localStorage?: Storage }).localStorage;
const read = async (): Promise<string | null> => (web ? ls()?.getItem(KEY) ?? null : SecureStore.getItemAsync(KEY));
const write = async (v: string) => { if (web) ls()?.setItem(KEY, v); else await SecureStore.setItemAsync(KEY, v); };

type SportState = { sport: SportId | null; ready: boolean; load: () => Promise<void>; choose: (s: SportId) => void };

export const useSport = create<SportState>((set) => ({
  sport: null,
  ready: false,
  load: async () => {
    try {
      const v = await read();
      set({ sport: v && v in SPORTS ? (v as SportId) : null, ready: true });
    } catch { set({ ready: true }); }
  },
  choose: (s) => { set({ sport: s }); void write(s).catch(() => undefined); },
}));
