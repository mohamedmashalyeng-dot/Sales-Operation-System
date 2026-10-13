import { cn } from "@/utils/format";

export interface ProgressBarProps {
  value: number;
  max?: number;
  tone?: "primary" | "accent" | "success" | "danger" | "secondary";
  className?: string;
}

const TONES = {
  primary: "bg-primary-500",
  accent: "bg-accent-500",
  success: "bg-green-500",
  danger: "bg-red-500",
  secondary: "bg-secondary-500",
};

export default function ProgressBar({
  value,
  max = 100,
  tone = "primary",
  className,
}: ProgressBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-background-200", className)}>
      <div
        className={cn("h-full rounded-full transition-all", TONES[tone])}
        style={{ width: `${pct}%` }}
      ></div>
    </div>
  );
}