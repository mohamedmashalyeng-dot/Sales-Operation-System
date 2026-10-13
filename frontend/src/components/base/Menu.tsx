import { useRef, useState, type ReactNode } from "react";
import { useClickOutside } from "@/hooks/useClickOutside";
import { cn } from "@/utils/format";

export interface MenuItem {
  key: string;
  label: string;
  icon?: string;
  tone?: "default" | "danger";
  onSelect?: () => void;
}

export interface MenuProps {
  trigger: ReactNode;
  items: MenuItem[];
  header?: ReactNode;
  align?: "left" | "right";
  className?: string;
  menuClassName?: string;
}

export default function Menu({
  trigger,
  items,
  header,
  align = "right",
  className,
  menuClassName,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);

  return (
    <div className={cn("relative", className)} ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="cursor-pointer"
      >
        {trigger}
      </button>
      {open ? (
        <div
          role="menu"
          className={cn(
            "absolute z-50 mt-2 w-60 overflow-hidden rounded-md border border-background-200 bg-background-50 p-1 shadow-kbc-lg animate-scale-in",
            align === "right" ? "right-0" : "left-0",
            menuClassName,
          )}
        >
          {header ? (
            <div className="border-b border-background-200 px-3 py-2.5">{header}</div>
          ) : null}
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                item.onSelect?.();
                setOpen(false);
              }}
              className={cn(
                "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] font-medium transition-colors",
                item.tone === "danger"
                  ? "text-red-600 hover:bg-red-50"
                  : "text-foreground-700 hover:bg-background-100",
              )}
            >
              {item.icon ? (
                <span className="flex h-4 w-4 items-center justify-center text-base">
                  <i className={item.icon}></i>
                </span>
              ) : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}