import { useNavigate } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import { Card, CardHeader } from "@/components/base/Card";
import PermissionGate from "@/components/feature/PermissionGate";
import type { TeamRow } from "@/pages/today/useTodayData";
import { cn } from "@/utils/format";

interface TeamOverviewProps {
  rows: TeamRow[];
}

export default function TeamOverview({ rows }: TeamOverviewProps) {
  const navigate = useNavigate();
  if (rows.length === 0) return null;

  return (
    <PermissionGate capability="reports.team">
      <Card>
        <CardHeader
          icon="ri-team-line"
          iconTone="secondary"
          title="Team overview"
          subtitle="Workload across the team — open tasks, overdue items, owned leads and unanswered emails"
          action={
            <span className="rounded-full bg-secondary-100 px-2.5 py-0.5 text-[11px] font-bold text-secondary-900">
              {rows.length} people
            </span>
          }
        />
        <div className="kbc-scroll overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="border-b border-background-200 bg-background-100/60">
              <tr>
                {["Team member", "Open tasks", "Overdue", "Active leads", "Unanswered"].map((h) => (
                  <th
                    key={h}
                    className="whitespace-nowrap px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-foreground-500"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-background-200">
              {rows.map((row) => (
                <tr key={row.userId} className="transition-colors hover:bg-background-100/70">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={row.name} size="sm" />
                      <div className="min-w-0">
                        <p className="truncate text-[13px] font-semibold text-foreground-900">
                          {row.name}
                        </p>
                        <p className="truncate text-[11px] text-foreground-500">
                          {row.role} · {row.team}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => navigate("/planner?view=list")}
                      className="cursor-pointer text-[13px] font-semibold text-foreground-800 hover:text-primary-600"
                    >
                      {row.openTasks}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex min-w-6 justify-center rounded-full px-2 py-0.5 text-[11px] font-bold",
                        row.overdue > 0
                          ? "bg-red-100 text-red-700"
                          : "bg-background-200 text-foreground-600",
                      )}
                    >
                      {row.overdue}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[13px] font-semibold text-foreground-800">
                    {row.leadsOwned}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex min-w-6 justify-center rounded-full px-2 py-0.5 text-[11px] font-bold",
                        row.unanswered > 0
                          ? "bg-amber-100 text-amber-700"
                          : "bg-background-200 text-foreground-600",
                      )}
                    >
                      {row.unanswered}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </PermissionGate>
  );
}