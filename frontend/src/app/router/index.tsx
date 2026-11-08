import { lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Outlet } from "react-router";

import { AppShell } from "@/components/layout/AppShell";
import { Spinner } from "@/components/ui/states";

import { PublicOnly, RequireAdmin, RequireAuth, RequireOnboarded } from "./guards";
import { RouteError } from "./RouteError";

/** Route-level code splitting: each feature page is its own chunk. */
function page(loader: () => Promise<Record<string, ComponentType>>, name: string) {
  const C = lazy(async () => ({ default: (await loader())[name] as ComponentType }));
  return (
    <Suspense fallback={<Spinner />}>
      <C />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    errorElement: <RouteError />,
    children: [
      {
        element: <PublicOnly />,
        children: [
          { path: "/welcome", element: page(() => import("@/features/auth/WelcomePage"), "WelcomePage") },
          { path: "/login", element: page(() => import("@/features/auth/LoginPage"), "LoginPage") },
          { path: "/register", element: page(() => import("@/features/auth/RegisterPage"), "RegisterPage") },
          { path: "/verify", element: page(() => import("@/features/auth/VerifyOtpPage"), "VerifyOtpPage") },
          { path: "/forgot", element: page(() => import("@/features/auth/ForgotPasswordPage"), "ForgotPasswordPage") },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          { path: "/agreement", element: page(() => import("@/features/onboarding/AgreementPage"), "AgreementPage") },
          { path: "/onboarding/player", element: page(() => import("@/features/onboarding/PlayerOnboardingPage"), "PlayerOnboardingPage") },
          {
            element: <RequireOnboarded />,
            children: [
              {
                element: <AppShell />,
                children: [
                  { index: true, element: page(() => import("@/features/dashboard/HomePage"), "HomePage") },
                  { path: "discover", element: page(() => import("@/features/discover/DiscoverPage"), "DiscoverPage") },
                  { path: "discover/players", element: page(() => import("@/features/player-discovery/FindPlayerPage"), "FindPlayerPage") },
                  { path: "discover/teams", element: page(() => import("@/features/team-discovery/FindTeamPage"), "FindTeamPage") },
                  { path: "availability", element: page(() => import("@/features/availability/AvailabilityPage"), "AvailabilityPage") },
                  { path: "matches", element: page(() => import("@/features/match-management/MatchesPage"), "MatchesPage") },
                  { path: "matches/new", element: page(() => import("@/features/match-management/CreateMatchPage"), "CreateMatchPage") },
                  { path: "matches/:id", element: page(() => import("@/features/match-management/MatchDetailPage"), "MatchDetailPage") },
                  { path: "matches/:id/build", element: page(() => import("@/features/squad-management/BuildTeamPage"), "BuildTeamPage") },
                  { path: "matches/:id/squad", element: page(() => import("@/features/squad-management/SquadPage"), "SquadPage") },
                  { path: "matches/:id/fees", element: page(() => import("@/features/settlements/SplitFeePage"), "SplitFeePage") },
                  { path: "matches/:id/rate", element: page(() => import("@/features/reputation/RateMatchPage"), "RateMatchPage") },
                  { path: "split-fee", element: page(() => import("@/features/settlements/SplitFeeHubPage"), "SplitFeeHubPage") },
                  { path: "payments", element: page(() => import("@/features/settlements/PlayerPaymentsPage"), "PlayerPaymentsPage") },
                  { path: "teams", element: page(() => import("@/features/team-management/TeamsPage"), "TeamsPage") },
                  { path: "teams/new", element: page(() => import("@/features/team-management/CreateTeamPage"), "CreateTeamPage") },
                  { path: "teams/:id", element: page(() => import("@/features/team-management/TeamDetailPage"), "TeamDetailPage") },
                  { path: "invitations", element: page(() => import("@/features/invitations/InvitationsPage"), "InvitationsPage") },
                  { path: "notifications", element: page(() => import("@/features/notifications/NotificationsPage"), "NotificationsPage") },
                  { path: "profile", element: page(() => import("@/features/profile/ProfilePage"), "ProfilePage") },
                  { path: "profile/edit", element: page(() => import("@/features/profile/EditProfilePage"), "EditProfilePage") },
                  { path: "players/:id", element: page(() => import("@/features/profile/PlayerPublicPage"), "PlayerPublicPage") },
                  { path: "users/:id/reputation", element: page(() => import("@/features/reputation/ReputationPage"), "ReputationPage") },
                  { path: "settings", element: page(() => import("@/features/profile/SettingsPage"), "SettingsPage") },
                  { path: "report", element: page(() => import("@/features/reports/ReportPage"), "ReportPage") },
                  { element: <RequireAdmin />, children: [{ path: "admin", element: page(() => import("@/features/admin/AdminPage"), "AdminPage") }] },
                  { path: "*", element: page(() => import("./NotFound"), "NotFound") },
                ],
              },
            ],
          },
        ],
      },
    ],
    element: <Outlet />,
  },
], { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" });
