import type { ReactNode } from "react";
import { cn } from "@/utils/format";

export type BadgeTone =
  | "neutral"
  | "primary"
  | "secondary"
  | "accent"
  | "success"
  | "danger"
  | "warning";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-background-200 text-foreground-700",
  primary: "bg-primary-100 text-primary-700",
  secondary: "bg-secondary-100 text-secondary-900",
  accent: "bg-accent-100 text-accent-900",
  success: "bg-green-100 text-green-700",
  danger: "bg-red-100 text-red-700",
  warning: "bg-amber-100 text-amber-700",
};

const DOTS: Record<BadgeTone, string> = {
  neutral: "bg-foreground-400",
  primary: "bg-primary-500",
  secondary: "bg-secondary-500",
  accent: "bg-accent-500",
  success: "bg-green-500",
  danger: "bg-red-500",
  warning: "bg-amber-500",
};

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  icon?: string;
  className?: string;
  children: ReactNode;
}

export default function Badge({
  tone = "neutral",
  dot,
  icon,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        TONES[tone],
        className,
      )}
    >
      {dot ? <span className={cn("h-1.5 w-1.5 rounded-full", DOTS[tone])} /> : null}
      {icon ? (
        <span className="flex h-3.5 w-3.5 items-center justify-center text-[13px] leading-none">
          <i className={icon}></i>
        </span>
      ) : null}
      {children}
    </span>
  );
}