import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

import { errorMessage } from "@/services/api/client";
import { cn } from "@/utils/cn";

import { Button } from "./button";

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-2xl bg-sand-200", className)} aria-hidden />;
}

export function ListSkeleton({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-20" />)}
    </div>
  );
}

export function Spinner({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-ink-500">
      <Loader2 className="size-5 animate-spin" aria-hidden /> <span className="text-sm">{label}…</span>
    </div>
  );
}

export function EmptyState({ icon, title, body, action, className }: { icon?: ReactNode; title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-sand-300 bg-white/60 px-6 py-10 text-center", className)}>
      {icon && <div className="mb-3 grid size-12 place-items-center rounded-2xl bg-brand-50 text-brand-700">{icon}</div>}
      <p className="font-display font-semibold text-ink-900">{title}</p>
      {body && <p className="mt-1 max-w-sm text-sm text-ink-500">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn("flex flex-col items-center rounded-[var(--radius-card)] bg-ball-50 px-6 py-8 text-center", className)}>
      <AlertTriangle className="mb-2 size-6 text-ball-600" aria-hidden />
      <p className="font-semibold text-ink-900">Couldn't load this</p>
      <p className="mt-1 text-sm text-ink-700">{errorMessage(error)}</p>
      {onRetry && <Button variant="secondary" size="sm" className="mt-4" icon={<RefreshCw className="size-4" />} onClick={onRetry}>Try again</Button>}
    </div>
  );
}

/** Renders loading / error / empty / content for a TanStack query. */
export function QueryState<T>({ query, empty, isEmpty, skeleton, children }: {
  query: { data: T | undefined; isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
  empty?: ReactNode;
  isEmpty?: (d: T) => boolean;
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) return <>{skeleton ?? <ListSkeleton />}</>;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const data = query.data as T;
  if (empty && isEmpty?.(data)) return <>{empty}</>;
  return <>{children(data)}</>;
}
