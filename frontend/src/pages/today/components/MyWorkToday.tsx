import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "@/components/base/Button";
import { Card, CardHeader } from "@/components/base/Card";
import Checkbox from "@/components/base/Checkbox";
import { useToast } from "@/components/base/Toast";
import { cn } from "@/utils/format";
import type { Appointment, WorkTask } from "@/pages/today/types";

const SOURCE_ICONS: Record<string, string> = {
  "Zoho CRM": "ri-cloud-line",
  Manual: "ri-sticky-note-line",
  "Gmail / Inbox": "ri-mail-line",
  Inbox: "ri-mail-line",
  Events: "ri-calendar-event-line",
  Applications: "ri-file-list-3-line",
  Zoom: "ri-vidicon-line",
};

const PRIORITY_TONES: Record<string, string> = {
  High: "text-red-600 bg-red-100",
  Medium: "text-amber-700 bg-amber-100",
  Low: "text-foreground-600 bg-background-200",
};

interface MyWorkTodayProps {
  tasks: WorkTask[];
  appointments: Appointment[];
  onComplete?: (taskId: string) => void;
}

function shortTime(value: string): string {
  return value.includes(" ") ? value.split(" ")[0] : value;
}

export default function MyWorkToday({ tasks, appointments, onComplete }: MyWorkTodayProps) {
  const [completed, setCompleted] = useState<string[]>([]);
  const navigate = useNavigate();
  const { toast } = useToast();

  const toggle = (task: WorkTask) => {
    setCompleted((prev) => {
      const isDone = prev.includes(task.id);
      if (!isDone) onComplete?.(task.id);
      toast({
        title: isDone ? "Task reopened" : "Task completed",
        message: task.title,
        tone: isDone ? "info" : "success",
      });
      return isDone ? prev.filter((id) => id !== task.id) : [...prev, task.id];
    });
  };

  return (
    <Card className="flex h-full min-h-[440px] flex-col">
      <CardHeader
        icon="ri-list-check-3"
        iconTone="primary"
        title="My Work Today"
        action={
          <Button
            variant="ghost"
            size="sm"
            rightIcon={<i className="ri-arrow-right-s-line"></i>}
            onClick={() => navigate("/planner")}
          >
            View all
          </Button>
        }
      />

      <ul className="divide-y divide-background-200">
        {tasks.map((task) => {
          const done = completed.includes(task.id);
          return (
            <li
              key={task.id}
              className="grid grid-cols-[1.25rem_2rem_1fr_auto] items-center gap-3 px-5 py-3"
            >
              <Checkbox checked={done} onChange={() => toggle(task)} />
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-background-200 text-base text-primary-700">
                <i className={SOURCE_ICONS[task.source] || "ri-link"}></i>
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "truncate text-[13px] font-semibold leading-snug",
                    done ? "text-foreground-400 line-through" : "text-foreground-900",
                  )}
                >
                  {task.title}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-foreground-500">{task.related}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "hidden rounded-full px-1.5 py-0.5 text-[10px] font-bold xl:inline-flex",
                    PRIORITY_TONES[task.priority],
                  )}
                >
                  {task.priority}
                </span>
                <span className="whitespace-nowrap text-[12px] font-semibold text-foreground-700">
                  {task.due}
                </span>
              </div>
            </li>
          );
        })}

        {appointments.map((appt) => (
          <li
            key={appt.id}
            className="grid grid-cols-[1.25rem_2rem_1fr_auto] items-center gap-3 px-5 py-3"
          >
            <span></span>
            <span
              className={cn(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-base",
                appt.type === "Zoom"
                  ? "bg-primary-100 text-primary-700"
                  : "bg-secondary-100 text-secondary-900",
              )}
            >
              <i className={appt.type === "Zoom" ? "ri-vidicon-line" : "ri-group-line"}></i>
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold leading-snug text-foreground-900">
                {appt.title}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-foreground-500">
                {appt.type} · Host {appt.host}
              </p>
            </div>
            <span className="whitespace-nowrap text-[12px] font-semibold text-foreground-700">
              {shortTime(appt.time)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
