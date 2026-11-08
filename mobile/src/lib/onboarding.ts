/** "Show onboarding once after sign-up" flag. Set when a new account verifies its code; cleared on finish/skip. */
import { create } from "zustand";

type State = { pending: boolean; start: () => void; finish: () => void };
export const useOnboarding = create<State>((set) => ({
  pending: false,
  start: () => set({ pending: true }),
  finish: () => set({ pending: false }),
}));
