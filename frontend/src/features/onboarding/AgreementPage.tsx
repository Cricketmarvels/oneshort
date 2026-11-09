import { useQuery } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";

import { useAuth } from "@/app/store/auth";
import { Brand } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QueryState } from "@/components/ui/states";
import { agreements, me } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

export function AgreementPage() {
  const nav = useNavigate();
  const setUser = useAuth((s) => s.setUser);
  const user = useAuth((s) => s.user);
  const [checked, setChecked] = useState(false);
  const [priv, setPriv] = useState(false);
  const [adult, setAdult] = useState(false);
  const q = useQuery({ queryKey: ["agreement", "current"], queryFn: agreements.current });
  const accept = useAction(async (v: number) => { await agreements.accept(v, { age_confirmed: adult, privacy_acknowledged: priv }); return me.get(); }, {
    success: "Thanks! You're all set.",
    onSuccess: (u) => { setUser(u); nav(u.has_player_profile ? "/" : "/onboarding/player", { replace: true }); },
  });
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Brand />
      <div className="mt-8 flex items-center gap-3">
        <span className="grid size-12 place-items-center rounded-2xl bg-brand-100 text-brand-800"><ShieldCheck className="size-6" /></span>
        <div>
          <h1 className="text-2xl font-extrabold">Platform User Agreement</h1>
          <p className="text-sm text-ink-500">{user?.agreement.accepted_version ? "We've updated our agreement. Please review the changes." : "Please read and accept before you start matchmaking."}</p>
        </div>
      </div>
      <QueryState query={q}>
        {(a) => (
          <>
            <Card className="mt-6 max-h-[55dvh] overflow-y-auto p-6" tabIndex={0} aria-label="Agreement text">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Version {a.version}</p>
              <h2 className="mt-1 text-lg font-bold">{a.title}</h2>
              <div className="mt-4 space-y-5">
                {a.sections.map((s) => (
                  <section key={s.heading}>
                    <h3 className="font-sans font-semibold text-ink-900">{s.heading}</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-ink-700">{s.body}</p>
                  </section>
                ))}
              </div>
            </Card>
            <label className="mt-5 flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-sand-300">
              <input type="checkbox" className="mt-1 size-5 accent-brand-700" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
              <span className="text-sm text-ink-700">I have read and agree to the PlayR Terms of Use.</span>
            </label>
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-sand-300">
              <input type="checkbox" className="mt-1 size-5 accent-brand-700" checked={priv} onChange={(e) => setPriv(e.target.checked)} />
              <span className="text-sm text-ink-700">I have read the <a className="font-semibold text-brand-700 underline" href="/legal/privacy" target="_blank" rel="noreferrer">Privacy Notice</a> and consent to PlayR using my data as it describes.</span>
            </label>
            <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl bg-white p-4 ring-1 ring-sand-300">
              <input type="checkbox" className="mt-1 size-5 accent-brand-700" checked={adult} onChange={(e) => setAdult(e.target.checked)} />
              <span className="text-sm text-ink-700">I am 18 or older.</span>
            </label>
            <Button className="mt-4" block size="lg" disabled={!checked || !priv || !adult} loading={accept.isPending} onClick={() => accept.mutate(a.version)}>Accept and continue</Button>
          </>
        )}
      </QueryState>
    </div>
  );
}
