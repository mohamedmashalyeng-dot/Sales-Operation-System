import { cn } from "@/utils/format";
import { formatRate, rateValue, type RateSpec } from "@/utils/conversion";

interface RateCardProps {
  spec: RateSpec;
  tone?: "primary" | "accent" | "secondary";
}

const TONE_BAR = {
  primary: "bg-primary-500",
  accent: "bg-accent-500",
  secondary: "bg-secondary-500",
};

/**
 * Shows a conversion rate WITH its numerator, denominator and business
 * definition, so no percentage is ever presented without the maths behind it.
 * A zero denominator renders "N/A" rather than an invented figure.
 */
export default function RateCard({ spec, tone = "primary" }: RateCardProps) {
  const value = rateValue(spec);
  const pct = value == null ? 0 : Math.min(100, value);

  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-semibold text-foreground-800">{spec.label}</p>
        <p
          className={cn(
            "font-heading text-xl font-bold leading-none",
            value == null ? "text-foreground-400" : "text-foreground-900",
          )}
        >
          {formatRate(value)}
        </p>
      </div>
      <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-background-200">
        <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${pct}%` }}></div>
      </div>
      <p className="mt-2 text-[12px] font-semibold text-foreground-700">
        {spec.numerator} / {spec.denominator}
      </p>
      <p className="mt-0.5 text-[11px] text-foreground-500">{spec.unit}</p>
      <p className="mt-1.5 text-[11px] leading-snug text-foreground-400">{spec.definition}</p>
    </div>
  );
}