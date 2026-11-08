import type { UserMe } from "@cm/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, refresh, setSessionExpiredHandler } from "./api";
import { tokens } from "./tokens";

type Ctx = {
  user: UserMe | null;
  ready: boolean;
  signIn: (access: string, refreshToken: string, user: UserMe) => Promise<void>;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [ready, setReady] = useState(false);
  const signOut = useCallback(async () => {
    const rt = await tokens.getRefresh();
    if (rt) await api("/auth/logout", { method: "POST", body: { refresh_token: rt } }).catch(() => undefined);
    await tokens.clear();
    setUser(null);
  }, []);
  useEffect(() => {
    setSessionExpiredHandler(() => { void tokens.clear(); setUser(null); });
    (async () => {
      const d = await refresh().catch(() => null);
      if (d) setUser(d.user);
      setReady(true);
    })();
  }, []);
  const value = useMemo<Ctx>(() => ({
    user, ready, signOut,
    signIn: async (access, rt, u) => { tokens.setAccess(access); await tokens.setRefresh(rt); setUser(u); },
    reload: async () => setUser(await api<UserMe>("/users/me")),
  }), [user, ready, signOut]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("AuthProvider missing");
  return c;
}
