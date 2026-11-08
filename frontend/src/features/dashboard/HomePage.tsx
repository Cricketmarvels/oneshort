import { formatDateTime, formatPaise, timeRange } from "@cm/shared";
import { CalendarDays, CircleDollarSign, Compass, Inbox, Plus, UserPlus, Users } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { MatchCard } from "@/components/matches/MatchCard";
import { TeamCard } from "@/components/teams/TeamCard";
import { StatusBadge } from "@/components/ui/badge";
import { Card, SectionHeader } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { InvitationCard } from "@/features/invitations/InvitationCard";
import { useDashboard } from "@/services/api/endpoints";

const ACTIONS = [
  { to: "/discover/players", label: "Find a Player", body: "Fill your squad nearby", icon: UserPlus, tone: "from-brand-700 to-brand-900" },
  { to: "/discover/teams", label: "Find a Team", body: "Get a game this week", icon: Compass, tone: "from-[#2d6a8f] to-[#1b3f57]" },
  { to: "/split-fee", label: "Split a Fee", body: "Expenses & payments", icon: CircleDollarSign, tone: "from-[#b9772b] to-[#7a4a14]" },
  { to: "/matches/new", label: "Build a Team", body: "Create a match & invite", icon: Users, tone: "from-ball-500 to-ball-600" },
];

export function HomePage() {
  const q = useDashboard();
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm font-medium text-ink-500">{greeting()}</p>
        <h1 className="text-3xl font-extrabold">{d ? `Hey ${d.greeting_name} 👋` : <Skeleton className="h-9 w-48" />}</h1>
      </div>

      <nav aria-label="Main actions" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {ACTIONS.map((a) => (
          <Link key={a.to} to={a.to} className={`group relative overflow-hidden rounded-3xl bg-gradient-to-br ${a.tone} p-4 text-white shadow-[var(--shadow-float)] transition hover:-translate-y-0.5`}>
            <a.icon className="size-7" aria-hidden />
            <p className="mt-6 font-display text-lg font-bold leading-tight">{a.label}</p>
            <p className="text-xs text-white/75">{a.body}</p>
            <span className="absolute -right-6 -top-6 size-20 rounded-full bg-white/10 transition group-hover:scale-125" aria-hidden />
          </Link>
        ))}
      </nav>

      {d && (d.pending_invitations_count > 0 || d.pending_join_requests_count > 0 || d.outstanding_paise > 0) && (
        <div className="grid gap-3 sm:grid-cols-3">
          {d.pending_invitations_count > 0 && <Alert to="/invitations" icon={<Inbox className="size-5" />} title={`${d.pending_invitations_count} pending invitation${d.pending_invitations_count > 1 ? "s" : ""}`} body="Respond before they expire" />}
          {d.pending_join_requests_count > 0 && <Alert to="/invitations?tab=requests" icon={<UserPlus className="size-5" />} title={`${d.pending_join_requests_count} join request${d.pending_join_requests_count > 1 ? "s" : ""}`} body="Players want to join your squad" />}
          {d.outstanding_paise > 0 && <Alert to="/payments" icon={<CircleDollarSign className="size-5" />} title={`${formatPaise(d.outstanding_paise)} to pay`} body="Pending match contributions" tone="danger" />}
        </div>
      )}

      <section>
        <SectionHeader title="Upcoming matches" action={<Link to="/matches" className="text-sm font-semibold text-brand-700">See all</Link>} />
        {!d ? <Skeleton className="h-28" /> : d.upcoming_matches.length ? (
          <div className="grid gap-3 md:grid-cols-2">{d.upcoming_matches.map((m) => <MatchCard key={m.id} match={m} />)}</div>
        ) : <EmptyState icon={<CalendarDays />} title="No matches lined up" body="Find a team near you or create your own match." action={<Link to="/discover/teams" className="font-semibold text-brand-700">Find a team →</Link>} />}
      </section>

      {d && d.pending_invitations.length > 0 && (
        <section>
          <SectionHeader title="Pending invitations" action={<Link to="/invitations" className="text-sm font-semibold text-brand-700">All</Link>} />
          <div className="grid gap-3 md:grid-cols-2">{d.pending_invitations.map((i) => <InvitationCard key={i.id} inv={i} />)}</div>
        </section>
      )}
      {d && d.pending_join_requests.length > 0 && (
        <section>
          <SectionHeader title="Join requests" />
          <div className="grid gap-3 md:grid-cols-2">{d.pending_join_requests.map((i) => <InvitationCard key={i.id} inv={i} />)}</div>
        </section>
      )}

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <SectionHeader title="My availability" subtitle="Next 7 days" action={<Link to="/availability" className="text-sm font-semibold text-brand-700">Manage</Link>} />
          {!d ? <Skeleton className="h-24" /> : d.availability_next_7_days.length ? (
            <Card className="divide-y divide-sand-200">
              {d.availability_next_7_days.map((a) => (
                <div key={a.id} className="flex items-center justify-between p-3.5">
                  <div><p className="text-sm font-semibold">{formatDateTime(a.start_at, a.timezone, { hour: undefined, minute: undefined })}</p>
                    <p className="text-xs text-ink-500">{timeRange(a.start_at, a.end_at, a.timezone)} · {a.location_label ?? "Preferred area"}</p></div>
                  <StatusBadge status={a.status} />
                </div>
              ))}
            </Card>
          ) : <EmptyState icon={<CalendarDays />} title="Tell captains when you're free" action={<Link to="/availability" className="inline-flex items-center gap-1 font-semibold text-brand-700"><Plus className="size-4" />Add availability</Link>} />}
        </section>
        <section>
          <SectionHeader title="My teams" action={<Link to="/teams" className="text-sm font-semibold text-brand-700">All teams</Link>} />
          {!d ? <Skeleton className="h-24" /> : d.my_teams.length ? (
            <div className="space-y-3">{d.my_teams.slice(0, 3).map((t) => <TeamCard key={t.id} team={t} />)}</div>
          ) : <EmptyState icon={<Users />} title="You're not in a team yet" action={<Link to="/teams/new" className="font-semibold text-brand-700">Start a team →</Link>} />}
        </section>
      </div>

      {d && d.pending_payments.length > 0 && (
        <section>
          <SectionHeader title="Pending payments" action={<Link to="/payments" className="text-sm font-semibold text-brand-700">Payments</Link>} />
          <Card className="divide-y divide-sand-200">
            {d.pending_payments.map((p) => (
              <Link key={p.id} to="/payments" className="flex items-center justify-between p-4 hover:bg-sand-50">
                <div><p className="font-semibold">{p.team_name}</p><p className="text-sm text-ink-500">{p.match_title}</p></div>
                <div className="text-right"><p className="tabular font-bold">{formatPaise(p.balance_paise)}</p><StatusBadge status={p.status} /></div>
              </Link>
            ))}
          </Card>
        </section>
      )}

      {d && d.recent_activity.length > 0 && (
        <section>
          <SectionHeader title="Recent activity" action={<Link to="/notifications" className="text-sm font-semibold text-brand-700">All</Link>} />
          <Card className="divide-y divide-sand-200">
            {d.recent_activity.map((n) => (
              <div key={n.id} className="flex gap-3 p-3.5">
                <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-sand-300" : "bg-ball-500"}`} aria-hidden />
                <div><p className="text-sm font-semibold">{n.title}</p><p className="text-sm text-ink-500">{n.body}</p></div>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
}

function Alert({ to, icon, title, body, tone = "brand" }: { to: string; icon: ReactNode; title: string; body: string; tone?: "brand" | "danger" }) {
  return (
    <Link to={to} className={`flex items-center gap-3 rounded-2xl p-4 ring-1 ${tone === "danger" ? "bg-ball-50 ring-ball-500/20" : "bg-brand-50 ring-brand-200"}`}>
      <span className={`grid size-10 place-items-center rounded-xl ${tone === "danger" ? "bg-ball-500 text-white" : "bg-brand-700 text-white"}`}>{icon}</span>
      <div><p className="font-semibold">{title}</p><p className="text-xs text-ink-500">{body}</p></div>
    </Link>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}
