import { STATUS_TONE, type Tone } from "@cm/shared";
import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

const tones: Record<Tone, string> = {
  neutral: "bg-sand-200 text-ink-700",
  brand: "bg-brand-100 text-brand-800",
  success: "bg-brand-50 text-brand-700 ring-1 ring-brand-200",
  warning: "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
  danger: "bg-ball-50 text-ball-600 ring-1 ring-ball-500/20",
  info: "bg-sky-50 text-sky-800 ring-1 ring-sky-200",
};

export function Badge({ tone = "neutral", children, className, icon }: { tone?: Tone; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{label ?? status.replace(/_/g, " ")}</Badge>;
}
