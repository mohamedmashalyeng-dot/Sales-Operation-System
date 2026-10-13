import { useNavigate } from "react-router-dom";
import { Card, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import { cn } from "@/utils/format";
import type { AttentionItem } from "@/pages/today/types";

const SEVERITY = {
  overdue: { wrap: "border-l-red-500", chip: "bg-red-100 text-red-700", dot: "bg-red-500" },
  urgent: { wrap: "border-l-amber-500", chip: "bg-amber-100 text-amber-700", dot: "bg-amber-500" },
  due: { wrap: "border-l-primary-500", chip: "bg-primary-100 text-primary-700", dot: "bg-primary-500" },
  info: {
    wrap: "border-l-background-400",
    chip: "bg-background-200 text-foreground-600",
    dot: "bg-foreground-400",
  },
};

const SEVERITY_LABEL = {
  overdue: "Overdue",
  urgent: "Urgent",
  due: "Due soon",
  info: "For info",
};

export default function AttentionQueue({ items }: { items: AttentionItem[] }) {
  const navigate = useNavigate();

  return (
    <Card>
      <CardHeader
        icon="ri-alarm-warning-line"
        iconTone="primary"
        title="Needs your attention"
        subtitle="A prioritised queue of actions for today"
        action={
          <span className="rounded-full bg-primary-100 px-2.5 py-0.5 text-[11px] font-bold text-primary-700">
            {items.length}
          </span>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon="ri-checkbox-circle-line"
          title="You're all caught up"
          message="No priority actions match the current filters."
        />
      ) : (
        <ul className="divide-y divide-background-200">
          {items.map((item) => {
            const tone = SEVERITY[item.severity];
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => navigate(item.route)}
                  className={cn(
                    "flex w-full cursor-pointer items-start gap-3 border-l-2 px-4 py-3.5 text-left transition-colors hover:bg-background-100",
                    tone.wrap,
                  )}
                >
                  <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", tone.dot)}></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[13px] font-semibold text-foreground-900">
                        {item.title}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                          tone.chip,
                        )}
                      >
                        {SEVERITY_LABEL[item.severity]}
                      </span>
                    </span>
                    <span className="mt-1 block text-[12px] leading-snug text-foreground-500">
                      {item.detail}
                    </span>
                    <span className="mt-1.5 flex items-center gap-2 text-[11px] font-medium text-foreground-400">
                      <span className="rounded bg-background-200 px-1.5 py-0.5 font-semibold text-foreground-600">
                        {item.module}
                      </span>
                      <span className="flex items-center gap-1">
                        <i className="ri-time-line"></i>
                        {item.ageLabel}
                      </span>
                    </span>
                  </span>
                  <span className="mt-0.5 flex shrink-0 items-center gap-1 self-center whitespace-nowrap rounded-md border border-background-300 px-2.5 py-1 text-[12px] font-semibold text-foreground-700">
                    {item.action}
                    <i className="ri-arrow-right-s-line"></i>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}