import { useNavigate } from "react-router-dom";
import Button from "@/components/base/Button";
import { Card, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import { cn } from "@/utils/format";
import type { ActivityItem } from "@/pages/today/types";

const ICON_TONES: Record<string, string> = {
  primary: "bg-primary-100 text-primary-700",
  accent: "bg-accent-100 text-accent-900",
  secondary: "bg-secondary-100 text-secondary-900",
  success: "bg-green-100 text-green-700",
  danger: "bg-red-100 text-red-600",
};

export default function RecentActivity({ items }: { items: ActivityItem[] }) {
  const navigate = useNavigate();

  return (
    <Card className="flex h-full min-h-[440px] flex-col">
      <CardHeader
        icon="ri-history-line"
        iconTone="accent"
        title="Recent Activity"
        action={
          <Button
            variant="ghost"
            size="sm"
            rightIcon={<i className="ri-arrow-right-s-line"></i>}
            onClick={() => navigate("/audit")}
          >
            View all
          </Button>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon="ri-history-line"
          title="No recent activity"
          message="Activity will appear here as your team works."
        />
      ) : (
        <ol className="divide-y divide-background-200">
          {items.map((item) => (
            <li key={item.id} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-5 py-3.5">
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base",
                  ICON_TONES[item.tone],
                )}
              >
                <i className={item.icon}></i>
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold leading-snug text-foreground-900">
                  {item.action} - {item.target}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-foreground-500">
                  {item.actor} · {item.module}
                </p>
              </div>
              <span className="whitespace-nowrap text-[11px] font-semibold text-foreground-400">
                {item.time}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
