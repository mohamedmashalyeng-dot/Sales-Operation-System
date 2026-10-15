import type { ReactNode } from "react";
import { cn } from "@/utils/format";

const sizes = { xs: "h-3.5 w-3.5", sm: "h-4 w-4", md: "h-6 w-6", lg: "h-9 w-9" };

export function Spinner({ size = "md", className }: { size?: keyof typeof sizes; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" fill="none" aria-hidden="true" data-loading-spinner="" className={cn("shrink-0 motion-safe:animate-spin", sizes[size], className)}>
      <circle cx="20" cy="20" r="16" stroke="currentColor" strokeWidth="3" opacity="0.14" />
      <path d="M20 4a16 16 0 0 1 16 16" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M20 36A16 16 0 0 1 4 20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}

export default function LoadingState({ children = "Loading…", message, inline = false, className }: {
  children?: ReactNode; message?: string; inline?: boolean; className?: string;
}) {
  if (inline) return <span role="status" aria-live="polite" aria-atomic="true" className={cn("inline-flex items-center gap-2 align-middle", className)}><Spinner size="sm" className="text-primary-500" /><span>{children}</span></span>;
  return <div role="status" aria-live="polite" aria-atomic="true" className={cn("flex flex-col items-center justify-center gap-3 px-4 py-8 text-center text-sm text-foreground-600", className)}>
    <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-primary-100 bg-primary-50 text-primary-500 shadow-kbc-sm"><Spinner size="lg" /></span>
    <span className="font-medium">{children}</span>
    {message && <span className="max-w-sm text-xs text-foreground-500">{message}</span>}
  </div>;
}
