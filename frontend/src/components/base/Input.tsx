import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/utils/format";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  leftIcon?: string;
  rightSlot?: ReactNode;
}

export default function Input({
  label,
  hint,
  error,
  leftIcon,
  rightSlot,
  className,
  id,
  ...rest
}: InputProps) {
  const inputId = id || rest.name;
  return (
    <div className="w-full">
      {label ? (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500"
        >
          {label}
        </label>
      ) : null}
      <div
        className={cn(
          "flex h-9 items-center gap-2 rounded-md border bg-background-50 px-3 transition-colors focus-within:ring-2 focus-within:ring-primary-200",
          error ? "border-red-400" : "border-background-300 focus-within:border-primary-400",
        )}
      >
        {leftIcon ? (
          <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-400">
            <i className={leftIcon}></i>
          </span>
        ) : null}
        <input
          id={inputId}
          className={cn(
            "h-full w-full bg-transparent text-sm text-foreground-900 placeholder:text-foreground-400 focus:outline-none",
            className,
          )}
          {...rest}
        />
        {rightSlot}
      </div>
      {error ? (
        <p className="mt-1 text-xs font-medium text-red-600">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-foreground-500">{hint}</p>
      ) : null}
    </div>
  );
}