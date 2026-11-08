import type { UserMe } from "@cm/shared";
import { create } from "zustand";

/**
 * Auth state. The access token lives in memory only. The refresh token is persisted so
 * sessions survive reloads; it is rotated on every use and the backend revokes the
 * whole token family on reuse (theft detection). Mobile stores it in the OS keychain.
 */
const REFRESH_KEY = "cm.refresh";

function readRefresh(): string | null {
  try {
    return localStorage.getItem(REFRESH_KEY);
  } catch {
    return null;
  }
}

function writeRefresh(token: string | null): void {
  try {
    if (token) localStorage.setItem(REFRESH_KEY, token);
    else localStorage.removeItem(REFRESH_KEY);
  } catch {
    /* storage unavailable (private mode) — session lasts until reload */
  }
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: UserMe | null;
  bootstrapped: boolean;
  setSession: (access: string, refresh: string, user: UserMe) => void;
  setUser: (user: UserMe) => void;
  setBootstrapped: () => void;
  clear: () => void;
}

export const useAuth = create<AuthState>((set) => ({
  accessToken: null,
  refreshToken: readRefresh(),
  user: null,
  bootstrapped: false,
  setSession: (accessToken, refreshToken, user) => {
    writeRefresh(refreshToken);
    set({ accessToken, refreshToken, user });
  },
  setUser: (user) => set({ user }),
  setBootstrapped: () => set({ bootstrapped: true }),
  clear: () => {
    writeRefresh(null);
    set({ accessToken: null, refreshToken: null, user: null });
  },
}));
