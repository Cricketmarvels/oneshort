import { PLAYING_ROLES, ROLE_LABELS, ROLE_SHORT, type S } from "@cm/shared";

import { cn } from "@/utils/cn";

import { ROLE_COLORS } from "../players/RoleBadge";

/**
 * Visual squad composition: a pitch-style board of seats per role. Filled seats show
 * confirmed players; outlined seats are still open. Total capacity is shown as a bar.
 */
export function SquadComposition({ comp, compact }: { comp: S<"CompositionOut">; compact?: boolean }) {
  const required = comp.required as Record<string, number>;
  const confirmed = comp.confirmed as Record<string, number>;
  const pct = Math.round((comp.confirmed_total / Math.max(1, comp.capacity)) * 100);
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1.5 flex items-baseline justify-between text-sm">
          <span className="font-semibold text-ink-900">
            <span className="tabular text-2xl font-extrabold text-brand-800">{comp.confirmed_total}</span>
            <span className="text-ink-500">/{comp.capacity} confirmed</span>
          </span>
          <span className={cn("font-semibold", comp.vacancies ? "text-ball-600" : "text-brand-700")}>
            {comp.vacancies ? `${comp.vacancies} open` : "Squad full"}
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-sand-200" role="progressbar" aria-valuenow={comp.confirmed_total} aria-valuemin={0} aria-valuemax={comp.capacity}>
          <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {!compact && (
        <div className="pitch-gradient relative grid grid-cols-2 gap-3 overflow-hidden rounded-2xl p-4 sm:grid-cols-4">
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-8 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-[#c9b98a]/25" aria-hidden />
          {PLAYING_ROLES.map((r) => {
            const need = required[r] ?? 0;
            const have = confirmed[r] ?? 0;
            const seats = Math.max(need, have);
            return (
              <div key={r} className="relative rounded-xl bg-white/10 p-3 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-wider text-white/80">{ROLE_LABELS[r]}</p>
                <p className="tabular mt-0.5 text-lg font-bold text-white">{have}<span className="text-white/60">{need ? `/${need}` : ""}</span></p>
                <div className="mt-2 flex flex-wrap gap-1.5" aria-hidden>
                  {Array.from({ length: seats || 1 }, (_, i) => (
                    <span key={i} className={cn("grid size-7 place-items-center rounded-full text-[10px] font-bold",
                      i < have ? ROLE_COLORS[r] : "border-2 border-dashed border-white/40 text-white/50")}>
                      {ROLE_SHORT[r]}
                    </span>
                  ))}
                </div>
                {need > have && <p className="mt-1.5 text-[11px] font-medium text-amber-200">Need {need - have} more</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
