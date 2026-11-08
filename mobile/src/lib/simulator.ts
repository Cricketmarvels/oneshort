/** WhatsApp simulator helpers (development only): hand a code from the simulator back to the login screen, remember the key. */
import { Platform } from "react-native";
import { create } from "zustand";

export const useSimCode = create<{ code: string | null; setCode: (c: string | null) => void }>((set) => ({ code: null, setCode: (code) => set({ code }) }));

const KEY = "playr.simkey";
const ls = () => (Platform.OS === "web" ? (globalThis as { localStorage?: Storage }).localStorage : undefined);
let memoryKey = "";
export const simKey = {
  get: () => ls()?.getItem(KEY) ?? memoryKey,
  set: (k: string) => { memoryKey = k; ls()?.setItem(KEY, k); },
};
