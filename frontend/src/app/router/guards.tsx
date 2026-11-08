import { useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router";

import { useAuth } from "@/app/store/auth";
import { SplashScreen } from "@/features/auth/SplashScreen";
import { me } from "@/services/api/endpoints";
import { refreshSession } from "@/services/api/client";

/** Restores the session from the refresh token on first load. */
export function useBootstrap(): boolean {
  const { bootstrapped, refreshToken, accessToken, setBootstrapped, setUser } = useAuth();
  useEffect(() => {
    if (bootstrapped) return;
    (async () => {
      if (refreshToken && !accessToken && (await refreshSession())) {
        try {
          setUser(await me.get());
        } catch {
          /* handled by interceptor */
        }
      }
      setBootstrapped();
    })();
  }, [bootstrapped, refreshToken, accessToken, setBootstrapped, setUser]);
  return bootstrapped;
}

export function RequireAuth() {
  const ready = useBootstrap();
  const user = useAuth((s) => s.user);
  const loc = useLocation();
  if (!ready) return <SplashScreen />;
  if (!user) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  return <Outlet />;
}

/** Matchmaking requires the accepted agreement and a player profile (FR-AGR-1, FR-PLY-1). */
export function RequireOnboarded() {
  const user = useAuth((s) => s.user);
  if (!user) return <Navigate to="/welcome" replace />;
  if (!user.agreement.satisfied) return <Navigate to="/agreement" replace />;
  if (!user.has_player_profile) return <Navigate to="/onboarding/player" replace />;
  return <Outlet />;
}

export function RequireAdmin() {
  const user = useAuth((s) => s.user);
  if (!user?.roles.includes("admin")) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function PublicOnly() {
  const ready = useBootstrap();
  const user = useAuth((s) => s.user);
  if (!ready) return <SplashScreen />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}
