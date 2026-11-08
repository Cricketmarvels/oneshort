import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";

import { useAuth } from "@/app/store/auth";
import { auth } from "@/services/api/endpoints";

export function useLogout() {
  const qc = useQueryClient();
  const nav = useNavigate();
  return async () => {
    const { refreshToken, clear } = useAuth.getState();
    if (refreshToken) await auth.logout(refreshToken).catch(() => undefined);
    clear();
    qc.clear();
    nav("/welcome", { replace: true });
  };
}
