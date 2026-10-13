import { cn } from "@/utils/format";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  indeterminate?: boolean;
  className?: string;
}

export default function Checkbox({
  checked,
  onChange,
  label,
  indeterminate,
  className,
}: CheckboxProps) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2", className)}>
      <span
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded border transition-colors",
          checked || indeterminate
            ? "border-primary-500 bg-primary-500 text-background-50"
            : "border-background-400 bg-background-50",
        )}
      >
        {indeterminate ? (
          <i className="ri-subtract-line text-[11px]"></i>
        ) : checked ? (
          <i className="ri-check-line text-[11px]"></i>
        ) : null}
      </span>
      {label ? <span className="text-[13px] text-foreground-700">{label}</span> : null}
    </label>
  );
}