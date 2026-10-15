import type { ReactNode } from "react";
import { cn } from "@/utils/format";
import { Spinner } from "@/components/base/LoadingState";

export interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
  tone?: "neutral" | "error";
  loading?: boolean;
}

export default function EmptyState({
  icon = "ri-inbox-archive-line",
  title,
  message,
  action,
  className,
  tone = "neutral",
  loading = false,
}: EmptyStateProps) {
  const pending = loading || icon.includes("ri-loader-");
  return (
    <div role={pending ? "status" : undefined} aria-live={pending ? "polite" : undefined} className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full text-2xl",
          pending ? "bg-primary-50 text-primary-500 ring-1 ring-primary-100" : tone === "error" ? "bg-red-100 text-red-600" : "bg-background-200 text-foreground-500",
        )}
      >
        {pending ? <Spinner size="lg" /> : <i className={icon}></i>}
      </span>
      <h4 className="mt-3 font-heading text-sm font-bold text-foreground-900">{title}</h4>
      {message ? (
        <p className="mt-1 max-w-sm text-[13px] text-foreground-500">{message}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
