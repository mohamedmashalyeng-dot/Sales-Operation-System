import { cn } from "@/utils/format";

export interface BarListItem {
  label: string;
  value: number;
  secondary?: number;
  hint?: string;
}

export interface BarListProps {
  items: BarListItem[];
  max?: number;
  tone?: "primary" | "accent" | "secondary";
  valueSuffix?: string;
  onSelect?: (label: string) => void;
  showSecondary?: boolean;
}

const FILL = {
  primary: "bg-primary-500",
  accent: "bg-accent-500",
  secondary: "bg-secondary-500",
};

const FILL_ALT = {
  primary: "bg-primary-200",
  accent: "bg-accent-200",
  secondary: "bg-secondary-200",
};

export default function BarList({
  items,
  max,
  tone = "primary",
  valueSuffix,
  onSelect,
  showSecondary,
}: BarListProps) {
  const ceiling = max ?? Math.max(1, ...items.map((i) => Math.max(i.value, i.secondary ?? 0)));

  if (items.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-foreground-400">
        No data for this selection.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => {
        const pct = Math.max(2, (item.value / ceiling) * 100);
        const pctAlt = item.secondary != null ? Math.max(2, (item.secondary / ceiling) * 100) : 0;
        const Row = onSelect ? "button" : "div";
        return (
          <li key={item.label}>
            <Row
              type={onSelect ? "button" : undefined}
              onClick={onSelect ? () => onSelect(item.label) : undefined}
              className={cn(
                "w-full text-left",
                onSelect && "cursor-pointer rounded-md px-1 py-0.5 transition-colors hover:bg-background-100",
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-[13px] font-medium text-foreground-800">
                  {item.label}
                </span>
                <span className="shrink-0 text-[12px] font-semibold text-foreground-600">
                  {item.value}
                  {valueSuffix ?? ""}
                  {showSecondary && item.secondary != null ? (
                    <span className="ml-1 text-foreground-400">· {item.secondary} closed</span>
                  ) : null}
                </span>
              </div>
              <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-background-200">
                <div className={cn("h-full rounded-full", FILL[tone])} style={{ width: `${pct}%` }}></div>
              </div>
              {showSecondary && item.secondary != null ? (
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-background-200">
                  <div
                    className={cn("h-full rounded-full", FILL_ALT[tone])}
                    style={{ width: `${pctAlt}%` }}
                  ></div>
                </div>
              ) : null}
              {item.hint ? (
                <p className="mt-1 text-[11px] text-foreground-400">{item.hint}</p>
              ) : null}
            </Row>
          </li>
        );
      })}
    </ul>
  );
}