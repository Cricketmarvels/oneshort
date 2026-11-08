import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * Refresh token lives in the OS keychain/keystore; the access token only in memory.
 * expo-secure-store has no web implementation, so the web preview build keeps the refresh
 * token in sessionStorage (cleared when the tab closes). Native builds never use it.
 */
const KEY = "cm.refresh";
let accessToken: string | null = null;
const web = Platform.OS === "web";
const ss = () => (globalThis as { sessionStorage?: Storage }).sessionStorage;

export const tokens = {
  get access() { return accessToken; },
  setAccess(t: string | null) { accessToken = t; },
  getRefresh: async () => (web ? ss()?.getItem(KEY) ?? null : SecureStore.getItemAsync(KEY)),
  setRefresh: async (t: string) => { if (web) ss()?.setItem(KEY, t); else await SecureStore.setItemAsync(KEY, t); },
  clear: async () => { accessToken = null; if (web) ss()?.removeItem(KEY); else await SecureStore.deleteItemAsync(KEY); },
};
