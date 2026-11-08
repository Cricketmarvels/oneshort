/** Save/remove the signed-in player's CricHeroes link without disturbing the rest of their profile. */
import type { PlayerSelf } from "@cm/shared";

import { api, errorText } from "@/lib/api";

export async function savePlayerCricHeroes(url: string | null): Promise<void> {
  let p: PlayerSelf | null = null;
  try { p = await api<PlayerSelf>("/players/me"); } catch { p = null; }
  if (!p) throw new Error("Create your player profile first (Profile → Settings), then add your CricHeroes link.");
  const body = {
    primary_role: p.primary_role, secondary_roles: p.secondary_roles ?? [], batting_style: p.batting_style ?? null, bowling_style: p.bowling_style ?? null,
    experience_years: p.experience_years ?? null, preferred_formats: p.preferred_formats ?? [], preferred_days: p.preferred_days ?? [],
    preferred_timing: p.preferred_timing ?? [], previous_teams: p.previous_teams ?? [], bio: p.bio ?? null, locality: p.locality ?? null,
    availability_visibility: p.availability_visibility ?? "discoverable", cricheroes_profile_url: url,
  };
  try { await api("/players/me", { method: "PUT", body }); } catch (e) { throw new Error(errorText(e)); }
}
