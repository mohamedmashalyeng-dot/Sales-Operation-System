import { cn } from "@/utils/format";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  description?: string;
  disabled?: boolean;
}

export default function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: ToggleProps) {
  const control = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary-500" : "bg-background-400",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 transform rounded-full bg-background-50 transition-transform",
          checked ? "translate-x-[1.15rem]" : "translate-x-1",
        )}
      ></span>
    </button>
  );

  if (!label) return control;

  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold text-foreground-900">{label}</p>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-snug text-foreground-500">{description}</p>
        ) : null}
      </div>
      {control}
    </div>
  );
}