import Badge from "@/components/base/Badge";
import EmptyState from "@/components/base/EmptyState";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { IntakeRow } from "@/pages/future-intake/types";

/** Cohort grouping by preferred start month — the intake "calendar" view. */
export default function IntakeCalendar({ rows }: { rows: IntakeRow[] }) {
  const { userName } = useWorkspace();

  const groups = new Map<string, IntakeRow[]>();
  rows.forEach((row) => {
    const key = row.record.preferredStartMonth || "No month set";
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  });
  const ordered = Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="ri-calendar-line"
        title="No cohorts to show"
        message="Deferred learners are grouped by their preferred start month here."
      />
    );
  }

  const monthLabel = (key: string) => {
    if (key === "No month set") return key;
    const [year, month] = key.split("-");
    const date = new Date(Number(year), Number(month) - 1, 1);
    if (Number.isNaN(date.getTime())) return key;
    return date.toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {ordered.map(([month, list]) => (
        <div key={month} className="rounded-lg border border-background-200 bg-background-50">
          <div className="flex items-center justify-between border-b border-background-200 px-4 py-3">
            <span className="flex items-center gap-2 text-[13px] font-bold text-foreground-800">
              <i className="ri-calendar-2-line text-foreground-500"></i>
              {monthLabel(month)}
            </span>
            <Badge tone="primary">{list.length} deferred</Badge>
          </div>
          <ul className="divide-y divide-background-200">
            {list.map(({ record, lead }) => (
              <li key={record.id} className="px-4 py-3">
                <p className="text-[13px] font-semibold text-foreground-900">{lead?.name ?? record.leadId}</p>
                <p className="mt-0.5 text-[11px] text-foreground-500">{record.currentProgramme}</p>
                <p className="mt-1 text-[11px] text-foreground-400">
                  {record.reason} · Enrolment {userName(record.enrolmentOwnerId)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}