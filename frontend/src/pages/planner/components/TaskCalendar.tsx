import { useMemo, useState } from "react";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Task } from "@/store/types";
import { PRIORITY_TONES } from "@/utils/crm";
import { cn } from "@/utils/format";

type CalView = "day" | "week" | "month";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  return addDays(d, -day);
}

function startOfMonth(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(1);
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  );
}

export default function TaskCalendar({
  tasks,
  onEdit,
}: {
  tasks: Task[];
  onEdit: (task: Task) => void;
}) {
  const { userName } = useWorkspace();
  const [view, setView] = useState<CalView>("month");
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const today = useMemo(() => startOfDay(new Date()), []);

  const tasksByDay = useMemo(() => {
    const map = new Map<string, Task[]>();
    tasks.forEach((task) => {
      const key = startOfDay(new Date(task.dueAt)).toDateString();
      const list = map.get(key) ?? [];
      list.push(task);
      map.set(key, list);
    });
    return map;
  }, [tasks]);

  const dayTasks = (date: Date) => tasksByDay.get(startOfDay(date).toDateString()) ?? [];

  const shift = (dir: number) => {
    if (view === "month") {
      const d = new Date(cursor);
      d.setMonth(d.getMonth() + dir);
      setCursor(d);
    } else if (view === "week") {
      setCursor(addDays(cursor, dir * 7));
    } else {
      setCursor(addDays(cursor, dir));
    }
  };

  const label =
    view === "month"
      ? cursor.toLocaleDateString("en-GB", { month: "long", year: "numeric" })
      : view === "week"
        ? `Week of ${startOfWeek(cursor).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
        : cursor.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-background-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label="Previous" onClick={() => shift(-1)}>
            <i className="ri-arrow-left-s-line"></i>
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCursor(today)}>
            Today
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next" onClick={() => shift(1)}>
            <i className="ri-arrow-right-s-line"></i>
          </Button>
          <span className="ml-1 font-heading text-[14px] font-bold text-foreground-900">{label}</span>
        </div>
        <div className="inline-flex items-center gap-1 rounded-full bg-background-200 p-0.5">
          {(["day", "week", "month"] as CalView[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "cursor-pointer rounded-full px-3 py-1 text-[12px] font-semibold capitalize transition-colors",
                view === v ? "bg-background-50 text-foreground-900 shadow-kbc-sm" : "text-foreground-500",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "month" ? (
        <MonthGrid cursor={cursor} today={today} dayTasks={dayTasks} onEdit={onEdit} />
      ) : null}
      {view === "week" ? (
        <WeekView cursor={cursor} today={today} dayTasks={dayTasks} onEdit={onEdit} />
      ) : null}
      {view === "day" ? (
        <DayView cursor={cursor} dayTasks={dayTasks} onEdit={onEdit} userName={userName} />
      ) : null}
    </div>
  );
}

function MonthGrid({
  cursor,
  today,
  dayTasks,
  onEdit,
}: {
  cursor: Date;
  today: Date;
  dayTasks: (d: Date) => Task[];
  onEdit: (t: Task) => void;
}) {
  const first = startOfMonth(cursor);
  const gridStart = startOfWeek(first);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));

  return (
    <div>
      <div className="grid grid-cols-7 border-b border-background-200">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-foreground-400">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((date) => {
          const inMonth = date.getMonth() === cursor.getMonth();
          const list = dayTasks(date);
          return (
            <div
              key={date.toISOString()}
              className={cn(
                "min-h-[6.5rem] border-b border-r border-background-200 p-2",
                !inMonth && "bg-background-100/50",
              )}
            >
              <div className="mb-1 flex items-center justify-between">
                <span
                  className={cn(
                    "flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold",
                    isSameDay(date, today)
                      ? "bg-primary-500 text-background-50"
                      : inMonth
                        ? "text-foreground-700"
                        : "text-foreground-300",
                  )}
                >
                  {date.getDate()}
                </span>
                {list.length > 2 ? (
                  <span className="text-[10px] text-foreground-400">+{list.length - 2}</span>
                ) : null}
              </div>
              <div className="space-y-1">
                {list.slice(0, 2).map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onEdit(task)}
                    className={cn(
                      "block w-full cursor-pointer truncate rounded px-1.5 py-1 text-left text-[11px] font-medium",
                      task.status === "completed"
                        ? "bg-green-100 text-green-700 line-through"
                        : new Date(task.dueAt).getTime() < Date.now()
                          ? "bg-red-100 text-red-700"
                          : "bg-primary-100 text-primary-700",
                    )}
                    title={task.title}
                  >
                    {task.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({
  cursor,
  today,
  dayTasks,
  onEdit,
}: {
  cursor: Date;
  today: Date;
  dayTasks: (d: Date) => Task[];
  onEdit: (t: Task) => void;
}) {
  const start = startOfWeek(cursor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  return (
    <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-7">
      {days.map((date) => {
        const list = dayTasks(date);
        return (
          <div key={date.toISOString()} className="rounded-lg border border-background-200 bg-background-50">
            <div
              className={cn(
                "flex items-center justify-between border-b border-background-200 px-2.5 py-2",
                isSameDay(date, today) && "bg-primary-50",
              )}
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-foreground-500">
                {date.toLocaleDateString("en-GB", { weekday: "short" })}
              </span>
              <span className="text-[12px] font-semibold text-foreground-800">{date.getDate()}</span>
            </div>
            <div className="space-y-1.5 p-2">
              {list.length === 0 ? (
                <p className="py-1 text-[11px] text-foreground-300">No tasks</p>
              ) : (
                list.map((task) => (
                  <button
                    key={task.id}
                    type="button"
                    onClick={() => onEdit(task)}
                    className="block w-full cursor-pointer rounded border border-background-200 bg-background-50 px-2 py-1.5 text-left hover:border-primary-300"
                  >
                    <span className="block truncate text-[11px] font-semibold text-foreground-800">
                      {task.title}
                    </span>
                    <Badge tone={PRIORITY_TONES[task.priority]} className="mt-1">
                      {task.priority}
                    </Badge>
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DayView({
  cursor,
  dayTasks,
  onEdit,
  userName,
}: {
  cursor: Date;
  dayTasks: (d: Date) => Task[];
  onEdit: (t: Task) => void;
  userName: (id: string | null | undefined) => string;
}) {
  const list = dayTasks(cursor);
  return (
    <div className="p-4">
      {list.length === 0 ? (
        <p className="py-8 text-center text-[13px] text-foreground-400">No tasks scheduled for this day.</p>
      ) : (
        <ul className="divide-y divide-background-200 rounded-lg border border-background-200">
          {list.map((task) => (
            <li key={task.id} className="flex items-center gap-3 px-4 py-3">
              <span className="text-[12px] font-semibold text-foreground-500 tabular-nums">
                {new Date(task.dueAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
              </span>
              <button
                type="button"
                onClick={() => onEdit(task)}
                className="min-w-0 flex-1 cursor-pointer text-left"
              >
                <span className="block truncate text-[13px] font-semibold text-foreground-900">{task.title}</span>
                <span className="text-[11px] text-foreground-400">
                  {task.source} · {userName(task.ownerId)}
                </span>
              </button>
              <Badge tone={PRIORITY_TONES[task.priority]}>{task.priority}</Badge>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}