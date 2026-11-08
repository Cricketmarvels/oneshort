import { formatDateTime, formatPaise, MOBILE_REGEX, normaliseMobile, ROLE_SHORT, type PlayingRole } from "@cm/shared";
import { Crown, LogOut, Plus, Shield, UserMinus, Users } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { useAuth } from "@/app/store/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { RatingPill, ReliabilityMeter } from "@/components/players/Rating";
import { RoleBadge } from "@/components/players/RoleBadge";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { EmptyState, QueryState, Spinner } from "@/components/ui/states";
import { teams, useTeam, useTeamMembers } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

import { CricHeroesSection } from "./CricHeroesSection";

export function TeamDetailPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const me = useAuth((s) => s.user);
  const team = useTeam(id);
  const members = useTeamMembers(id);
  const [adding, setAdding] = useState(false);
  const inv = [["teams"], ["dashboard"]];
  const remove = useAction((uid: string) => teams.removeMember(id, uid), { invalidate: inv, success: "Member removed" });
  const leave = useAction(() => teams.removeMember(id, me!.id), { invalidate: inv, success: "You left the team", onSuccess: () => nav("/teams") });
  const promote = useAction(({ uid, admin }: { uid: string; admin: boolean }) => teams.setRole(id, uid, admin ? "admin" : "member"), { invalidate: inv, success: "Role updated" });
  return (
    <QueryState query={team} skeleton={<Spinner />}>
      {(t) => (
        <div className="space-y-6">
          <PageHeader back title={t.team_name} subtitle={`${t.area}, ${t.city}`} />
          <Card className="pitch-gradient flex flex-wrap items-center gap-4 p-5 text-white">
            <Avatar name={t.team_name} src={t.logo} size="xl" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2"><Badge tone="brand">{t.category}</Badge>{t.my_membership && <Badge>{t.my_membership}</Badge>}</div>
              <p className="mt-2 text-sm text-white/80">{t.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
                <span className="flex items-center gap-1.5"><Users className="size-4" />{t.member_count} members</span>
                <span className="flex items-center gap-1.5"><Crown className="size-4" />{t.captain.full_name}</span>
                {t.average_rating && <span>★ {t.average_rating.toFixed(1)} team rating</span>}
              </div>
            </div>
            {t.can_manage && <Link to={`/matches/new?team=${t.id}`}><Button variant="accent">Create match</Button></Link>}
          </Card>

          <section>
            <SectionHeader title="Upcoming matches" />
            {t.upcoming_matches.length ? (
              <div className="grid gap-3 md:grid-cols-2">
                {t.upcoming_matches.map((m) => (
                  <Link key={m.id} to={`/matches/${m.id}`}>
                    <Card className="p-4">
                      <p className="font-semibold">{m.title}</p>
                      <p className="text-sm text-ink-500">{formatDateTime(m.start_at)} · {m.area}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge tone="brand">{m.format}</Badge><Badge tone="info">{m.vacancies} open</Badge>
                        {m.per_head_fee_paise > 0 && <Badge>~{formatPaise(m.per_head_fee_paise)}</Badge>}
                        {Object.entries(m.required_roles).filter(([, n]) => n > 0).map(([r, n]) => <Badge key={r}>{n} {ROLE_SHORT[r as PlayingRole]}</Badge>)}
                      </div>
                    </Card>
                  </Link>
                ))}
              </div>
            ) : <EmptyState title="No upcoming matches" />}
          </section>

          <section>
            <SectionHeader title="Members" action={t.can_manage && <Button size="sm" variant="soft" icon={<Plus className="size-4" />} onClick={() => setAdding(true)}>Add member</Button>} />
            <QueryState query={members}>
              {(ms) => (
                <Card className="divide-y divide-sand-200">
                  {ms.map((m) => (
                    <div key={m.user.id} className="flex items-center gap-3 p-3.5">
                      <Avatar name={m.user.full_name} src={m.user.profile_image} />
                      <div className="min-w-0 flex-1">
                        <Link to={`/players/${m.user.id}`} className="font-semibold hover:underline">{m.user.full_name}</Link>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          {m.primary_role && <RoleBadge role={m.primary_role} short />}
                          {m.member_role !== "member" && <Badge tone={m.member_role === "captain" ? "danger" : "info"}>{m.member_role}</Badge>}
                          {m.status === "invited" && <Badge tone="warning">invited</Badge>}
                        </div>
                      </div>
                      <div className="hidden text-right sm:block"><RatingPill value={m.average_rating} />{m.reliability_score != null && <ReliabilityMeter score={m.reliability_score} compact />}</div>
                      {t.captain.id === me?.id && m.member_role !== "captain" && m.status === "active" && (
                        <Button size="icon" variant="ghost" aria-label={m.member_role === "admin" ? "Remove admin" : "Make admin"} title={m.member_role === "admin" ? "Remove admin" : "Make team admin"} onClick={() => promote.mutate({ uid: m.user.id, admin: m.member_role !== "admin" })}><Shield className="size-4" /></Button>
                      )}
                      {t.can_manage && m.member_role !== "captain" && <Button size="icon" variant="ghost" aria-label={`Remove ${m.user.full_name}`} onClick={() => confirm(`Remove ${m.user.full_name}?`) && remove.mutate(m.user.id)}><UserMinus className="size-4" /></Button>}
                    </div>
                  ))}
                </Card>
              )}
            </QueryState>
          </section>
          <CricHeroesSection teamId={t.id} />
          {t.my_membership && t.my_membership !== "captain" && t.my_membership !== "invited" && (
            <Button variant="ghost" className="text-ball-600" icon={<LogOut className="size-4" />} onClick={() => confirm("Leave this team?") && leave.mutate(undefined)}>Leave team</Button>
          )}
          {adding && <AddMemberSheet teamId={id} onClose={() => setAdding(false)} />}
        </div>
      )}
    </QueryState>
  );
}

function AddMemberSheet({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const [mobile, setMobile] = useState("");
  const add = useAction(() => teams.addMember(teamId, { mobile_number: normaliseMobile(mobile), member_role: "member" }), {
    invalidate: [["teams"]], success: "Invitation sent", onSuccess: onClose,
  });
  const valid = MOBILE_REGEX.test(mobile.replace(/\s/g, ""));
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title="Add a team member" description="They'll get a team invitation to accept."
      footer={<Button block size="lg" disabled={!valid} loading={add.isPending} onClick={() => add.mutate(undefined)}>Send invitation</Button>}>
      <Field label="Player's mobile number" hint="They need a CricketMarvels Play account.">{(id) => <Input id={id} inputMode="tel" value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="98765 43210" />}</Field>
    </Sheet>
  );
}
