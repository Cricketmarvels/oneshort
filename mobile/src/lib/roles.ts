/**
 * Player vs captain accounts. The role comes from the server (chosen at sign-up or granted by an admin);
 * the app only decides what to show. During the beta a player can't switch themselves to captain in-app.
 */
import type { UserMe } from "@cm/shared";

import { useAuth } from "@/lib/auth";

export const isCaptainAccount = (u: Pick<UserMe, "roles"> | null | undefined): boolean =>
  !!u && (u.roles.includes("captain") || u.roles.includes("admin"));

export function useIsCaptain(): boolean {
  const { user } = useAuth();
  return isCaptainAccount(user);
}
