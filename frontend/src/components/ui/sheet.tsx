import * as D from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/utils/cn";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Bottom sheet on mobile, centered dialog on desktop. */
  size?: "md" | "lg";
}

export function Sheet({ open, onOpenChange, title, description, children, footer, size = "md" }: SheetProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink-900/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <D.Content
          className={cn(
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-[1.75rem] bg-white shadow-2xl outline-none",
            "md:inset-auto md:left-1/2 md:top-1/2 md:w-full md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-[1.75rem]",
            size === "lg" ? "md:max-w-2xl" : "md:max-w-lg",
          )}
        >
          <div className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-sand-300 md:hidden" aria-hidden />
          <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-4">
            <div>
              <D.Title className="font-display text-lg font-bold">{title}</D.Title>
              {description ? <D.Description className="text-sm text-ink-500">{description}</D.Description>
                : <D.Description className="sr-only">{title}</D.Description>}
            </div>
            <D.Close className="rounded-full p-2 text-ink-500 hover:bg-sand-100" aria-label="Close">
              <X className="size-5" />
            </D.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-4">{children}</div>
          {footer && <div className="safe-bottom border-t border-sand-200 px-5 pt-3">{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
