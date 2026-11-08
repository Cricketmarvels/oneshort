import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from "react";

import { cn } from "@/utils/cn";

const base =
  "w-full rounded-2xl bg-white px-4 text-[15px] text-ink-900 ring-1 ring-sand-300 placeholder:text-ink-400 transition focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-sand-100 aria-[invalid=true]:ring-ball-500";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest }, ref) {
  return <input ref={ref} className={cn(base, "h-12", className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(base, "min-h-24 py-3", className)} {...rest} />;
  });

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(base, "h-12 appearance-none bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='none' stroke='%235d6b63' stroke-width='2'%3E%3Cpath d='m4 6 4 4 4-4'/%3E%3C/svg%3E\")] bg-[right_1rem_center] bg-no-repeat pr-10", className)} {...rest}>
      {children}
    </select>
  );
});

interface FieldProps {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
  optional?: boolean;
}

/** Accessible label + hint + error wiring for any control. */
export function Field({ label, error, hint, children, className, optional }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-err` : hint ? `${id}-hint` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-700">
        {label} {optional && <span className="font-normal text-ink-400">(optional)</span>}
      </label>
      {children(id, describedBy)}
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-sm text-ball-600">{error}</p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}
