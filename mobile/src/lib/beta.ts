/**
 * Server-driven release flags, readable before login (`/auth/options` is public).
 * `beta_sport` is set during a single-sport TestFlight beta: the app then offers only that sport and the
 * API answers 404 for the others. Clearing the flag on the server brings every sport back — no app update.
 */
import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { SportId } from "@/lib/sports";

export type AuthOptions = S<"AuthOptionsOut">;

export function useAuthOptions() {
  return useQuery({ queryKey: ["auth-options"], queryFn: () => api<AuthOptions>("/auth/options"), staleTime: 60_000 });
}

/** The only sport allowed right now, `null` when every sport is open, `undefined` while loading. */
export function useBetaSport(): SportId | null | undefined {
  const q = useAuthOptions();
  if (q.data === undefined) return undefined;
  const s = q.data.beta_sport;
  return s === "cricket" || s === "badminton" || s === "pickleball" ? s : null;
}
