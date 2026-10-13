import type { ReactNode } from "react";
import { cn } from "@/utils/format";

export interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: ReactNode;
  icon: string;
  tone?: "primary" | "accent" | "secondary" | "danger" | "success";
  onClick?: () => void;
  active?: boolean;
}

const ICON_TONES = {
  primary: "bg-primary-100 text-primary-700",
  accent: "bg-accent-100 text-accent-900",
  secondary: "bg-secondary-100 text-secondary-900",
  danger: "bg-red-100 text-red-600",
  success: "bg-green-100 text-green-700",
};

export default function MetricCard({
  label,
  value,
  hint,
  icon,
  tone = "primary",
  onClick,
  active,
}: MetricCardProps) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "group flex w-full flex-col rounded-lg border bg-background-50 p-4 text-left transition-colors",
        active ? "border-primary-400 ring-2 ring-primary-100" : "border-background-200",
        onClick && "cursor-pointer hover:border-primary-300 hover:bg-primary-50/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-md text-base",
            ICON_TONES[tone],
          )}
        >
          <i className={icon}></i>
        </span>
        {onClick ? (
          <span className="flex h-5 w-5 items-center justify-center text-base text-foreground-300 transition-colors group-hover:text-primary-500">
            <i className="ri-arrow-right-up-line"></i>
          </span>
        ) : null}
      </div>
      <p className="mt-3 font-heading text-2xl font-bold leading-none text-foreground-900">
        {value}
      </p>
      <p className="mt-1.5 text-[13px] font-medium text-foreground-600">{label}</p>
      {hint ? <div className="mt-1.5 text-xs text-foreground-500">{hint}</div> : null}
    </Wrapper>
  );
}