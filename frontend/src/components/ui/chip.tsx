import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

export function ToggleChip({ selected, onClick, children, className, icon }: { selected: boolean; onClick: () => void; children: ReactNode; className?: string; icon?: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-sm font-medium ring-1 transition",
        selected ? "bg-brand-800 text-white ring-brand-800" : "bg-white text-ink-700 ring-sand-300 hover:ring-brand-300",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}

export function Segmented<T extends string | number>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-1 rounded-2xl bg-sand-200/70 p-1">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn("h-10 rounded-xl text-sm font-semibold transition", value === o.value ? "bg-white text-brand-800 shadow-sm" : "text-ink-500 hover:text-ink-900")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { value: T; label: string; count?: number }[] }) {
  return (
    <div role="tablist" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-sand-200 px-4">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={cn("relative shrink-0 px-3 pb-3 pt-1 text-sm font-semibold transition", value === t.value ? "text-brand-800" : "text-ink-500 hover:text-ink-900")}
        >
          {t.label}
          {t.count ? <span className="ml-1.5 rounded-full bg-ball-500 px-1.5 text-[11px] text-white">{t.count}</span> : null}
          {value === t.value && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-700" />}
        </button>
      ))}
    </div>
  );
}
