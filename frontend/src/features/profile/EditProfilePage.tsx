import { useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/app/store/auth";
import { ImageUpload } from "@/components/common/ImageUpload";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Spinner } from "@/components/ui/states";
import { initialPlayerForm, LocationSection, type PlayerForm, PreferencesSection, RoleSection } from "@/features/onboarding/PlayerProfileForm";
import { me, usePlayerProfile } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

export function EditProfilePage() {
  const nav = useNavigate();
  const { user, setUser } = useAuth();
  const q = usePlayerProfile();
  const [basics, setBasics] = useState({ full_name: user?.full_name ?? "", email: user?.email ?? "", city: user?.city ?? "", profile_image: user?.profile_image ?? null });
  const [form, setForm] = useState<PlayerForm | null>(null);
  useEffect(() => { if (q.data && !form) setForm(initialPlayerForm(q.data)); }, [q.data, form]);
  const set = (p: Partial<PlayerForm>) => setForm((f) => (f ? { ...f, ...p } : f));
  const save = useAction(async () => {
    await me.update({ full_name: basics.full_name, email: basics.email, city: basics.city, profile_image: basics.profile_image });
    await me.savePlayer(form!);
    return me.get();
  }, { invalidate: [["player"], ["dashboard"]], success: "Profile saved", onSuccess: (u) => { setUser(u); nav("/profile"); } });
  if (!form) return <Spinner />;
  return (
    <div className="space-y-5 pb-6">
      <PageHeader back title="Edit profile" />
      <Card className="space-y-4 p-5">
        <ImageUpload name={basics.full_name} value={basics.profile_image} onChange={(profile_image) => setBasics({ ...basics, profile_image })} />
        <Field label="Full name">{(id) => <Input id={id} value={basics.full_name} onChange={(e) => setBasics({ ...basics, full_name: e.target.value })} />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Email">{(id) => <Input id={id} type="email" value={basics.email} onChange={(e) => setBasics({ ...basics, email: e.target.value })} />}</Field>
          <Field label="City">{(id) => <Input id={id} value={basics.city} onChange={(e) => setBasics({ ...basics, city: e.target.value })} />}</Field>
        </div>
        <p className="text-xs text-ink-500">Mobile number: {user?.mobile_number} (verified)</p>
      </Card>
      <Card className="p-5"><SectionHeader title="Your game" /><RoleSection form={form} set={set} /></Card>
      <Card className="p-5"><SectionHeader title="Location & visibility" /><LocationSection form={form} set={set} /></Card>
      <Card className="p-5"><SectionHeader title="Preferences" /><PreferencesSection form={form} set={set} /></Card>
      <Button block size="lg" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save profile</Button>
    </div>
  );
}
