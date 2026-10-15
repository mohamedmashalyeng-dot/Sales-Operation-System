import LoadingState from "@/components/base/LoadingState";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import Tabs from "@/components/base/Tabs";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import EligibilityPanel from "@/pages/leads/components/EligibilityPanel";
import OnboardingPanel from "@/pages/employers/components/OnboardingPanel";
import EnrolmentPanel from "@/pages/leads/components/EnrolmentPanel";
import { APPLICATION_STATUSES } from "@/config/crm";
import { usePermissions } from "@/hooks/usePermissions";
import TaskFormModal from "@/pages/planner/components/TaskFormModal";
import { useWorkspace, type TaskInput } from "@/store/WorkspaceProvider";
import type { ApplicationDoc, ApplicationStatus } from "@/store/types";
import { APP_STATUS_TONES } from "@/utils/crm";
import { formatDate, formatDateTime, relativeTime } from "@/utils/format";

const DOC_STATUS_TONES: Record<ApplicationDoc["status"], "success" | "accent" | "warning"> = {
  Verified: "success",
  Received: "accent",
  Pending: "warning",
};

const DOC_CYCLE: Record<ApplicationDoc["status"], ApplicationDoc["status"]> = {
  Pending: "Received",
  Received: "Verified",
  Verified: "Pending",
};

export default function ApplicationDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    state,
    loadApplicationDetail,
    backendLoadedAt,
    userName,
    updateApplicationStatus,
    updateApplication,
    addApplicationNote,
    createTask,
  } = useWorkspace();
  const { canSeeOwner, seesAll, currentUserId, can } = usePermissions();

  const application = state.applications.find((a) => a.id === id);

  const [tab, setTab] = useState("overview");
  const [statusModal, setStatusModal] = useState(false);
  const [nextStatus, setNextStatus] = useState<ApplicationStatus>("Under review");
  const [statusNote, setStatusNote] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    if (!id || !backendLoadedAt) return;
    const controller = new AbortController();
    setLoading(true); setLoadError('');
    void loadApplicationDetail(id, controller.signal).catch(error => {
      if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : 'Application could not be loaded.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, loadApplicationDetail, backendLoadedAt]);

  const visible = useMemo(() => {
    if (!application) return false;
    if (seesAll) return true;
    if (canSeeOwner(application.ownerId)) return true;
    if (application.leadId) {
      const lead = state.leads.find((l) => l.id === application.leadId);
      if (lead && lead.ownerId === currentUserId) return true;
    }
    return false;
  }, [application, seesAll, canSeeOwner, currentUserId, state.leads]);

  if (loading) return <LoadingState className="p-6">Loading application...</LoadingState>;
  if (loadError || !application || !visible) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Application not available"
            message={loadError || "This application does not exist, or your role cannot see it."}
            action={
              <Button variant="outline" onClick={() => navigate("/applications")}>
                Back to applications
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const relatedLead = application.leadId
    ? state.leads.find((l) => l.id === application.leadId)
    : undefined;
  const relatedThreads = state.threads.filter(
    (t) => t.relatedLeadId && t.relatedLeadId === application.leadId,
  );
  const activity = state.activity.filter((a) => a.entityId === application.id);
  const tasks = state.tasks.filter((t) => t.title.includes(application.applicantName) || t.relatedLeadId === application.leadId).slice(0, 5);

  const openStatusModal = () => {
    setNextStatus(application.status === "Submitted" ? "Under review" : application.status);
    setStatusNote("");
    setStatusModal(true);
  };

  const submitStatus = () => {
    updateApplicationStatus(application.id, nextStatus, statusNote || "Status updated.");
    toast({ title: "Application status updated", message: `Moved to ${nextStatus}.`, tone: "success" });
    setStatusModal(false);
  };

  const cycleDoc = (doc: ApplicationDoc) => {
    if (!can("applications.edit")) {
      toast({ title: "Not permitted", message: "Your demo role cannot edit documents.", tone: "error" });
      return;
    }
    const next = application.documents.map((d) =>
      d.id === doc.id ? { ...d, status: DOC_CYCLE[d.status] } : d,
    );
    updateApplication(application.id, { documents: next });
  };

  const handleTask = (input: TaskInput) => {
    createTask(input);
    toast({ title: "Follow-up task created", message: "Added to the Planner.", tone: "success" });
    setTaskOpen(false);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-foreground-400">
        <Link to="/applications" className="font-semibold text-foreground-600 hover:text-primary-600">
          Applications
        </Link>
        <i className="ri-arrow-right-s-line"></i>
        <span>{application.id}</span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <Avatar name={application.applicantName} size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-extrabold text-foreground-950">
                {application.applicantName}
              </h1>
              <Badge tone={APP_STATUS_TONES[application.status]}>{application.status}</Badge>
            </div>
            <p className="mt-1 text-[13px] text-foreground-500">
              {application.programme} · {application.intake} · Owner {userName(application.ownerId)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" leftIcon={<i className="ri-arrow-left-line"></i>} onClick={() => navigate("/applications")}>
            Back
          </Button>
          <PermissionGate capability="applications.edit">
            <Button variant="outline" leftIcon={<i className="ri-add-line"></i>} onClick={() => setTaskOpen(true)}>
              Follow-up task
            </Button>
          </PermissionGate>
          <PermissionGate capability="applications.edit">
            <Button leftIcon={<i className="ri-exchange-line"></i>} onClick={openStatusModal}>
              Change stage
            </Button>
          </PermissionGate>
        </div>
      </div>

      <div className="kbc-no-scrollbar overflow-x-auto pb-1">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: "overview", label: "Overview", icon: "ri-file-list-3-line" },
            { value: "eligibility", label: "Eligibility", icon: "ri-shield-check-line" },
            { value: "onboarding", label: "Employer onboarding", icon: "ri-building-2-line" },
          ]}
        />
      </div>

      {tab === "overview" ? (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader icon="ri-user-line" title="Applicant information" />
            <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Full name" value={application.applicantName} />
              <Field label="Email" value={application.email} />
              <Field label="Phone" value={application.phone} />
              <Field label="Reference" value={application.id} />
              <Field label="Enrolment source" value={application.enrolmentSource || 'Not recorded'} />
              <Field label="Contract status" value={application.contractStatus || 'Not recorded'} />
              <Field label="Submitted" value={formatDateTime(application.submittedAt)} />
              <Field label="Last updated" value={formatDateTime(application.updateAt)} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              icon="ri-file-list-3-line"
              iconTone="accent"
              title="Documents & checklist"
              subtitle="Recorded document status. Verification requires supporting evidence."
            />
            <CardBody>
              {application.documents.length === 0 ? (
                <p className="text-[13px] text-foreground-500">No documents recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {application.documents.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-background-200 bg-background-50 px-3 py-2.5"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background-100 text-base text-foreground-500">
                          <i className="ri-file-text-line"></i>
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-[13px] font-semibold text-foreground-900">
                            {doc.name}
                          </span>
                          <span className="block text-[11px] text-foreground-400">{doc.type}</span>
                        </span>
                      </span>
                      <Badge tone={DOC_STATUS_TONES[doc.status]}>{doc.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon="ri-sticky-note-line" iconTone="secondary" title="Internal notes" />
            <CardBody className="space-y-3">
              {application.notes ? (
                <pre className="kbc-scroll max-h-52 overflow-y-auto whitespace-pre-wrap rounded-md bg-background-100 p-3 font-sans text-[12.5px] leading-relaxed text-foreground-700">
                  {application.notes}
                </pre>
              ) : (
                <p className="text-[13px] text-foreground-500">No internal notes yet.</p>
              )}
              <PermissionGate capability="applications.note">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <textarea
                    value={noteDraft}
                    onChange={(e) => setNoteDraft(e.target.value.slice(0, 500))}
                    rows={2}
                    placeholder="Add an internal note (max 500 characters)…"
                    className="min-h-[2.5rem] flex-1 rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                  />
                  <Button
                    className="self-start"
                    disabled={!noteDraft.trim()}
                    onClick={() => {
                      addApplicationNote(application.id, noteDraft.trim());
                      setNoteDraft("");
                      toast({ title: "Note added", tone: "success" });
                    }}
                  >
                    Add note
                  </Button>
                </div>
              </PermissionGate>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader icon="ri-shield-check-line" title="Stage history" />
            <CardBody>
              <ol className="space-y-3">
                {application.history.map((h) => (
                  <li key={h.id} className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-background-200 text-base text-foreground-600">
                      <i className="ri-flag-line"></i>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-900">{h.status}</p>
                      <p className="text-[11px] text-foreground-500">
                        {userName(h.byId)} · {formatDateTime(h.at)}
                      </p>
                      {h.note ? (
                        <p className="mt-0.5 text-[12px] text-foreground-600">{h.note}</p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon="ri-links-line" iconTone="secondary" title="Linked records" />
            <CardBody className="space-y-3">
              {relatedLead ? (
                <button
                  type="button"
                  onClick={() => navigate(`/leads/${relatedLead.id}`)}
                  className="flex w-full cursor-pointer items-center gap-2.5 rounded-md border border-background-200 bg-background-50 p-3 text-left hover:border-primary-300 hover:bg-primary-50/40"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-100 text-base text-primary-700">
                    <i className="ri-contacts-book-2-line"></i>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-foreground-900">
                      {relatedLead.name}
                    </span>
                    <span className="block truncate text-[11px] text-foreground-500">
                      Lead · {relatedLead.stage}
                    </span>
                  </span>
                  <i className="ri-arrow-right-s-line text-foreground-400"></i>
                </button>
              ) : (
                <p className="text-[13px] text-foreground-500">No linked lead.</p>
              )}

              <div>
                <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-foreground-400">
                  Related emails
                </p>
                {relatedThreads.length === 0 ? (
                  <p className="text-[12px] text-foreground-500">No linked email threads.</p>
                ) : (
                  <ul className="space-y-2">
                    {relatedThreads.map((thread) => (
                      <li key={thread.id}>
                        <button
                          type="button"
                          onClick={() => navigate(`/inbox/${encodeURIComponent(thread.id)}`)}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-background-200 bg-background-50 px-3 py-2 text-left text-[12.5px] text-foreground-700 hover:border-primary-300"
                        >
                          <i className="ri-mail-line text-foreground-500"></i>
                          <span className="min-w-0 flex-1 truncate">{thread.subject}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon="ri-history-line" title="Activity" subtitle={`${activity.length} entries`} />
            <CardBody>
              {activity.length === 0 ? (
                <p className="text-[13px] text-foreground-500">No activity recorded yet.</p>
              ) : (
                <ul className="space-y-3">
                  {activity.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-2.5">
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background-100 text-base text-foreground-600">
                        <i className={entry.icon}></i>
                      </span>
                      <div className="min-w-0">
                        <p className="text-[12.5px] text-foreground-700">
                          <span className="font-semibold">{userName(entry.actorId)}</span> {entry.action}{" "}
                          {entry.target}
                        </p>
                        <p className="text-[11px] text-foreground-400">{relativeTime(entry.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {tasks.length > 0 ? (
                <div className="mt-4 border-t border-background-200 pt-3">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-foreground-400">
                    Follow-up tasks
                  </p>
                  <ul className="space-y-1.5">
                    {tasks.map((t) => (
                      <li key={t.id} className="flex items-center gap-2 text-[12.5px] text-foreground-700">
                        <i
                          className={
                            t.status === "completed"
                              ? "ri-checkbox-circle-fill text-green-500"
                              : "ri-checkbox-blank-circle-line text-foreground-400"
                          }
                        ></i>
                        <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>
      </div>
      ) : null}

      {tab === "eligibility" ? (
        relatedLead ? (
          <EligibilityPanel lead={relatedLead} />
        ) : (
          <Card>
            <EmptyState
              icon="ri-link-m"
              title="No linked lead"
              message="Eligibility is assessed against a lead. Link this application to a lead to run the funding screening."
            />
          </Card>
        )
      ) : null}

      {tab === "onboarding" ? (
        <div className="space-y-5">
          <OnboardingPanel
            employerName={relatedLead?.name ?? application.applicantName}
            employerContact={application.applicantName}
            leadId={application.leadId}
            applicationId={application.id}
          />
          {relatedLead ? <EnrolmentPanel lead={relatedLead} /> : null}
        </div>
      ) : null}

      <Modal
        open={statusModal}
        onClose={() => setStatusModal(false)}
        size="sm"
        title="Change application stage"
        description={`Current stage: ${application.status}`}
        footer={
          <>
            <Button variant="outline" onClick={() => setStatusModal(false)}>
              Cancel
            </Button>
            <Button leftIcon={<i className="ri-check-line"></i>} onClick={submitStatus}>
              Update stage
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Select
            label="New stage"
            value={nextStatus}
            onChange={(v) => setNextStatus(v as ApplicationStatus)}
            options={APPLICATION_STATUSES.map((s) => ({ value: s, label: s }))}
          />
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
              Note
            </label>
            <textarea
              value={statusNote}
              onChange={(e) => setStatusNote(e.target.value.slice(0, 500))}
              rows={3}
              placeholder="Reason for the change (max 500 characters)…"
              className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
            />
          </div>
          {nextStatus === "Enrolled" || nextStatus === "Offer" ? (
            <p className="flex items-center gap-1.5 rounded-md bg-accent-50 px-2.5 py-2 text-[11px] font-medium text-accent-900">
              <i className="ri-information-line"></i>
              This represents a simulated approval in the demonstration workspace.
            </p>
          ) : null}
        </div>
      </Modal>

      <TaskFormModal
        open={taskOpen}
        task={null}
        defaults={{ relatedLeadId: application.leadId, source: "Applications" }}
        onClose={() => setTaskOpen(false)}
        onSubmit={handleTask}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-0.5 text-[13px] font-medium text-foreground-800">{value}</p>
    </div>
  );
}
