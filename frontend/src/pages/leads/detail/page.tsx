import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import Modal from "@/components/base/Modal";
import Tabs from "@/components/base/Tabs";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import { usePermissions } from "@/hooks/usePermissions";
import TaskFormModal from "@/pages/planner/components/TaskFormModal";
import LeadFormModal from "@/pages/leads/components/LeadFormModal";
import ClosingModal from "@/pages/leads/components/ClosingModal";
import LeadCallJourney from "@/pages/leads/components/LeadCallJourney";
import BusinessRoutingActions from "@/components/feature/BusinessRoutingActions";
import EnrolmentPanel from "@/pages/leads/components/EnrolmentPanel";
import SessionBadge from "@/pages/leads/components/SessionBadge";
import { BackendRequestError, BackendRequestTimeoutError } from "@/store/backendSync";
import { useWorkspace, type LeadInput, type ClosingInput } from "@/store/WorkspaceProvider";
import type { Task } from "@/store/types";
import { APP_STATUS_TONES, PRIORITY_TONES, STAGE_TONES, formatCurrency, toInputDateTime } from "@/utils/crm";
import { formatDate, formatDateTime, relativeTime } from "@/utils/format";

const TABS = [
  { value: "overview", label: "Overview", icon: "ri-profile-line" },
  { value: "enrolment", label: "Enrolment", icon: "ri-graduation-cap-line" },
  { value: "journey", label: "Lead Journey", icon: "ri-route-line" },
  { value: "activity", label: "Activity", icon: "ri-history-line" },
  { value: "tasks", label: "Tasks", icon: "ri-checkbox-multiple-line" },
  { value: "applications", label: "Applications", icon: "ri-file-list-3-line" },
  { value: "emails", label: "Emails", icon: "ri-mail-line" },
];

export default function LeadDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    state,
    backendLoading,
    loadLeadDetail,
    userName,
    currentUser,
    updateLead,
    deleteLead,
    addLeadNote,
    createTask,
    updateTask,
    completeTask,
    reopenTask,
    logCall,
    closeLead,
    reopenLead,
  } = useWorkspace();
  const { canSeeOwner } = usePermissions();

  const [tab, setTab] = useState("overview");
  const [note, setNote] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [closingOpen, setClosingOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [detailRequest, setDetailRequest] = useState(0);
  const [detailState, setDetailState] = useState<{ id: string; loading: boolean; error: string | null }>({
    id: "", loading: true, error: null,
  });

  useEffect(() => {
    if (backendLoading) return;
    if (!id) {
      setDetailState({ id, loading: false, error: "Choose a lead to open its details." });
      return;
    }
    const controller = new AbortController();
    setDetailState({ id, loading: true, error: null });
    void loadLeadDetail(id, controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        if (loaded.id !== id) {
          navigate(`/leads/${encodeURIComponent(loaded.id)}`, { replace: true });
          return;
        }
        setDetailState({ id, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof BackendRequestError && (error.status === 403 || error.status === 404)
          ? "This lead does not exist, or you do not have permission to view it."
          : error instanceof BackendRequestTimeoutError
            ? "The lead is taking too long to load. Please try again."
            : "The lead could not be loaded. Please try again.";
        setDetailState({ id, loading: false, error: message });
      });
    return () => controller.abort();
  }, [id, backendLoading, loadLeadDetail, navigate, detailRequest]);

  const lead = state.leads.find((l) => l.id === id);

  const relatedTasks = useMemo(
    () => state.tasks.filter((t) => t.relatedLeadId === id),
    [state.tasks, id],
  );
  const relatedThreads = useMemo(
    () => state.threads.filter((t) => t.relatedLeadId === id),
    [state.threads, id],
  );
  const relatedApplications = useMemo(
    () => state.applications.filter((a) => a.leadId === id || (lead ? lead.applicationIds.includes(a.id) : false)),
    [state.applications, id, lead],
  );
  const leadActivity = useMemo(
    () => state.activity.filter((a) => a.entityId === id),
    [state.activity, id],
  );


  if (backendLoading || detailState.id !== id || detailState.loading) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6" role="status" aria-live="polite">
        <Card>
          <EmptyState icon="ri-loader-4-line animate-spin" title="Loading lead" message="Opening lead details." />
        </Card>
      </div>
    );
  }

  if (detailState.error || !lead || !canSeeOwner(lead.ownerId)) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Lead not available"
            message={detailState.error || "This lead does not exist, or you do not have permission to view it."}
            action={
              <div className="flex justify-center gap-2">
                {detailState.error ? (
                  <Button variant="outline" onClick={() => setDetailRequest((request) => request + 1)}>
                    Try again
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => navigate("/leads")}>
                  Back to Leads
                </Button>
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  const handleEdit = (input: LeadInput) => {
    updateLead(lead.id, input);
    setEditOpen(false);
    toast({ title: "Lead updated", message: `${input.name} was saved.`, tone: "success" });
  };

  const handleLogCall = () => {
    logCall({
      direction: "outgoing",
      status: "connected",
      durationSec: 0,
      caller: currentUser.name,
      receiver: lead.contactName,
      phoneNumber: lead.phone,
      leadId: lead.id,
      notes: "Logged from lead detail.",
      matchConfidence: "verified",
    });
    toast({ title: "Call logged", message: "A demonstration call record was added to Zoom.", tone: "success" });
  };

  const isClosed = lead.stage === "Won" || lead.stage === "Lost";

  const handleClose = (input: ClosingInput) => {
    closeLead(input);
    setClosingOpen(false);
    toast({
      title: input.outcome === "won" ? "Lead closed won" : "Lead closed lost",
      message: "The lead closing details were saved.",
      tone: input.outcome === "won" ? "success" : "info",
    });
  };

  const handleReopen = () => {
    reopenLead(lead.id);
    toast({ title: "Lead reopened", message: "The lead is active again.", tone: "info" });
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <button
        type="button"
        onClick={() => navigate("/leads")}
        className="inline-flex cursor-pointer items-center gap-1.5 text-[13px] font-semibold text-foreground-500 transition-colors hover:text-primary-600"
      >
        <i className="ri-arrow-left-line"></i> Back to Leads
      </button>

      <Card>
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <Avatar name={lead.name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-heading text-xl font-extrabold text-foreground-950">
                  {lead.name}
                </h1>
                <Badge tone={STAGE_TONES[lead.stage]}>{lead.journeyStage || lead.stage}</Badge>
                <Badge tone={PRIORITY_TONES[lead.priority]}>{lead.priority} priority</Badge>
                {lead.zohoSynced ? (
                  <Badge tone="primary" icon="ri-cloud-line">
                    Zoho {lead.zohoId}
                  </Badge>
                ) : (
                  <Badge tone="neutral">Not synced</Badge>
                )}
                <SessionBadge lead={lead} />
              </div>
              <p className="mt-1.5 text-[13px] text-foreground-500">
                {lead.contactName} · {lead.email} · {lead.phone}
              </p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {lead.tags.map((tag) => (
                  <Badge key={tag} tone="secondary">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <PermissionGate capability="leads.logCall">
              <Button variant="outline" leftIcon={<i className="ri-phone-line"></i>} onClick={handleLogCall}>
                Log call
              </Button>
            </PermissionGate>
            <Button
              variant="outline"
              leftIcon={<i className="ri-mail-send-line"></i>}
              onClick={() => navigate("/inbox")}
            >
              Compose email
            </Button>
            <PermissionGate capability="leads.edit">
              {isClosed ? (
                <Button
                  variant="outline"
                  leftIcon={<i className="ri-arrow-go-back-line"></i>}
                  onClick={handleReopen}
                >
                  Reopen
                </Button>
              ) : (
                <Button
                  variant="accent"
                  leftIcon={<i className="ri-flag-2-line"></i>}
                  onClick={() => setClosingOpen(true)}
                >
                  Close lead
                </Button>
              )}
            </PermissionGate>
            <PermissionGate capability="leads.edit">
              <Button variant="outline" leftIcon={<i className="ri-pencil-line"></i>} onClick={() => setEditOpen(true)}>
                Edit
              </Button>
            </PermissionGate>
            <PermissionGate capability="leads.delete">
              <Button variant="danger" size="icon" aria-label="Delete lead" onClick={() => setDeleteOpen(true)}>
                <i className="ri-delete-bin-line"></i>
              </Button>
            </PermissionGate>
          </div>
        </div>
        <div className="border-t border-background-200 px-5 py-3">
          <Tabs items={TABS} value={tab} onChange={setTab} />
        </div>
      </Card>

      {tab === "overview" ? <>
        <div className="rounded-xl border border-background-200 bg-white p-4">
          <h2 className="mb-2 font-semibold">Review &amp; route lead</h2>
          <BusinessRoutingActions key={lead.id} leadId={lead.id} />
        </div>
        <LeadCallJourney leadId={lead.id} />
      </> : null}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          {tab === "overview" ? (
            <Card>
              <CardHeader icon="ri-profile-line" title="Lead overview" subtitle="Record details" />
              <CardBody className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                <Detail label="Programme" value={lead.programme} />
                <Detail label="Intake" value={lead.intake} />
                <Detail label="Source" value={lead.source} />
                <Detail label="Owner" value={userName(lead.ownerId)} />
                <Detail label="Estimated value" value={formatCurrency(lead.value)} />
                <Detail label="Created" value={formatDate(lead.createdAt)} />
                <Detail label="Last contact" value={relativeTime(lead.lastContactAt)} />
                <Detail label="Next action due" value={lead.nextActionAt ? formatDateTime(lead.nextActionAt) : 'Not scheduled'} />
              </CardBody>
            </Card>
          ) : null}

          {tab === "enrolment" ? <EnrolmentPanel lead={lead} /> : null}

          {tab === "journey" ? (
            <LeadCallJourney leadId={lead.id} detailed />
          ) : null}

          {tab === "activity" ? (
            <Card>
              <CardHeader icon="ri-history-line" title="Activity timeline" subtitle={`${leadActivity.length} recorded events`} />
              {leadActivity.length === 0 ? (
                <EmptyState icon="ri-history-line" title="No activity yet" message="Actions on this lead will appear here." />
              ) : (
                <ul className="divide-y divide-background-200">
                  {leadActivity.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-3 px-5 py-3.5">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background-100 text-base text-foreground-600">
                        <i className={entry.icon}></i>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-foreground-800">
                          <span className="font-semibold">{userName(entry.actorId)}</span>{" "}
                          {entry.action} {entry.target}
                        </p>
                        <p className="mt-0.5 text-[11px] text-foreground-400">
                          {entry.module} · {relativeTime(entry.createdAt)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {tab === "tasks" ? (
            <Card>
              <CardHeader
                icon="ri-checkbox-multiple-line"
                title="Tasks & follow-ups"
                subtitle={`${relatedTasks.length} linked tasks`}
                action={
                  <Button
                    size="sm"
                    leftIcon={<i className="ri-add-line"></i>}
                    onClick={() => {
                      setEditingTask(null);
                      setTaskOpen(true);
                    }}
                  >
                    New task
                  </Button>
                }
              />
              {relatedTasks.length === 0 ? (
                <EmptyState icon="ri-checkbox-multiple-line" title="No tasks linked" message="Create a follow-up task for this lead." />
              ) : (
                <ul className="divide-y divide-background-200">
                  {relatedTasks.map((task) => (
                    <li key={task.id} className="flex items-start gap-3 px-5 py-3.5">
                      <button
                        type="button"
                        aria-label={task.status === "completed" ? "Reopen task" : "Complete task"}
                        onClick={() => (task.status === "completed" ? reopenTask(task.id) : completeTask(task.id))}
                        className={`mt-0.5 flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded border text-[12px] ${
                          task.status === "completed"
                            ? "border-green-500 bg-green-500 text-white"
                            : "border-background-400 bg-background-50"
                        }`}
                      >
                        {task.status === "completed" ? <i className="ri-check-line"></i> : null}
                      </button>
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-[13px] font-semibold ${
                            task.status === "completed" ? "text-foreground-400 line-through" : "text-foreground-900"
                          }`}
                        >
                          {task.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-foreground-400">
                          {task.source} · due {formatDateTime(task.dueAt)}
                        </p>
                      </div>
                      <Badge tone={PRIORITY_TONES[task.priority]}>{task.priority}</Badge>
                      <button
                        type="button"
                        onClick={() => {
                          setEditingTask(task);
                          setTaskOpen(true);
                        }}
                        className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-base text-foreground-400 hover:bg-background-100 hover:text-foreground-700"
                        aria-label="Edit task"
                      >
                        <i className="ri-pencil-line"></i>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {tab === "applications" ? (
            <Card>
              <CardHeader icon="ri-file-list-3-line" title="Related applications" subtitle={`${relatedApplications.length} applications`} />
              {relatedApplications.length === 0 ? (
                <EmptyState icon="ri-file-list-3-line" title="No applications" message="This lead has not submitted an application yet." />
              ) : (
                <ul className="divide-y divide-background-200">
                  {relatedApplications.map((app) => (
                    <li key={app.id} className="flex items-center gap-3 px-5 py-3.5">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-secondary-100 text-base text-secondary-900">
                        <i className="ri-file-list-3-line"></i>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-semibold text-foreground-900">{app.programme}</p>
                        <p className="text-[11px] text-foreground-400">
                          {app.id} · {app.intake} · submitted {formatDate(app.submittedAt)}
                        </p>
                      </div>
                      <Badge tone={APP_STATUS_TONES[app.status]}>{app.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}

          {tab === "emails" ? (
            <Card>
              <CardHeader icon="ri-mail-line" title="Email history" subtitle={`${relatedThreads.length} threads`} />
              {relatedThreads.length === 0 ? (
                <EmptyState icon="ri-mail-line" title="No linked emails" message="No email threads are linked to this lead." />
              ) : (
                <ul className="divide-y divide-background-200">
                  {relatedThreads.map((thread) => (
                    <li key={thread.id}>
                      <button
                        type="button"
                        onClick={() => navigate(`/inbox/${encodeURIComponent(thread.id)}`)}
                        className="flex w-full cursor-pointer items-start gap-3 px-5 py-3.5 text-left hover:bg-background-100/70"
                      >
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary-100 text-base text-primary-700">
                          <i className="ri-mail-line"></i>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13px] font-semibold text-foreground-900">
                            {thread.subject}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-foreground-400">
                            {thread.senderName} · {relativeTime(thread.receivedAt)}
                          </p>
                        </div>
                        <Badge tone={thread.responseState === "resolved" ? "success" : "warning"}>
                          {thread.responseState}
                        </Badge>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : null}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader icon="ri-focus-3-line" iconTone="accent" title="Next action" />
            <CardBody>
              <p className="text-[13px] font-semibold text-foreground-900">{lead.nextAction || 'No next action set'}</p>
              <p className="mt-1 text-[12px] text-foreground-500">
                {lead.nextActionAt ? `Due ${formatDateTime(lead.nextActionAt)}` : 'Not scheduled'}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="subtle"
                  leftIcon={<i className="ri-calendar-check-line"></i>}
                  onClick={() => {
                    setEditingTask(null);
                    setTaskOpen(true);
                  }}
                >
                  Add follow-up task
                </Button>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon="ri-sticky-note-line" iconTone="secondary" title="Notes" subtitle={`${lead.notes.length} notes`} />
            <CardBody>
              <PermissionGate capability="leads.edit">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Add a note to this lead…"
                  className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    disabled={!note.trim()}
                    onClick={() => {
                      addLeadNote(lead.id, note.trim());
                      setNote("");
                      toast({ title: "Note added", tone: "success" });
                    }}
                  >
                    Add note
                  </Button>
                </div>
              </PermissionGate>
              {lead.notes.length > 0 ? (
                <ul className="mt-4 space-y-3 border-t border-background-200 pt-4">
                  {lead.notes.map((n) => (
                    <li key={n.id}>
                      <p className="text-[12px] text-foreground-700">{n.body}</p>
                      <p className="mt-0.5 text-[11px] text-foreground-400">
                        {userName(n.authorId)} · {relativeTime(n.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>

      <LeadFormModal open={editOpen} lead={lead} onClose={() => setEditOpen(false)} onSubmit={handleEdit} />

      <TaskFormModal
        open={taskOpen}
        task={editingTask}
        defaults={{
          relatedLeadId: lead.id,
          ownerId: lead.ownerId,
          programme: lead.programme,
          source: "Manual",
          dueAt: toInputDateTime(lead.nextActionAt),
        }}
        onClose={() => {
          setTaskOpen(false);
          setEditingTask(null);
        }}
        onSubmit={(input) => {
          if (editingTask) updateTask(editingTask.id, input);
          else createTask(input);
          setTaskOpen(false);
          setEditingTask(null);
          toast({ title: editingTask ? "Task updated" : "Task created", tone: "success" });
        }}
      />

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        size="sm"
        title="Delete this lead?"
        description="This removes the record from the demonstration dataset."
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              leftIcon={<i className="ri-delete-bin-line"></i>}
              onClick={() => {
                deleteLead(lead.id);
                toast({ title: "Lead deleted", message: `${lead.name} was removed.`, tone: "info" });
                navigate("/leads");
              }}
            >
              Delete lead
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-foreground-600">{lead.name}</p>
      </Modal>

      <ClosingModal
        open={closingOpen}
        onClose={() => setClosingOpen(false)}
        lead={lead}
        onSubmit={handleClose}
      />
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-1 text-[13px] font-medium text-foreground-900">{value}</p>
    </div>
  );
}
