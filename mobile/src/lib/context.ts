/** Player / Captain home context — a preference on ONE account (never a separate account). Persisted locally. */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";

export type HomeContext = "player" | "captain";
const KEY = "playr.homeContext";
const web = Platform.OS === "web";
const ls = () => (globalThis as { localStorage?: Storage }).localStorage;

type State = { ctx: HomeContext | null; load: () => Promise<void>; set: (c: HomeContext) => void };
export const useHomeContext = create<State>((set) => ({
  ctx: null,
  load: async () => {
    try {
      const v = web ? ls()?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
      if (v === "player" || v === "captain") set({ ctx: v });
    } catch { /* default handled by caller */ }
  },
  set: (c) => { set({ ctx: c }); try { if (web) ls()?.setItem(KEY, c); else void SecureStore.setItemAsync(KEY, c); } catch { /* ignore */ } },
}));
