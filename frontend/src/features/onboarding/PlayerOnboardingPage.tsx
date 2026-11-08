import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { useAuth } from "@/app/store/auth";
import { ImageUpload } from "@/components/common/ImageUpload";
import { Brand } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { errorMessage } from "@/services/api/client";
import { me } from "@/services/api/endpoints";

import { initialPlayerForm, LocationSection, type PlayerForm, PreferencesSection, RoleSection } from "./PlayerProfileForm";

const STEPS = ["Photo", "Your game", "Location", "Preferences"] as const;

export function PlayerOnboardingPage() {
  const nav = useNavigate();
  const { user, setUser } = useAuth();
  const [step, setStep] = useState(0);
  const [photo, setPhoto] = useState(user?.profile_image ?? null);
  const [form, setFormState] = useState<PlayerForm>(initialPlayerForm());
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<PlayerForm>) => setFormState((f) => ({ ...f, ...p }));

  const canNext = step === 0 ? !!photo : step === 2 ? !!form.home_location : true;
  const finish = async () => {
    setBusy(true);
    try {
      if (photo !== user?.profile_image) await me.update({ profile_image: photo });
      await me.savePlayer(form);
      setUser(await me.get());
      toast.success("Profile ready. Let's find you a game!");
      nav("/", { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <Brand />
      <h1 className="mt-8 text-2xl font-extrabold">Set up your player profile</h1>
      <ol className="mt-4 flex gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex-1">
            <div className={`h-1.5 rounded-full ${i <= step ? "bg-brand-600" : "bg-sand-300"}`} />
            <span className={`mt-1 block text-xs ${i === step ? "font-semibold text-brand-800" : "text-ink-400"}`} aria-current={i === step ? "step" : undefined}>{s}</span>
          </li>
        ))}
      </ol>
      <Card className="mt-6 p-5">
        {step === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-ink-500">Captains are more likely to invite players with a clear photo.</p>
            <ImageUpload name={user?.full_name ?? ""} value={photo} onChange={setPhoto} />
          </div>
        )}
        {step === 1 && <RoleSection form={form} set={set} />}
        {step === 2 && <LocationSection form={form} set={set} />}
        {step === 3 && <PreferencesSection form={form} set={set} />}
      </Card>
      <div className="mt-5 flex gap-3">
        {step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>Back</Button>}
        {step < STEPS.length - 1 ? (
          <Button className="flex-1" disabled={!canNext} onClick={() => setStep(step + 1)}>Continue</Button>
        ) : (
          <Button className="flex-1" loading={busy} onClick={() => void finish()}>Finish</Button>
        )}
      </div>
      {!canNext && <p className="mt-2 text-center text-xs text-ink-500">{step === 0 ? "A profile photo is required." : "Set your location to continue."}</p>}
    </div>
  );
}
