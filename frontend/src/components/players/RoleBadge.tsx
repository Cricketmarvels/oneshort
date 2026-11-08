import { ROLE_LABELS, ROLE_SHORT, type PlayingRole } from "@cm/shared";

import { cn } from "@/utils/cn";

const ROLE_COLORS: Record<PlayingRole, string> = {
  batsman: "bg-amber-100 text-amber-900",
  bowler: "bg-sky-100 text-sky-900",
  wicketkeeper: "bg-violet-100 text-violet-900",
  all_rounder: "bg-brand-100 text-brand-900",
};

export function RoleBadge({ role, short, className }: { role: PlayingRole; short?: boolean; className?: string }) {
  return (
    <span title={ROLE_LABELS[role]} className={cn("inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-bold", ROLE_COLORS[role], className)}>
      {short ? ROLE_SHORT[role] : ROLE_LABELS[role]}
    </span>
  );
}
export { ROLE_COLORS };
