/**
 * Registration draft, kept on this device per account so an interrupted sign-up reopens on the same step with
 * what was already typed. The server decides whether registration is finished (`registration_completed_at`);
 * this only remembers progress. Passwords are never stored here.
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";

export type PlayAs = "player" | "captain";
export type Draft = { step: 1 | 2 | 3; email: string; playAs: PlayAs; name: string; role: string | null };

const KEY = "oneshort.registration";
const web = Platform.OS === "web";
const ls = () => (globalThis as { localStorage?: Storage }).localStorage;
const EMPTY: Draft = { step: 1, email: "", playAs: "player", name: "", role: null };

type State = {
  userId: string | null;
  draft: Draft;
  load: (userId: string) => Promise<void>;
  update: (patch: Partial<Draft>) => void;
  clear: () => void;
};

const write = (v: string | null) => {
  try {
    if (web) { if (v === null) ls()?.removeItem(KEY); else ls()?.setItem(KEY, v); }
    else if (v === null) void SecureStore.deleteItemAsync(KEY);
    else void SecureStore.setItemAsync(KEY, v);
  } catch { /* storage unavailable: progress just isn't kept */ }
};

export const useRegistration = create<State>((set, get) => ({
  userId: null,
  draft: EMPTY,
  load: async (userId) => {
    if (get().userId === userId) return;
    try {
      const raw = web ? ls()?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
      const saved = raw ? (JSON.parse(raw) as { userId?: string; draft?: Partial<Draft> }) : null;
      set({ userId, draft: saved?.userId === userId ? { ...EMPTY, ...saved.draft } : EMPTY });
    } catch { set({ userId, draft: EMPTY }); }
  },
  update: (patch) => {
    const draft = { ...get().draft, ...patch };
    set({ draft });
    write(JSON.stringify({ userId: get().userId, draft }));
  },
  clear: () => { set({ draft: EMPTY }); write(null); },
}));
