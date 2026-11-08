import { CalendarDays, ChevronRight, Flag, Inbox, LogOut, Pencil, Settings, Shield, Star, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { useAuth } from "@/app/store/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryState, Spinner } from "@/components/ui/states";
import { usePlayerProfile } from "@/services/api/endpoints";

import { ProfileView } from "./ProfileView";
import { useLogout } from "./useLogout";

export function ProfilePage() {
  const user = useAuth((s) => s.user);
  const q = usePlayerProfile();
  const logout = useLogout();
  return (
    <div className="space-y-5">
      <PageHeader title="Profile" action={<Link to="/profile/edit"><Button variant="secondary" size="sm" icon={<Pencil className="size-4" />}>Edit</Button></Link>} />
      <QueryState query={q} skeleton={<Spinner />}>
        {(p) => (
          <>
            {p.missing_fields.length > 0 && (
              <Link to="/profile/edit" className="block rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 ring-1 ring-amber-200">
                Complete your profile: add your {p.missing_fields.map((f) => f.replace("_", " ")).join(", ")}.
              </Link>
            )}
            <ProfileView p={p} />
          </>
        )}
      </QueryState>
      <Card className="divide-y divide-sand-200">
        <Item to="/availability" icon={<CalendarDays />} label="Availability" />
        <Item to="/invitations" icon={<Inbox />} label="Invitations & requests" />
        <Item to="/payments" icon={<Wallet />} label="My payments" />
        {user && <Item to={`/users/${user.id}/reputation`} icon={<Star />} label="My reputation" />}
        {user?.has_captain_profile && user && <Item to={`/users/${user.id}/reputation?type=captain`} icon={<Star />} label="Captain reputation" />}
        <Item to="/report" icon={<Flag />} label="Report misconduct" />
        {user?.roles.includes("admin") && <Item to="/admin" icon={<Shield />} label="Moderation dashboard" />}
        <Item to="/settings" icon={<Settings />} label="Settings & privacy" />
      </Card>
      <Button block variant="ghost" className="text-ball-600" icon={<LogOut className="size-4" />} onClick={() => void logout()}>Log out</Button>
    </div>
  );
}

function Item({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <Link to={to} className="flex items-center gap-3 p-4 hover:bg-sand-50">
      <span className="text-ink-500 [&>svg]:size-5">{icon}</span><span className="flex-1 font-medium">{label}</span><ChevronRight className="size-4 text-ink-400" />
    </Link>
  );
}
