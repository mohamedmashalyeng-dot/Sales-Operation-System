import { cn } from "@/utils/format";

export interface TabItem {
  value: string;
  label: string;
  count?: number;
  icon?: string;
}

export interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  fullWidth?: boolean;
}

export default function Tabs({ items, value, onChange, className, fullWidth }: TabsProps) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-background-200 p-1",
        fullWidth && "w-full",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300",
              fullWidth && "flex-1",
              active
                ? "bg-background-50 text-foreground-900 shadow-kbc-sm"
                : "text-foreground-500 hover:text-foreground-800",
            )}
          >
            {item.icon ? (
              <span className="flex h-3.5 w-3.5 items-center justify-center text-sm leading-none">
                <i className={item.icon}></i>
              </span>
            ) : null}
            {item.label}
            {typeof item.count === "number" ? (
              <span
                className={cn(
                  "ml-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                  active ? "bg-primary-100 text-primary-700" : "bg-background-300 text-foreground-600",
                )}
              >
                {item.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}