import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router";

export function PageHeader({ title, subtitle, back, action }: { title: string; subtitle?: ReactNode; back?: boolean | string; action?: ReactNode }) {
  const nav = useNavigate();
  return (
    <div className="mb-5 flex items-start gap-3">
      {back && (
        <button onClick={() => (typeof back === "string" ? nav(back) : nav(-1))} aria-label="Back"
          className="-ml-1 mt-0.5 rounded-full p-2 text-ink-700 hover:bg-sand-200">
          <ArrowLeft className="size-5" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <h1 className="text-2xl font-extrabold text-ink-900 md:text-3xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-ink-500">{subtitle}</div>}
      </div>
      {action}
    </div>
  );
}
