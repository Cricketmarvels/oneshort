/** Remembers the captain invite link someone opened, so after sign-up/log-in (+ agreement) they land back on it. */
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { create } from "zustand";

const KEY = "playr.pendingJoin";
const web = Platform.OS === "web";
const ls = () => (globalThis as { localStorage?: Storage }).localStorage;

type State = { code: string | null; ready: boolean; load: () => Promise<void>; set: (code: string) => void; clear: () => void };
export const usePendingJoin = create<State>((set) => ({
  code: null,
  ready: false,
  load: async () => {
    try { const v = web ? ls()?.getItem(KEY) : await SecureStore.getItemAsync(KEY); set({ code: v || null, ready: true }); }
    catch { set({ ready: true }); }
  },
  set: (code) => { set({ code }); try { if (web) ls()?.setItem(KEY, code); else void SecureStore.setItemAsync(KEY, code); } catch { /* ignore */ } },
  clear: () => { set({ code: null }); try { if (web) ls()?.removeItem(KEY); else void SecureStore.deleteItemAsync(KEY); } catch { /* ignore */ } },
}));

/** Public link for a join path: the current website origin on web, else the server-provided URL. */
export function joinUrl(path: string, serverUrl?: string | null): string {
  const origin = web ? (globalThis as { location?: { origin?: string } }).location?.origin : undefined;
  return origin ? `${origin}${path}` : serverUrl ?? path;
}
