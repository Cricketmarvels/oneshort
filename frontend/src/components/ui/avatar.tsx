import { initials } from "@cm/shared";
import { useState } from "react";

import { cn } from "@/utils/cn";

const sizes = { sm: "size-8 text-xs", md: "size-11 text-sm", lg: "size-16 text-lg", xl: "size-24 text-2xl" };

export function Avatar({ name, src, size = "md", className }: { name: string; src?: string | null; size?: keyof typeof sizes; className?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 font-bold text-brand-800 ring-2 ring-white", sizes[size], className)}>
      {src && !broken ? (
        <img src={src} alt="" className="size-full object-cover" onError={() => setBroken(true)} loading="lazy" />
      ) : (
        <span aria-hidden>{initials(name)}</span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
