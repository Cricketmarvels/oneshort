import { relativeTime } from "@cm/shared";
import { Bell, CheckCheck } from "lucide-react";
import { useNavigate } from "react-router";

import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, QueryState } from "@/components/ui/states";
import { notifications, useNotifications } from "@/services/api/endpoints";
import { useAction } from "@/services/api/hooks";
import { cn } from "@/utils/cn";

function target(data: Record<string, unknown>): string | null {
  if (typeof data.settlement_id === "string" && typeof data.match_id === "string") return `/matches/${data.match_id}/fees`;
  if (data.action === "rate" && typeof data.match_id === "string") return `/matches/${data.match_id}/rate`;
  if (typeof data.invitation_id === "string") return "/invitations";
  if (typeof data.match_id === "string") return `/matches/${data.match_id}`;
  if (typeof data.team_id === "string") return `/teams/${data.team_id}`;
  return null;
}

export function NotificationsPage() {
  const nav = useNavigate();
  const q = useNotifications();
  const inv = [["notifications"], ["dashboard"]];
  const readAll = useAction(() => notifications.readAll(), { invalidate: inv });
  const read = useAction((id: string) => notifications.read(id), { invalidate: inv, silent: true });
  return (
    <div>
      <PageHeader title="Notifications" action={<Button size="sm" variant="secondary" icon={<CheckCheck className="size-4" />} onClick={() => readAll.mutate(undefined)}>Mark all read</Button>} />
      <QueryState query={q} isEmpty={(d) => d.data.length === 0} empty={<EmptyState icon={<Bell />} title="You're all caught up" />}>
        {(d) => (
          <Card className="divide-y divide-sand-200">
            {d.data.map((n) => {
              const to = target(n.data);
              return (
                <button key={n.id} className={cn("flex w-full gap-3 p-4 text-left hover:bg-sand-50", !n.read && "bg-brand-50/50")}
                  onClick={() => { if (!n.read) read.mutate(n.id); if (to) nav(to); }}>
                  <span className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-ball-500")} aria-label={n.read ? undefined : "Unread"} />
                  <div className="flex-1"><p className="font-semibold">{n.title}</p><p className="text-sm text-ink-700">{n.body}</p></div>
                  <span className="shrink-0 text-xs text-ink-400">{relativeTime(n.created_at)}</span>
                </button>
              );
            })}
          </Card>
        )}
      </QueryState>
    </div>
  );
}
