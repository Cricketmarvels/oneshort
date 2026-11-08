import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "@/utils/cn";

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-[var(--radius-card)] bg-white shadow-[var(--shadow-card)] ring-1 ring-sand-200/70", className)} {...rest} />;
}

export function SectionHeader({ title, action, subtitle }: { title: string; action?: ReactNode; subtitle?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-ink-900">{title}</h2>
        {subtitle && <p className="text-sm text-ink-500">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Stat({ label, value, tone = "default", sub }: { label: string; value: ReactNode; tone?: "default" | "brand" | "danger" | "success"; sub?: ReactNode }) {
  const tones = { default: "text-ink-900", brand: "text-brand-700", danger: "text-ball-600", success: "text-brand-600" };
  return (
    <div className="rounded-2xl bg-sand-100 p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className={cn("tabular mt-1 text-xl font-bold", tones[tone])}>{value}</p>
      {sub && <p className="text-xs text-ink-500">{sub}</p>}
    </div>
  );
}
