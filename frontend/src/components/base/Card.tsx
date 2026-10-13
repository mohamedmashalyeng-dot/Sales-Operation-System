import type { ReactNode } from "react";
import { cn } from "@/utils/format";

export interface CardProps {
  className?: string;
  children: ReactNode;
}

export function Card({ className, children }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-background-200 bg-background-50 shadow-kbc-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: string;
  iconTone?: "primary" | "accent" | "secondary";
  action?: ReactNode;
  className?: string;
}

const ICON_TONES = {
  primary: "bg-primary-100 text-primary-700",
  accent: "bg-accent-100 text-accent-900",
  secondary: "bg-secondary-100 text-secondary-900",
};

export function CardHeader({
  title,
  subtitle,
  icon,
  iconTone = "primary",
  action,
  className,
}: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-background-200 px-5 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-lg",
              ICON_TONES[iconTone],
            )}
          >
            <i className={icon}></i>
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="truncate font-heading text-[15px] font-bold text-foreground-900">
            {title}
          </h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-foreground-500">{subtitle}</p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: CardProps) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

export default Card;