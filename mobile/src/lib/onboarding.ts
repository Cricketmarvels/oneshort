/**
 * First-run onboarding. Home opens it when a fresh sign-up sets `pending`, or when the signed-in account has no
 * player profile yet (e.g. joined through a captain's invite link or signed in by email) and this device hasn't
 * already finished or skipped it for that account.
 */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";

const KEY = "playr.onboarding.done";
const web = Platform.OS === "web";
const ls = () => (globalThis as { localStorage?: Storage }).localStorage;

type State = {
  pending: boolean;
  done: string[]; // user ids that finished or skipped onboarding on this device
  ready: boolean;
  load: () => Promise<void>;
  start: () => void;
  finish: (userId?: string) => void;
  needs: (user: { id: string; has_player_profile: boolean } | null | undefined) => boolean;
};

export const useOnboarding = create<State>((set, get) => ({
  pending: false,
  done: [],
  ready: false,
  load: async () => {
    try {
      const raw = web ? ls()?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
      const ids = raw ? (JSON.parse(raw) as unknown) : [];
      set({ done: Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [], ready: true });
    } catch { set({ ready: true }); }
  },
  start: () => set({ pending: true }),
  finish: (userId) => {
    const done = userId && !get().done.includes(userId) ? [...get().done, userId].slice(-20) : get().done;
    set({ pending: false, done });
    try { const v = JSON.stringify(done); if (web) ls()?.setItem(KEY, v); else void SecureStore.setItemAsync(KEY, v); } catch { /* ignore */ }
  },
  needs: (user) => {
    const s = get();
    if (s.pending) return true;
    return !!user && s.ready && !user.has_player_profile && !s.done.includes(user.id);
  },
}));
