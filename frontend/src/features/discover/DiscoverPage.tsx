import { CalendarDays, Compass, UserPlus } from "lucide-react";
import { Link } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { Card } from "@/components/ui/card";

export function DiscoverPage() {
  const items = [
    { to: "/discover/players", icon: UserPlus, title: "Find a Player", body: "Captains: search available players within 5–20 km of your venue, ranked by fit." },
    { to: "/discover/teams", icon: Compass, title: "Find a Team", body: "Players: see nearby matches with open spots for your role." },
    { to: "/availability", icon: CalendarDays, title: "My availability", body: "Keep your calendar up to date so captains can find you." },
  ];
  return (
    <div>
      <PageHeader title="Discover" subtitle="Hyperlocal cricket, like ride-hailing for your next game." />
      <div className="grid gap-3 md:grid-cols-3">
        {items.map((i) => (
          <Link key={i.to} to={i.to}>
            <Card className="h-full p-5 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-float)]">
              <span className="grid size-12 place-items-center rounded-2xl bg-brand-100 text-brand-800"><i.icon className="size-6" /></span>
              <p className="mt-4 font-display text-lg font-bold">{i.title}</p>
              <p className="mt-1 text-sm text-ink-500">{i.body}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
