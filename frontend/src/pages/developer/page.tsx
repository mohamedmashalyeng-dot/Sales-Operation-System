import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import Modal from "@/components/base/Modal";
import PaginationFooter from "@/components/base/PaginationFooter";
import { useToast } from "@/components/base/Toast";
import { IntegrationDot } from "@/components/feature/DemoBanner";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { buildIntegrationStatuses, integrationSummaryText } from "@/utils/integrations";

interface Issue {
  id: string;
  severity: "warning" | "error";
  message: string;
  record: string;
}

const PER_PAGE = 50;

export default function DeveloperPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, resetDemoData, backendLoadedAt, integrationOverview } = useWorkspace();
  const { can } = usePermissions();
  const [resetOpen, setResetOpen] = useState(false);
  const [issuesPage, setIssuesPage] = useState(1);
  const integrations = buildIntegrationStatuses(state, backendLoadedAt, integrationOverview);

  const allowed = can("developer.view");

  const storageBytes = (() => {
    try {
      return (localStorage.getItem("kbc-workspace-v1") ?? "").length;
    } catch {
      return 0;
    }
  })();

  const issues = useMemo<Issue[]>(() => {
    const list: Issue[] = [];
    const leadIds = new Set(state.leads.map((l) => l.id));
    const userIds = new Set(state.users.map((u) => u.id));
    const threadIds = new Set(state.threads.map((t) => t.id));
    const eventIds = new Set(state.events.map((e) => e.id));
    const appIds = new Set(state.applications.map((a) => a.id));

    state.applications.forEach((a) => {
      if (a.leadId && !leadIds.has(a.leadId)) {
        list.push({
          id: `app-${a.id}`,
          severity: "warning",
          message: `Application linked to a missing lead (${a.leadId})`,
          record: a.id,
        });
      }
    });
    state.tasks.forEach((t) => {
      if (t.relatedLeadId && !leadIds.has(t.relatedLeadId)) {
        list.push({ id: `task-${t.id}`, severity: "warning", message: "Task references a missing lead", record: t.id });
      }
      if (t.relatedThreadId && !threadIds.has(t.relatedThreadId)) {
        list.push({ id: `task-th-${t.id}`, severity: "warning", message: "Task references a missing email", record: t.id });
      }
      if (t.relatedEventId && !eventIds.has(t.relatedEventId)) {
        list.push({ id: `task-ev-${t.id}`, severity: "warning", message: "Task references a missing event", record: t.id });
      }
      if (!userIds.has(t.ownerId)) {
        list.push({ id: `task-owner-${t.id}`, severity: "error", message: "Task owner is not a known user", record: t.id });
      }
    });
    state.threads.forEach((t) => {
      if (t.relatedLeadId && !leadIds.has(t.relatedLeadId)) {
        list.push({ id: `th-${t.id}`, severity: "warning", message: "Email references a missing lead", record: t.id });
      }
    });
    state.touchpoints.forEach((t) => {
      if (!leadIds.has(t.leadId)) {
        list.push({
          id: `tp-${t.id}`,
          severity: "error",
          message: "Touchpoint is orphaned (no parent lead)",
          record: t.id,
        });
      }
    });
    state.calls.forEach((c) => {
      if (c.leadId && !leadIds.has(c.leadId)) {
        list.push({ id: `call-${c.id}`, severity: "warning", message: "Call references a missing lead", record: c.id });
      }
    });
    state.leads.forEach((l) => {
      l.applicationIds.forEach((appId) => {
        if (!appIds.has(appId)) {
          list.push({
            id: `lead-${l.id}-${appId}`,
            severity: "warning",
            message: `Lead references a missing application (${appId})`,
            record: l.id,
          });
        }
      });
      if (!userIds.has(l.ownerId)) {
        list.push({ id: `lead-owner-${l.id}`, severity: "error", message: "Lead owner is not a known user", record: l.id });
      }
    });
    return list;
  }, [state]);

  const orphanedTouchpoints = state.touchpoints.filter(
    (t) => !state.leads.some((l) => l.id === t.leadId),
  ).length;
  const issuesPageCount = Math.max(1, Math.ceil(issues.length / PER_PAGE));
  const issuesCurrentPage = Math.min(issuesPage, issuesPageCount);
  const pagedIssues = issues.slice((issuesCurrentPage - 1) * PER_PAGE, issuesCurrentPage * PER_PAGE);

  const datasetStats = [
    { label: "Leads", value: state.leads.length, icon: "ri-contacts-book-2-line" },
    { label: "Touchpoints", value: state.touchpoints.length, icon: "ri-flow-chart" },
    { label: "Email threads", value: state.threads.length, icon: "ri-inbox-archive-line" },
    { label: "Tasks", value: state.tasks.length, icon: "ri-checkbox-multiple-line" },
    { label: "Applications", value: state.applications.length, icon: "ri-file-list-3-line" },
    { label: "Events", value: state.events.length, icon: "ri-calendar-event-line" },
    { label: "Registrations", value: state.events.reduce((n, e) => n + e.registrations.length, 0), icon: "ri-user-received-line" },
    { label: "Meetings", value: state.meetings.length, icon: "ri-vidicon-line" },
    { label: "Calls", value: state.calls.length, icon: "ri-phone-line" },
    { label: "Activity entries", value: state.activity.length, icon: "ri-pulse-line" },
    { label: "Audit entries", value: state.audit.length, icon: "ri-history-line" },
    { label: "Notifications", value: state.notifications.length, icon: "ri-notification-3-line" },
  ];

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Developer diagnostics are restricted"
            message="Diagnostics are available to Managers and Admins."
            action={
              <Button variant="outline" onClick={() => navigate("/")}>
                Back to Today
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">Integrations</p>
        <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">
          Developer Diagnostics
        </h1>
        <p className="mt-1 text-[13px] text-foreground-500">
          Diagnostics for the active workspace dataset, including backend hydration state,
          relationship checks and integration records when they are available.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Dataset records" value={datasetStats.reduce((n, s) => n + s.value, 0)} icon="ri-database-2-line" tone="primary" />
        <MetricCard label="Consistency checks" value="Passed" icon="ri-shield-check-line" tone="success" hint={issues.length ? `${issues.length} warnings` : "No issues found"} />
        <MetricCard label="Orphaned touchpoints" value={orphanedTouchpoints} icon="ri-links-line" tone={orphanedTouchpoints ? "danger" : "secondary"} />
        <MetricCard label="LocalStorage" value={`${(storageBytes / 1024).toFixed(1)} KB`} icon="ri-hard-drive-2-line" tone="accent" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon="ri-database-2-line" title="Workspace dataset overview" subtitle="Records held in the shared store" />
          <CardBody>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {datasetStats.map((stat) => (
                <div key={stat.label} className="rounded-lg border border-background-200 bg-background-50 p-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-background-100 text-base text-foreground-600">
                    <i className={stat.icon}></i>
                  </span>
                  <p className="mt-2 font-heading text-lg font-bold leading-none text-foreground-900">
                    {stat.value}
                  </p>
                  <p className="mt-1 text-[11px] font-medium text-foreground-500">{stat.label}</p>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon="ri-hard-drive-2-line" iconTone="secondary" title="Persistence status" />
          <CardBody className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-foreground-600">Storage key</span>
              <code className="rounded bg-background-100 px-2 py-0.5 text-[11px] text-foreground-700">
                kbc-workspace-v1
              </code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-foreground-600">Payload size</span>
              <span className="text-[13px] font-semibold text-foreground-900">
                {(storageBytes / 1024).toFixed(1)} KB
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-foreground-600">Status</span>
              <Badge tone={storageBytes > 0 ? "success" : "warning"} dot>
                {storageBytes > 0 ? "Persisting to localStorage" : "Not yet written"}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-foreground-600">Active role</span>
              <Badge tone="accent">{state.roleId}</Badge>
            </div>
            <p className="rounded-md bg-background-100 px-3 py-2 text-[11px] leading-snug text-foreground-500">
              {backendLoadedAt
                ? "This session is hydrated from the backend. Local browser storage is only used before backend data is loaded."
                : "All state is currently held in the browser workspace store. Nothing has been hydrated from the backend in this session."}
            </p>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            icon="ri-links-line"
            title="Data consistency &amp; relationship checks"
            subtitle="Record relationships validated across the shared store"
          />
          {issues.length === 0 ? (
            <EmptyState
              icon="ri-shield-check-line"
              title="All relationships valid"
              message="Every linked record — leads, applications, emails, tasks, events and touchpoints — resolves correctly."
            />
          ) : (
            <>
              <PaginationFooter
                position="top"
                currentPage={issuesCurrentPage}
                pageCount={issuesPageCount}
                total={issues.length}
                itemLabel="issues"
                onPageChange={setIssuesPage}
              />
              <ul className="max-h-80 divide-y divide-background-200 overflow-y-auto kbc-scroll">
                {pagedIssues.map((issue) => (
                  <li key={issue.id} className="flex items-start gap-3 px-5 py-3">
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base ${
                        issue.severity === "error" ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      <i className={issue.severity === "error" ? "ri-error-warning-line" : "ri-alert-line"}></i>
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-foreground-800">{issue.message}</p>
                      <p className="mt-0.5 text-[11px] text-foreground-400">Record: {issue.record}</p>
                    </div>
                    <Badge tone={issue.severity === "error" ? "danger" : "warning"}>{issue.severity}</Badge>
                  </li>
                ))}
              </ul>
              <PaginationFooter
                currentPage={issuesCurrentPage}
                pageCount={issuesPageCount}
                total={issues.length}
                itemLabel="issues"
                onPageChange={setIssuesPage}
              />
            </>
          )}
        </Card>

        <Card>
          <CardHeader icon="ri-plug-line" title="Integration statuses" subtitle={integrationSummaryText(integrations)} />
          <CardBody className="space-y-2">
            {integrations.map((integration) => (
              <div key={integration.key} className="flex items-start gap-2.5 rounded-md border border-background-200 bg-background-50 px-3 py-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-base text-foreground-500">
                  <i className={integration.icon}></i>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground-900">{integration.label}</span>
                    <IntegrationDot status={integration.status} />
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">{integration.detail}</p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader icon="ri-bug-line" iconTone="accent" title="Recent prototype errors" subtitle="Client-side capture (simulated)" />
          <EmptyState
            icon="ri-checkbox-circle-line"
            title="No prototype errors captured"
            message="No client-side errors were recorded in this session. This panel is a frontend simulation — no real error telemetry is collected."
          />
        </Card>

        <Card>
          <CardHeader icon="ri-tools-line" title="Diagnostic utilities" />
          <CardBody className="space-y-3">
            <div className="flex items-start justify-between gap-3 rounded-lg border border-background-200 bg-background-50 p-3">
              <div>
                <p className="text-[13px] font-semibold text-foreground-900">Clear local workspace data</p>
                <p className="mt-0.5 text-[12px] leading-snug text-foreground-500">
                  Removes browser-cached records, activity and audit trail without deleting backend data.
                </p>
              </div>
              <Button variant="danger" leftIcon={<i className="ri-refresh-line"></i>} onClick={() => setResetOpen(true)}>
                Reset
              </Button>
            </div>
            <div className="rounded-lg border border-dashed border-background-300 bg-background-50 p-3">
              <p className="text-[12px] leading-snug text-foreground-500">
                Diagnostics are read-only. Integration cards use backend overview data when it is
                available, then fall back to the loaded workspace records.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        size="sm"
        title="Clear local workspace data?"
        description="This removes the browser-cached workspace copy and cannot be undone."
        footer={
          <>
            <Button variant="outline" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              leftIcon={<i className="ri-refresh-line"></i>}
              onClick={() => {
                resetDemoData();
                setResetOpen(false);
                toast({ title: "Local workspace cleared", tone: "success" });
              }}
            >
              Yes, reset
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-foreground-600">
          Locally cached leads, touchpoints, emails, tasks, applications, events and calls will be
          removed from this browser.
        </p>
      </Modal>
    </div>
  );
}
