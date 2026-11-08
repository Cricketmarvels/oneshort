/** Saved players/teams — stored on this device only (no backend endpoint yet). */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";

const KEY = "playr.saved";
const web = Platform.OS === "web";
const ls = () => (globalThis as { localStorage?: Storage }).localStorage;
type Kind = "player" | "team";
type State = { ids: Record<string, true>; loaded: boolean; load: () => Promise<void>; toggle: (kind: Kind, id: string) => void; has: (kind: Kind, id: string) => boolean };

export const useSaved = create<State>((set, get) => ({
  ids: {},
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const raw = web ? ls()?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
      set({ ids: raw ? (JSON.parse(raw) as Record<string, true>) : {}, loaded: true });
    } catch { set({ loaded: true }); }
  },
  toggle: (kind, id) => {
    const k = `${kind}:${id}`;
    const ids = { ...get().ids };
    if (ids[k]) delete ids[k]; else ids[k] = true;
    set({ ids });
    const v = JSON.stringify(ids);
    try { if (web) ls()?.setItem(KEY, v); else void SecureStore.setItemAsync(KEY, v); } catch { /* ignore */ }
  },
  has: (kind, id) => !!get().ids[`${kind}:${id}`],
}));
