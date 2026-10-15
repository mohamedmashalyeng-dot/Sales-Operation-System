import { useRef, useState } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { cn } from "@/utils/format";

export interface SelectOption {
  value: string;
  label: string;
  icon?: string;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  label?: string;
  className?: string;
  size?: "sm" | "md";
  align?: "left" | "right";
  disabled?: boolean;
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = "Select",
  label,
  className,
  size = "md",
  align = "left",
  disabled = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={cn("relative", className)} ref={ref}>
      {label ? (
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
          {label}
        </label>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        aria-label={label || placeholder}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border border-background-300 bg-background-50 px-3 text-left text-foreground-800 transition-colors hover:border-background-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-200",
          size === "sm" ? "h-8 text-[13px]" : "h-9 text-sm",
          open && "border-primary-400 ring-2 ring-primary-200",
          disabled && "cursor-not-allowed opacity-50",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected?.icon ? (
            <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-500">
              <i className={selected.icon}></i>
            </span>
          ) : null}
          <span className={cn("truncate", !selected && "text-foreground-400")}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <span className="flex h-4 w-4 items-center justify-center text-base text-foreground-400">
          <i className="ri-arrow-down-s-line"></i>
        </span>
      </button>

      {open && !disabled ? (
        <div
          role="listbox"
          className={cn(
            "kbc-scroll absolute z-40 mt-1 max-h-72 w-full min-w-[12rem] overflow-y-auto rounded-md border border-background-200 bg-background-50 p-1 shadow-kbc-lg animate-scale-in",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          {options.map((option) => {
            const active = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors",
                  active
                    ? "bg-primary-50 font-semibold text-primary-700"
                    : "text-foreground-700 hover:bg-background-100",
                )}
              >
                {option.icon ? (
                  <span className="flex h-4 w-4 items-center justify-center text-base">
                    <i className={option.icon}></i>
                  </span>
                ) : null}
                <span className="truncate">{option.label}</span>
                {active ? (
                  <span className="ml-auto flex h-4 w-4 items-center justify-center text-base text-primary-600">
                    <i className="ri-check-line"></i>
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
