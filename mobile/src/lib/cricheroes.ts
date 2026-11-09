import type { S } from "@cm/shared";

import { api, errorText } from "@/lib/api";

/** Save/remove the signed-in player's CricHeroes link and self-reported stats. Omit = keep, null = remove. */
export async function savePlayerCricHeroes(url: string | null, stats?: S<"CricHeroesStats"> | null): Promise<void> {
  const body: Record<string, unknown> = { profile_url: url };
  if (stats !== undefined) body.stats = stats;
  try { await api("/players/me/cricheroes", { method: "PUT", body }); }
  catch (e) {
    const code = (e as { code?: string }).code;
    throw new Error(code === "PLAYER_PROFILE_REQUIRED" ? "Finish your player profile first (Profile → Settings), then add your CricHeroes details." : errorText(e));
  }
}
