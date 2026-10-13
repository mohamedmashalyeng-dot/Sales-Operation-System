import type { ReactNode } from "react";
import { cn } from "@/utils/format";

export interface EmptyStateProps {
  icon?: string;
  title: string;
  message?: string;
  action?: ReactNode;
  className?: string;
  tone?: "neutral" | "error";
}

export default function EmptyState({
  icon = "ri-inbox-archive-line",
  title,
  message,
  action,
  className,
  tone = "neutral",
}: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center px-6 py-12 text-center", className)}>
      <span
        className={cn(
          "flex h-12 w-12 items-center justify-center rounded-full text-2xl",
          tone === "error" ? "bg-red-100 text-red-600" : "bg-background-200 text-foreground-500",
        )}
      >
        <i className={icon}></i>
      </span>
      <h4 className="mt-3 font-heading text-sm font-bold text-foreground-900">{title}</h4>
      {message ? (
        <p className="mt-1 max-w-sm text-[13px] text-foreground-500">{message}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}