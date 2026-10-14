import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import MetricCard from "@/components/base/MetricCard";
import Modal from "@/components/base/Modal";
import PaginationFooter from "@/components/base/PaginationFooter";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import Tabs, { type TabItem } from "@/components/base/Tabs";
import { useToast } from "@/components/base/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import TaskCalendar from "@/pages/planner/components/TaskCalendar";
import TaskFormModal from "@/pages/planner/components/TaskFormModal";
import TaskList from "@/pages/planner/components/TaskList";
import { useWorkspace, type TaskInput } from "@/store/WorkspaceProvider";
import type { Task } from "@/store/types";
import { relativeTime } from "@/utils/format";
import { ownerOptions, taskPriorityOptions, taskSourceOptions } from "@/utils/filterOptions";

const PER_PAGE = 50;

const VIEWS = [
  { value: "overview", label: "Overview", icon: "ri-dashboard-line" },
  { value: "list", label: "Task list", icon: "ri-list-check" },
  { value: "calendar", label: "Calendar", icon: "ri-calendar-line" },
  { value: "overdue", label: "Overdue", icon: "ri-alarm-warning-line" },
  { value: "today", label: "Today", icon: "ri-sun-line" },
  { value: "upcoming", label: "Upcoming", icon: "ri-calendar-schedule-line" },
  { value: "completed", label: "Completed", icon: "ri-checkbox-circle-line" },
  { value: "activity", label: "Activity", icon: "ri-history-line" },
] as const;

type ViewKey = (typeof VIEWS)[number]["value"];

function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.toDateString() === n.toDateString();
}

export default function PlannerPage() {
  const { toast } = useToast();
  const { state, createTask, updateTask, deleteTask, userName } = useWorkspace();
  const { canSeeOwner } = usePermissions();
  const [searchParams] = useSearchParams();

  const [view, setView] = useState<ViewKey>("overview");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [priority, setPriority] = useState("all");
  const [source, setSource] = useState("all");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [listPage, setListPage] = useState(1);
  const [overduePage, setOverduePage] = useState(1);
  const [todayPage, setTodayPage] = useState(1);
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);

  const visibleTasks = useMemo(
    () => state.tasks.filter((t) => canSeeOwner(t.ownerId)),
    [state.tasks, canSeeOwner],
  );
  const owners = useMemo(() => ownerOptions(state), [state]);
  const priorities = useMemo(() => taskPriorityOptions({ ...state, tasks: visibleTasks }), [state, visibleTasks]);
  const sources = useMemo(() => taskSourceOptions({ ...state, tasks: visibleTasks }), [state, visibleTasks]);

  useEffect(() => {
    const next = searchParams.get("view");
    if (next && VIEWS.some((v) => v.value === next)) setView(next as ViewKey);
  }, [searchParams]);

  const openTasks = visibleTasks.filter((t) => t.status === "open");
  const overdue = openTasks.filter((t) => new Date(t.dueAt).getTime() < Date.now());
  const dueToday = openTasks.filter((t) => isToday(t.dueAt));
  const upcoming = openTasks.filter((t) => new Date(t.dueAt).getTime() > Date.now());
  const completed = visibleTasks
    .filter((t) => t.status === "completed")
    .sort((a, b) => new Date(b.completedAt ?? 0).getTime() - new Date(a.completedAt ?? 0).getTime());

  const matchesFilters = (task: Task) => {
    const q = search.trim().toLowerCase();
    if (owner !== "all" && task.ownerId !== owner) return false;
    if (priority !== "all" && task.priority !== priority) return false;
    if (source !== "all" && task.source !== source) return false;
    if (q && !`${task.title} ${task.description}`.toLowerCase().includes(q)) return false;
    return true;
  };

  const listTasks = useMemo(
    () => visibleTasks.filter(matchesFilters),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleTasks, search, owner, priority, source],
  );
  const filteredOverdue = overdue.filter(matchesFilters);
  const filteredToday = dueToday.filter(matchesFilters);
  const filteredUpcoming = upcoming.filter(matchesFilters);
  const filteredCompleted = completed.filter(matchesFilters);
  const listPageCount = Math.max(1, Math.ceil(listTasks.length / PER_PAGE));
  const listCurrentPage = Math.min(listPage, listPageCount);
  const pagedListTasks = listTasks.slice((listCurrentPage - 1) * PER_PAGE, listCurrentPage * PER_PAGE);
  const overduePageCount = Math.max(1, Math.ceil(filteredOverdue.length / PER_PAGE));
  const overdueCurrentPage = Math.min(overduePage, overduePageCount);
  const pagedOverdue = filteredOverdue.slice((overdueCurrentPage - 1) * PER_PAGE, overdueCurrentPage * PER_PAGE);
  const todayPageCount = Math.max(1, Math.ceil(filteredToday.length / PER_PAGE));
  const todayCurrentPage = Math.min(todayPage, todayPageCount);
  const pagedToday = filteredToday.slice((todayCurrentPage - 1) * PER_PAGE, todayCurrentPage * PER_PAGE);
  const upcomingPageCount = Math.max(1, Math.ceil(filteredUpcoming.length / PER_PAGE));
  const upcomingCurrentPage = Math.min(upcomingPage, upcomingPageCount);
  const pagedUpcoming = filteredUpcoming.slice((upcomingCurrentPage - 1) * PER_PAGE, upcomingCurrentPage * PER_PAGE);
  const completedPageCount = Math.max(1, Math.ceil(filteredCompleted.length / PER_PAGE));
  const completedCurrentPage = Math.min(completedPage, completedPageCount);
  const pagedCompleted = filteredCompleted.slice((completedCurrentPage - 1) * PER_PAGE, completedCurrentPage * PER_PAGE);
  const activityPageCount = Math.max(1, Math.ceil(state.activity.length / PER_PAGE));
  const activityCurrentPage = Math.min(activityPage, activityPageCount);
  const pagedActivity = state.activity.slice((activityCurrentPage - 1) * PER_PAGE, activityCurrentPage * PER_PAGE);

  const handleSubmit = (input: TaskInput) => {
    if (editing) {
      updateTask(editing.id, input);
      toast({ title: "Task updated", tone: "success" });
    } else {
      createTask(input);
      toast({ title: "Task created", message: "Now visible on the Today dashboard.", tone: "success" });
    }
    setFormOpen(false);
    setEditing(null);
  };

  const openForm = (task?: Task | null) => {
    setEditing(task ?? null);
    setFormOpen(true);
  };

  const tabItems: TabItem[] = VIEWS.map((v) => ({
    value: v.value,
    ...v,
    count: v.value === "overdue" ? overdue.length : v.value === "today" ? dueToday.length : undefined,
  }));

  const filterBar = (
    <div className="flex flex-wrap items-end gap-2.5 border-b border-background-200 p-3 md:p-4">
      <Select
        label="Owner"
        size="sm"
        className="w-full sm:w-[12rem]"
        value={owner}
        onChange={(value) => {
          setOwner(value);
          setListPage(1);
          setOverduePage(1);
          setTodayPage(1);
          setUpcomingPage(1);
          setCompletedPage(1);
        }}
        options={owners}
      />
      <Select
        label="Priority"
        size="sm"
        className="w-full sm:w-[10rem]"
        value={priority}
        onChange={(value) => {
          setPriority(value);
          setListPage(1);
          setOverduePage(1);
          setTodayPage(1);
          setUpcomingPage(1);
          setCompletedPage(1);
        }}
        options={priorities}
      />
      <Select
        label="Source"
        size="sm"
        className="w-full sm:w-[12rem]"
        value={source}
        onChange={(value) => {
          setSource(value);
          setListPage(1);
          setOverduePage(1);
          setTodayPage(1);
          setUpcomingPage(1);
          setCompletedPage(1);
        }}
        options={sources}
      />
      <div className="flex-1 basis-full lg:basis-auto lg:min-w-[14rem]">
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
          Search
        </label>
        <SearchInput
          value={search}
          onChange={(value) => {
            setSearch(value);
            setListPage(1);
            setOverduePage(1);
            setTodayPage(1);
            setUpcomingPage(1);
            setCompletedPage(1);
          }}
          placeholder="Search tasks…"
        />
      </div>
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">Productivity</p>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">Planner</h1>
          <p className="mt-1 text-[13px] text-foreground-500">
            Tasks from Zoho CRM, Inbox, Events, Zoom and manual entries
          </p>
        </div>
        <Button leftIcon={<i className="ri-add-line"></i>} onClick={() => openForm(null)}>
          New task
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Open tasks" value={openTasks.length} icon="ri-checkbox-multiple-line" tone="primary" />
        <MetricCard label="Overdue" value={overdue.length} icon="ri-alarm-warning-line" tone="danger" />
        <MetricCard label="Due today" value={dueToday.length} icon="ri-sun-line" tone="accent" />
        <MetricCard label="Completed" value={completed.length} icon="ri-checkbox-circle-line" tone="success" />
      </div>

      <div className="kbc-no-scrollbar overflow-x-auto pb-1">
        <Tabs items={tabItems} value={view} onChange={(v) => setView(v as ViewKey)} />
      </div>

      {view === "overview" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader icon="ri-alarm-warning-line" iconTone="accent" title="Overdue" subtitle={`${overdue.length} tasks need attention`} />
            <TaskList tasks={overdue} onEdit={openForm} onDelete={setDeleteTarget} emptyMessage="Nothing overdue — great work." />
          </Card>
          <Card>
            <CardHeader icon="ri-sun-line" title="Due today" subtitle={`${dueToday.length} tasks today`} />
            <TaskList tasks={dueToday} onEdit={openForm} onDelete={setDeleteTarget} emptyMessage="No tasks due today." />
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader icon="ri-calendar-schedule-line" iconTone="secondary" title="Upcoming" subtitle={`${upcoming.length} scheduled ahead`} />
            <TaskList tasks={upcoming.slice(0, 6)} onEdit={openForm} onDelete={setDeleteTarget} emptyMessage="No upcoming tasks." />
          </Card>
        </div>
      ) : null}

      {view === "list" ? (
        <div className="rounded-lg border border-background-200 bg-background-50">
          {filterBar}
          <PaginationFooter
            position="top"
            currentPage={listCurrentPage}
            pageCount={listPageCount}
            total={listTasks.length}
            itemLabel="tasks"
            onPageChange={setListPage}
          />
          <TaskList tasks={pagedListTasks} onEdit={openForm} onDelete={setDeleteTarget} />
          <PaginationFooter
            currentPage={listCurrentPage}
            pageCount={listPageCount}
            total={listTasks.length}
            itemLabel="tasks"
            onPageChange={setListPage}
          />
        </div>
      ) : null}

      {view === "calendar" ? (
        <Card>
          <TaskCalendar tasks={visibleTasks} onEdit={openForm} />
        </Card>
      ) : null}

      {view === "overdue" ? (
        <Card>
          <CardHeader icon="ri-alarm-warning-line" iconTone="accent" title="Overdue tasks" />
          <PaginationFooter
            position="top"
            currentPage={overdueCurrentPage}
            pageCount={overduePageCount}
            total={filteredOverdue.length}
            itemLabel="tasks"
            onPageChange={setOverduePage}
          />
          <TaskList tasks={pagedOverdue} onEdit={openForm} onDelete={setDeleteTarget} emptyMessage="Nothing overdue." />
          <PaginationFooter
            currentPage={overdueCurrentPage}
            pageCount={overduePageCount}
            total={filteredOverdue.length}
            itemLabel="tasks"
            onPageChange={setOverduePage}
          />
        </Card>
      ) : null}

      {view === "today" ? (
        <Card>
          <CardHeader icon="ri-sun-line" title="Due today" />
          <PaginationFooter
            position="top"
            currentPage={todayCurrentPage}
            pageCount={todayPageCount}
            total={filteredToday.length}
            itemLabel="tasks"
            onPageChange={setTodayPage}
          />
          <TaskList tasks={pagedToday} onEdit={openForm} onDelete={setDeleteTarget} emptyMessage="No tasks due today." />
          <PaginationFooter
            currentPage={todayCurrentPage}
            pageCount={todayPageCount}
            total={filteredToday.length}
            itemLabel="tasks"
            onPageChange={setTodayPage}
          />
        </Card>
      ) : null}

      {view === "upcoming" ? (
        <Card>
          <CardHeader icon="ri-calendar-schedule-line" title="Upcoming" />
          <PaginationFooter
            position="top"
            currentPage={upcomingCurrentPage}
            pageCount={upcomingPageCount}
            total={filteredUpcoming.length}
            itemLabel="tasks"
            onPageChange={setUpcomingPage}
          />
          <TaskList tasks={pagedUpcoming} onEdit={openForm} onDelete={setDeleteTarget} />
          <PaginationFooter
            currentPage={upcomingCurrentPage}
            pageCount={upcomingPageCount}
            total={filteredUpcoming.length}
            itemLabel="tasks"
            onPageChange={setUpcomingPage}
          />
        </Card>
      ) : null}

      {view === "completed" ? (
        <Card>
          <CardHeader icon="ri-checkbox-circle-line" iconTone="secondary" title="Completed" subtitle={`${completed.length} tasks completed`} />
          <PaginationFooter
            position="top"
            currentPage={completedCurrentPage}
            pageCount={completedPageCount}
            total={filteredCompleted.length}
            itemLabel="tasks"
            onPageChange={setCompletedPage}
          />
          <TaskList tasks={pagedCompleted} onEdit={openForm} onDelete={setDeleteTarget} />
          <PaginationFooter
            currentPage={completedCurrentPage}
            pageCount={completedPageCount}
            total={filteredCompleted.length}
            itemLabel="tasks"
            onPageChange={setCompletedPage}
          />
        </Card>
      ) : null}

      {view === "activity" ? (
        <Card>
          <CardHeader icon="ri-history-line" iconTone="secondary" title="Activity history" subtitle="Workspace task activity" />
          <PaginationFooter
            position="top"
            currentPage={activityCurrentPage}
            pageCount={activityPageCount}
            total={state.activity.length}
            itemLabel="activity entries"
            onPageChange={setActivityPage}
          />
          <CardBody>
            <ul className="space-y-3">
              {pagedActivity.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background-100 text-base text-foreground-600">
                    <i className={entry.icon}></i>
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] text-foreground-700">
                      <span className="font-semibold">{userName(entry.actorId)}</span> {entry.action} {entry.target}
                    </p>
                    <p className="text-[11px] text-foreground-400">
                      {entry.module} · {relativeTime(entry.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
          <PaginationFooter
            currentPage={activityCurrentPage}
            pageCount={activityPageCount}
            total={state.activity.length}
            itemLabel="activity entries"
            onPageChange={setActivityPage}
          />
        </Card>
      ) : null}

      <TaskFormModal
        open={formOpen}
        task={editing}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={handleSubmit}
      />

      <Modal
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        size="sm"
        title="Delete this task?"
        description="This removes the task from the demonstration dataset."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              leftIcon={<i className="ri-delete-bin-line"></i>}
              onClick={() => {
                if (deleteTarget) {
                  deleteTask(deleteTarget.id);
                  toast({ title: "Task deleted", tone: "info" });
                }
                setDeleteTarget(null);
              }}
            >
              Delete task
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-foreground-600">{deleteTarget?.title}</p>
      </Modal>
    </div>
  );
}
