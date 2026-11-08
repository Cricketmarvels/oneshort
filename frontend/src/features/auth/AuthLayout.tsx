import type { ReactNode } from "react";

import { Brand } from "@/components/layout/AppShell";

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh md:grid-cols-2">
      <div className="pitch-gradient relative hidden overflow-hidden p-12 text-white md:flex md:flex-col md:justify-between">
        <span className="rounded-2xl bg-white/95 px-3 py-2 self-start"><Brand /></span>
        <div>
          <p className="font-display text-4xl font-extrabold leading-tight">Short of a player?<br />Need a team for Sunday?</p>
          <p className="mt-4 max-w-md text-white/75">Find available cricketers near your ground, build your squad and split the ground fee, all in one place.</p>
        </div>
        <div className="absolute -bottom-24 -right-24 size-80 rounded-full border-[18px] border-white/10" aria-hidden />
      </div>
      <div className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden"><Brand /></div>
          <h1 className="text-3xl font-extrabold">{title}</h1>
          {subtitle && <p className="mt-2 text-ink-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  );
}
