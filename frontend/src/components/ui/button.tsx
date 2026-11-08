import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

import { cn } from "@/utils/cn";

const variants = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-sm active:scale-[.98]",
  secondary: "bg-white text-ink-900 ring-1 ring-sand-300 hover:bg-sand-50 active:scale-[.98]",
  ghost: "text-ink-700 hover:bg-sand-200/70",
  danger: "bg-ball-600 text-white hover:bg-ball-500 active:scale-[.98]",
  soft: "bg-brand-50 text-brand-800 hover:bg-brand-100",
  accent: "bg-ball-500 text-white hover:bg-ball-600 shadow-sm active:scale-[.98]",
} as const;
const sizes = {
  sm: "h-9 px-3 text-sm rounded-xl gap-1.5",
  md: "h-11 px-4 text-[15px] rounded-2xl gap-2",
  lg: "h-13 px-6 text-base rounded-2xl gap-2",
  icon: "h-10 w-10 rounded-xl",
} as const;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function Button({
  variant = "primary", size = "md", loading, icon, block, className, children, disabled, type = "button", ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center font-semibold transition disabled:cursor-not-allowed disabled:opacity-55",
        variants[variant], sizes[size], block && "w-full", className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}
