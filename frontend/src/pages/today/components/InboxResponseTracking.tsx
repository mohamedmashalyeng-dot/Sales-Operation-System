import { useNavigate } from "react-router-dom";
import Button from "@/components/base/Button";
import { Card, CardHeader } from "@/components/base/Card";
import type { InboxTracking } from "@/pages/today/types";
import { cn } from "@/utils/format";

const STAT_CARDS = [
  {
    key: "unanswered",
    label: "Unanswered",
    icon: "ri-mail-unread-line",
    tone: "bg-red-100 text-red-600",
  },
  {
    key: "overdue",
    label: "Overdue",
    icon: "ri-timer-flash-line",
    tone: "bg-amber-100 text-amber-700",
  },
  {
    key: "resolved24h",
    label: "Resolved (24h)",
    icon: "ri-checkbox-circle-line",
    tone: "bg-green-100 text-green-700",
  },
] as const;

export default function InboxResponseTracking({ data }: { data: InboxTracking }) {
  const navigate = useNavigate();
  const maxHours = Math.max(...data.trend.map((point) => point.hours), 1);

  return (
    <Card className="flex h-full min-h-[440px] flex-col">
      <CardHeader
        icon="ri-mail-check-line"
        iconTone="primary"
        title="Inbox Response Tracking"
        action={
          <Button
            variant="ghost"
            size="sm"
            rightIcon={<i className="ri-arrow-right-s-line"></i>}
            onClick={() => navigate("/inbox")}
          >
            View all
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-2 px-5 py-4">
        {STAT_CARDS.map((stat) => (
          <button
            key={stat.key}
            type="button"
            onClick={() =>
              navigate(
                stat.key === "resolved24h"
                  ? "/inbox?status=resolved"
                  : stat.key === "overdue"
                    ? "/inbox?status=overdue"
                    : "/inbox?status=unanswered",
              )
            }
            className="min-w-0 rounded-lg border border-background-200 bg-background-50 px-3 py-3 text-center transition-colors hover:bg-background-100"
          >
            <span
              className={cn(
                "mx-auto flex h-8 w-8 items-center justify-center rounded-md text-base",
                stat.tone,
              )}
            >
              <i className={stat.icon}></i>
            </span>
            <span className="mt-2 block font-heading text-xl font-extrabold text-foreground-950">
              {data[stat.key]}
            </span>
            <span className="block truncate text-[11px] text-foreground-500">{stat.label}</span>
          </button>
        ))}
      </div>

      <div className="border-t border-background-200 px-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <p className="text-[13px] font-semibold text-foreground-800">
            Response Time Trend <span className="font-normal text-foreground-500">(hours)</span>
          </p>
          <p className="text-[11px] font-semibold text-foreground-500">
            Avg. {data.averageHours.toFixed(1)}h
          </p>
        </div>
        <div className="flex h-28 items-end gap-1.5">
          {data.trend.map((point) => (
            <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center gap-2">
              <span
                className="w-full rounded-t-sm bg-primary-400"
                style={{
                  height: `${Math.max(4, (point.hours / maxHours) * 88)}px`,
                }}
                title={`${point.label}: ${point.hours.toFixed(1)} hours`}
              ></span>
              <span className="text-[10px] font-medium text-foreground-400">{point.label}</span>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
