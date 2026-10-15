import Badge from "@/components/base/Badge";
import { Link } from "react-router-dom";
import { openCallReview } from "@/store/callJourney";
import EmptyState from "@/components/base/EmptyState";
import Menu from "@/components/base/Menu";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Task } from "@/store/types";
import { PRIORITY_TONES } from "@/utils/crm";
import { formatDateTime } from "@/utils/format";

interface TaskListProps {
  tasks: Task[];
  onEdit?: (task: Task) => void;
  onDelete?: (task: Task) => void;
  emptyMessage?: string;
}

export default function TaskList({ tasks, onEdit, onDelete, emptyMessage }: TaskListProps) {
  const { completeTask, reopenTask, state, userName } = useWorkspace();

  if (tasks.length === 0) {
    return (
      <EmptyState
        icon="ri-checkbox-multiple-blank-line"
        title="No tasks here"
        message={emptyMessage ?? "Nothing matches the current view or filters."}
      />
    );
  }

  const leadName = (id?: string) => (id ? state.leads.find((l) => l.id === id)?.name : undefined);

  return (
    <ul className="divide-y divide-background-200">
      {tasks.map((task) => {
        const overdue = task.status === "open" && new Date(task.dueAt).getTime() < Date.now();
        const done = task.status === "completed";
        return (
          <li key={task.id} className="flex items-start gap-3 px-4 py-3.5 md:px-5">
            <button
              type="button"
              aria-label={done ? "Reopen task" : "Complete task"}
              onClick={() => (done ? reopenTask(task.id) : completeTask(task.id))}
              className={`mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border text-[12px] ${
                done ? "border-green-500 bg-green-500 text-white" : "border-background-400 bg-background-50"
              }`}
            >
              {done ? <i className="ri-check-line"></i> : null}
            </button>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p
                  className={`text-[13px] font-semibold ${
                    done ? "text-foreground-400 line-through" : "text-foreground-900"
                  }`}
                >
                  {task.title}
                </p>
                {overdue ? (
                  <Badge tone="danger" dot>
                    Overdue
                  </Badge>
                ) : null}
              </div>
              {task.description ? (
                <p className="mt-0.5 line-clamp-2 text-[12px] text-foreground-500">{task.description}</p>
              ) : null}
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-400">
                <span className="inline-flex items-center gap-1">
                  <i className="ri-calendar-line"></i> {formatDateTime(task.dueAt)}
                </span>
                <span className="inline-flex items-center gap-1">
                  <i className="ri-database-2-line"></i> {task.source}
                </span>
                <span className="inline-flex items-center gap-1">
                  <i className="ri-user-line"></i> {userName(task.ownerId)}
                </span>
                {leadName(task.relatedLeadId) ? (
                  <span className="inline-flex items-center gap-1">
                    <i className="ri-contacts-book-2-line"></i> {leadName(task.relatedLeadId)}
                  </span>
                ) : null}
              </div>
              {task.relatedCallId && task.sourceEventId ? <div className="mt-2 flex flex-wrap gap-3 text-xs font-semibold text-primary-700">
                <Link className="hover:underline" to={`/zoom/calls/${encodeURIComponent(task.relatedCallId)}`}><i className="ri-phone-line" /> View Zoom call</Link>
                <button className="hover:underline" type="button" onClick={() => openCallReview(task.sourceEventId!)}>View approved review</button>
                {task.relatedLeadId ? <Link className="hover:underline" to={`/leads/${encodeURIComponent(task.relatedLeadId)}`}>Open lead</Link> : null}
              </div> : null}
            </div>

            <Badge tone={PRIORITY_TONES[task.priority]}>{task.priority}</Badge>

            <Menu
              trigger={
                <span className="flex h-8 w-8 items-center justify-center rounded-md text-lg text-foreground-400 hover:bg-background-100 hover:text-foreground-700">
                  <i className="ri-more-2-fill"></i>
                </span>
              }
              items={[
                ...(onEdit ? [{ key: "edit", label: "Edit task", icon: "ri-pencil-line", onSelect: () => onEdit(task) }] : []),
                {
                  key: "toggle",
                  label: done ? "Reopen task" : "Mark complete",
                  icon: done ? "ri-refresh-line" : "ri-check-line",
                  onSelect: () => (done ? reopenTask(task.id) : completeTask(task.id)),
                },
                ...(onDelete ? [{
                  key: "delete",
                  label: "Delete task",
                  icon: "ri-delete-bin-line",
                  tone: "danger" as const,
                  onSelect: () => onDelete(task),
                }] : []),
              ]}
            />
          </li>
        );
      })}
      <li className="px-4 py-3 md:px-5">
        <span className="text-[11px] text-foreground-400">
          {tasks.length} tasks · changes update the Today dashboard instantly
        </span>
      </li>
    </ul>
  );
}
