import { DEFAULT_CITY, MATCH_CATEGORIES, type S } from "@cm/shared";
import { useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/app/store/auth";
import { ImageUpload } from "@/components/common/ImageUpload";
import { type LatLng, LocationPicker } from "@/components/maps/LocationPicker";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/chip";
import { Field, Input, Textarea } from "@/components/ui/field";
import { me, teams } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

/** Captain onboarding: creating a team grants the captain role on the same account. */
export function CreateTeamPage() {
  const nav = useNavigate();
  const setUser = useAuth((s) => s.setUser);
  const [f, setF] = useState({ name: "", logo: null as string | null, description: "", area: "", city: DEFAULT_CITY, category: "friendly" as S<"MatchCategory"> });
  const [loc, setLoc] = useState<LatLng | null>(null);
  const create = useAction(() => teams.create({ team_name: f.name, logo: f.logo, description: f.description || null, area: f.area, city: f.city, category: f.category, looking_for_opponents: true, location: loc! }), {
    invalidate: [["teams"], ["dashboard"]], success: "Team created. You're the captain!",
    onSuccess: async (t) => { setUser(await me.get()); nav(`/teams/${t.id}`, { replace: true }); },
  });
  const valid = f.name.trim().length >= 2 && f.area.trim() && f.city.trim() && loc;
  return (
    <div className="space-y-5">
      <PageHeader back title="Create a team" subtitle="You'll become the captain. Your player profile stays the same." />
      <Card className="space-y-4 p-5">
        <ImageUpload name={f.name || "Team"} value={f.logo} purpose="team" onChange={(logo) => setF({ ...f, logo })} />
        <Field label="Team name">{(id) => <Input id={id} maxLength={60} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Sector 18 Kings" />}</Field>
        <div><p className="mb-2 text-sm font-medium text-ink-700">Category</p>
          <Segmented label="Category" value={f.category} onChange={(category) => setF({ ...f, category })} options={MATCH_CATEGORIES.map((c) => ({ value: c, label: c[0]!.toUpperCase() + c.slice(1) }))} />
        </div>
        <Field label="Description" optional>{(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Sunday-morning tennis-ball T20, all levels welcome." />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Area">{(id) => <Input id={id} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value })} placeholder="Sector 62" />}</Field>
          <Field label="City">{(id) => <Input id={id} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />}</Field>
        </div>
        <p className="text-sm font-medium text-ink-700">Home ground location</p>
        <LocationPicker value={loc} onChange={setLoc} height={220} />
      </Card>
      <Button block size="lg" disabled={!valid} loading={create.isPending} onClick={() => create.mutate(undefined)}>Create team</Button>
    </div>
  );
}
