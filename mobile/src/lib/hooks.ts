import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import { useLocation } from "./location";
import type { Home } from "./types";

/** Home payload, shared cache with the Home tab (managed teams, rank, etc.). */
export function useHome() {
  const { lat, lng } = useLocation();
  return useQuery({ queryKey: ["home", lat, lng], queryFn: () => api<Home>("/home", { query: { lat, lng } }) });
}

export function useManagedTeam(): string | undefined {
  return useHome().data?.managed_team_ids[0];
}
