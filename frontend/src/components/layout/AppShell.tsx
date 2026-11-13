import { useQuery } from "@tanstack/react-query";
import { Bell, CalendarDays, Compass, Home, Shield, Swords, UserRound, Users } from "lucide-react";
import { NavLink, Outlet, useLocation } from "react-router";

import { useAuth } from "@/app/store/auth";
import { Avatar } from "@/components/ui/avatar";
import { apiPaged } from "@/services/api/client";
import { cn } from "@/utils/cn";

const NAV = [
  { to: "/", label: "Home", icon: Home, end: true },
  { to: "/discover", label: "Discover", icon: Compass },
  { to: "/matches", label: "Matches", icon: Swords },
  { to: "/teams", label: "Teams", icon: Users },
  { to: "/profile", label: "Profile", icon: UserRound },
];

function useUnread(): number {
  const q = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => apiPaged<unknown, { unread: number }>({ url: "/notifications", params: { page_size: 1, unread_only: true } }),
    refetchInterval: 60_000,
  });
  return q.data?.meta.unread ?? 0;
}

export function AppShell() {
  const user = useAuth((s) => s.user);
  const unread = useUnread();
  const { pathname } = useLocation();
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[17rem_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded-xl focus:bg-white focus:p-3">Skip to content</a>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r border-sand-200 bg-white px-4 py-6 md:flex">
        <Brand />
        <nav aria-label="Primary" className="mt-8 flex flex-1 flex-col gap-1">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn(
              "flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-semibold transition",
              isActive ? "bg-brand-800 text-white" : "text-ink-700 hover:bg-sand-100")}>
              <n.icon className="size-5" aria-hidden /> {n.label}
            </NavLink>
          ))}
          <div className="my-3 border-t border-sand-200" />
          <NavLink to="/availability" className={({ isActive }) => cn("flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium", isActive ? "bg-sand-100 text-brand-800" : "text-ink-700 hover:bg-sand-100")}>
            <CalendarDays className="size-5" aria-hidden /> Availability
          </NavLink>
          <NavLink to="/notifications" className={({ isActive }) => cn("flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium", isActive ? "bg-sand-100 text-brand-800" : "text-ink-700 hover:bg-sand-100")}>
            <Bell className="size-5" aria-hidden /> Notifications
            {unread > 0 && <span className="ml-auto rounded-full bg-ball-500 px-2 text-xs font-bold text-white">{unread}</span>}
          </NavLink>
          {user?.roles.includes("admin") && (
            <NavLink to="/admin" className="flex items-center gap-3 rounded-2xl px-3 py-2.5 text-[15px] font-medium text-ink-700 hover:bg-sand-100">
              <Shield className="size-5" aria-hidden /> Moderation
            </NavLink>
          )}
        </nav>
        {user && (
          <NavLink to="/profile" className="flex items-center gap-3 rounded-2xl p-2 hover:bg-sand-100">
            <Avatar name={user.full_name} src={user.profile_image} size="sm" />
            <span className="truncate text-sm font-semibold">{user.full_name}</span>
          </NavLink>
        )}
      </aside>

      <div className="flex min-h-dvh flex-col">
        {/* Mobile top bar */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-sand-200/80 bg-sand-100/85 px-4 py-3 backdrop-blur md:hidden">
          <Brand compact />
          <NavLink to="/notifications" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} className="relative rounded-full p-2 text-ink-700 hover:bg-sand-200">
            <Bell className="size-6" />
            {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-ball-500 px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}
          </NavLink>
        </header>
        <main id="main" key={pathname.split("/")[1]} className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-4 md:px-8 md:pb-12 md:pt-8">
          <Outlet />
        </main>
        {/* Mobile bottom navigation */}
        <nav aria-label="Primary" className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-sand-200 bg-white/95 backdrop-blur md:hidden">
          <ul className="mx-auto grid max-w-md grid-cols-5">
            {NAV.map((n) => (
              <li key={n.to}>
                <NavLink to={n.to} end={n.end} className={({ isActive }) => cn("flex flex-col items-center gap-0.5 pb-1 pt-2 text-[11px] font-semibold", isActive ? "text-brand-800" : "text-ink-400")}>
                  {({ isActive }) => (
                    <>
                      <span className={cn("grid h-8 w-14 place-items-center rounded-full transition", isActive && "bg-brand-100")}>
                        <n.icon className="size-5" aria-hidden />
                      </span>
                      {n.label}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

export function Brand({ compact }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <img src="/icon.svg" alt="" className="size-8" />
      <span className="font-display text-lg font-extrabold tracking-tight text-brand-800">
        OneShort{!compact && <span className="text-ball-500"> Play</span>}
      </span>
    </span>
  );
}
