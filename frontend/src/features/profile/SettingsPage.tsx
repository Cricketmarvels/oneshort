import type { S } from "@cm/shared";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Trash2 } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/app/store/auth";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, SectionHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { agreements, me } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";

import { useLogout } from "./useLogout";

const TYPES: Array<[S<"NotificationType">, string]> = [
  ["player_invitation", "Match invitations"], ["join_request", "Join requests"], ["match_reminder", "Match reminders"],
  ["payment_reminder", "Payment reminders"], ["settlement_created", "New match fees"], ["rating_received", "Ratings received"],
];

export function SettingsPage() {
  const { user, setUser } = useAuth();
  const logout = useLogout();
  const [prefs, setPrefs] = useState(user!.notification_prefs);
  const [deleting, setDeleting] = useState(false);
  const agr = useQuery({ queryKey: ["agreement", "mine"], queryFn: agreements.mine });
  const save = useAction(() => me.update({ notification_prefs: prefs }), { success: "Preferences saved", onSuccess: setUser });
  const exportData = useAction(() => me.exportData(), {
    success: "Your data export is downloading",
    onSuccess: (d) => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }));
      const a = Object.assign(document.createElement("a"), { href: url, download: "cricketmarvels-my-data.json" });
      a.click();
      URL.revokeObjectURL(url);
    },
  });
  const muted = new Set(prefs.muted_types ?? []);
  return (
    <div className="space-y-5">
      <PageHeader back title="Settings & privacy" />
      <Card className="space-y-4 p-5">
        <SectionHeader title="Notifications" />
        <label className="flex items-center justify-between"><span>Push notifications</span><input type="checkbox" className="size-5 accent-brand-700" checked={prefs.push ?? true} onChange={(e) => setPrefs({ ...prefs, push: e.target.checked })} /></label>
        <div className="divide-y divide-sand-200 rounded-2xl ring-1 ring-sand-200">
          {TYPES.map(([t, label]) => (
            <label key={t} className="flex items-center justify-between p-3 text-sm">{label}
              <input type="checkbox" className="size-5 accent-brand-700" checked={!muted.has(t)} onChange={(e) => {
                const next = new Set(muted); if (e.target.checked) next.delete(t); else next.add(t);
                setPrefs({ ...prefs, muted_types: [...next] });
              }} />
            </label>
          ))}
        </div>
        <Button onClick={() => save.mutate(undefined)} loading={save.isPending}>Save preferences</Button>
      </Card>
      <Card className="space-y-3 p-5">
        <SectionHeader title="Privacy" />
        <p className="text-sm text-ink-500">Your exact location is never shown to other users. You can make your availability private from Edit profile.</p>
        <Button variant="secondary" icon={<Download className="size-4" />} loading={exportData.isPending} onClick={() => exportData.mutate(undefined)}>Download my data</Button>
        <p className="flex items-center gap-2 text-sm text-ink-700"><FileText className="size-4 text-ink-400" />
          User Agreement v{agr.data?.current_version ?? "…"}: accepted {agr.data?.acceptances[0] ? new Date(agr.data.acceptances[0].accepted_at).toLocaleDateString("en-IN") : "—"}</p>
      </Card>
      <Card className="space-y-3 p-5 ring-ball-500/20">
        <SectionHeader title="Delete account" />
        <p className="text-sm text-ink-500">Removes your personal details, location and availability. Payment and audit records are kept in anonymised form as required.</p>
        <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>Delete my account</Button>
      </Card>
      {deleting && <DeleteSheet onClose={() => setDeleting(false)} onDeleted={() => void logout()} />}
    </div>
  );
}

function DeleteSheet({ onClose, onDeleted }: { onClose: () => void; onDeleted: () => void }) {
  const [confirm, setConfirm] = useState("");
  const del = useAction(() => me.delete("user requested"), { success: "Account deleted", onSuccess: onDeleted });
  return (
    <Sheet open onOpenChange={(v) => !v && onClose()} title="Delete account?" description="This can't be undone."
      footer={<Button block size="lg" variant="danger" disabled={confirm !== "DELETE"} loading={del.isPending} onClick={() => del.mutate(undefined)}>Permanently delete</Button>}>
      <Field label='Type "DELETE" to confirm'>{(id) => <Input id={id} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />}</Field>
    </Sheet>
  );
}
