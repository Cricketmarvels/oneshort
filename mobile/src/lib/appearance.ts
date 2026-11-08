/** Appearance preference: System (follow the phone) | Light | Dark. Stored on this device. */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";

export type AppearancePref = "system" | "light" | "dark";
const KEY = "playr.appearance";
const web = Platform.OS === "web";
const ls = () => (globalThis as { localStorage?: Storage }).localStorage;

type State = { pref: AppearancePref; ready: boolean; load: () => Promise<void>; set: (p: AppearancePref) => void };
export const useAppearance = create<State>((set) => ({
  pref: "system",
  ready: false,
  load: async () => {
    try {
      const v = web ? ls()?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
      set({ pref: v === "light" || v === "dark" ? v : "system", ready: true });
    } catch { set({ ready: true }); }
  },
  set: (p) => { set({ pref: p }); try { if (web) ls()?.setItem(KEY, p); else void SecureStore.setItemAsync(KEY, p); } catch { /* ignore */ } },
}));
