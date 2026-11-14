import type { UserMe } from "@cm/shared";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, refresh, setSessionExpiredHandler } from "./api";
import { unregisterPush } from "./device";
import { googleSignOut } from "./google";
import { tokens } from "./tokens";

type Ctx = {
  user: UserMe | null;
  ready: boolean;
  /** Startup couldn't reach the server, so the saved session is neither restored nor discarded yet. */
  offline: boolean;
  retry: () => void;
  signIn: (access: string, refreshToken: string, user: UserMe) => Promise<void>;
  reload: () => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthCtx = createContext<Ctx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserMe | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);
  const restore = useCallback(async () => {
    setOffline(false);
    try {
      const d = await refresh();
      if (d) setUser(d.user);
      setReady(true);
    } catch {
      setOffline(true); // keep the saved session: it is retried, never thrown away, while offline
    }
  }, []);
  const signOut = useCallback(async () => {
    await unregisterPush(); // before the tokens go: the request needs the session
    const rt = await tokens.getRefresh();
    if (rt) await api("/auth/logout", { method: "POST", body: { refresh_token: rt } }).catch(() => undefined);
    await tokens.clear();
    await googleSignOut(); // so the next Google sign-in shows the account picker again
    setUser(null);
  }, []);
  useEffect(() => {
    setSessionExpiredHandler(() => { void tokens.clear(); setUser(null); });
    void restore();
  }, [restore]);
  const value = useMemo<Ctx>(() => ({
    user, ready, offline, retry: () => void restore(), signOut,
    signIn: async (access, rt, u) => { tokens.setAccess(access); await tokens.setRefresh(rt); setUser(u); },
    reload: async () => setUser(await api<UserMe>("/users/me")),
  }), [user, ready, offline, restore, signOut]);
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  const c = useContext(AuthCtx);
  if (!c) throw new Error("AuthProvider missing");
  return c;
}
