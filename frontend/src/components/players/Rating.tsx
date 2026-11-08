import { Star } from "lucide-react";

import { cn } from "@/utils/cn";

export function RatingPill({ value, count }: { value?: number | null; count?: number }) {
  if (!value) return <span className="text-xs font-medium text-ink-400">New</span>;
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink-900" aria-label={`Rated ${value.toFixed(1)} out of 5`}>
      <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
      {value.toFixed(1)}
      {count !== undefined && <span className="font-normal text-ink-400">({count})</span>}
    </span>
  );
}

export function ReliabilityMeter({ score, compact }: { score: number; compact?: boolean }) {
  const tone = score >= 80 ? "bg-brand-500" : score >= 60 ? "bg-amber-400" : "bg-ball-500";
  return (
    <div className={cn("flex items-center gap-2", compact && "gap-1.5")} aria-label={`Reliability ${Math.round(score)} out of 100`}>
      <div className={cn("h-1.5 overflow-hidden rounded-full bg-sand-200", compact ? "w-12" : "w-20")}>
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.max(4, Math.min(100, score))}%` }} />
      </div>
      <span className="tabular text-xs font-semibold text-ink-700">{Math.round(score)}</span>
    </div>
  );
}

export function StarInput({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n > 1 ? "s" : ""}`}
          onClick={() => onChange(n)} className="rounded-lg p-1 transition hover:scale-110">
          <Star className={cn("size-7", n <= value ? "fill-amber-400 text-amber-400" : "text-sand-300")} />
        </button>
      ))}
    </div>
  );
}
