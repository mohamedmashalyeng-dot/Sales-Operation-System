import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import BarList from "@/components/base/BarList";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import PaginationFooter from "@/components/base/PaginationFooter";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import { ROLE_LIST, roleCan, type Capability } from "@/config/permissions";
import { IntegrationDot } from "@/components/feature/DemoBanner";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { computeOwnerPerformance } from "@/utils/attribution";
import { relativeTime } from "@/utils/format";
import { buildIntegrationStatuses, integrationSummaryText } from "@/utils/integrations";

const MATRIX: { label: string; cap: Capability }[] = [
  { label: "Team reporting", cap: "reports.team" },
  { label: "Delete leads", cap: "leads.delete" },
  { label: "Applications approvals", cap: "applications.approve" },
  { label: "Event reports", cap: "events.reports" },
  { label: "Admin console", cap: "admin.view" },
  { label: "Manage users", cap: "admin.manageUsers" },
  { label: "Workspace settings", cap: "settings.manageWorkspace" },
  { label: "Audit trail", cap: "audit.view" },
];

const PER_PAGE = 50;

export default function AdminPage() {
  const navigate = useNavigate();
  const { state, backendLoadedAt, integrationOverview } = useWorkspace();
  const { can } = usePermissions();
  const integrations = buildIntegrationStatuses(state, backendLoadedAt, integrationOverview);
  const [workloadPage, setWorkloadPage] = useState(1);
  const [alertsPage, setAlertsPage] = useState(1);
  const [salesPage, setSalesPage] = useState(1);
  const [enrolmentPage, setEnrolmentPage] = useState(1);
  const [usersPage, setUsersPage] = useState(1);

  const allowed = can("admin.view");

  const now = Date.now();
  const openTasks = state.tasks.filter((t) => t.status === "open");
  const overdueTasks = openTasks.filter((t) => new Date(t.dueAt).getTime() < now);
  const pendingApps = state.applications.filter(
    (a) => a.status === "Submitted" || a.status === "Under review",
  );
  const unanswered = state.threads.filter((t) => !t.trashed && t.responseState === "unanswered");

  const workload = useMemo(
    () =>
      state.users.map((u) => ({
        user: u,
        openTasks: state.tasks.filter((t) => t.ownerId === u.id && t.status === "open").length,
        overdue: state.tasks.filter(
          (t) => t.ownerId === u.id && t.status === "open" && new Date(t.dueAt).getTime() < now,
        ).length,
        leads: state.leads.filter((l) => l.ownerId === u.id).length,
        openLeads: state.leads.filter(
          (l) => l.ownerId === u.id && l.stage !== "Won" && l.stage !== "Lost",
        ).length,
        unanswered: state.threads.filter(
          (t) => t.ownerId === u.id && !t.trashed && t.responseState === "unanswered",
        ).length,
      })),
    [state.users, state.tasks, state.leads, state.threads, now],
  );

  const salesPerformance = useMemo(
    () =>
      computeOwnerPerformance(state.leads, state.users, (ownerId) =>
        state.tasks.filter((t) => t.ownerId === ownerId && t.status === "open").length,
      ),
    [state.leads, state.users, state.tasks],
  );

  const enrolmentPerformance = useMemo(
    () =>
      state.users
        .map((u) => {
          const apps = state.applications.filter((a) => a.ownerId === u.id);
          const enrolled = apps.filter((a) => a.status === "Enrolled").length;
          const offers = apps.filter((a) => a.status === "Offer").length;
          return { user: u, apps: apps.length, offers, enrolled };
        })
        .filter((row) => row.apps > 0),
    [state.users, state.applications],
  );

  const leadOwnership = useMemo(
    () =>
      state.users
        .map((u) => ({
          label: u.name,
          value: state.leads.filter((l) => l.ownerId === u.id).length,
        }))
        .filter((r) => r.value > 0),
    [state.users, state.leads],
  );

  const stageCounts = useMemo(() => {
    const map = new Map<string, number>();
    state.leads.forEach((l) => map.set(l.stage, (map.get(l.stage) ?? 0) + 1));
    return Array.from(map.entries()).map(([label, value]) => ({ label, value }));
  }, [state.leads]);

  const alerts = state.notifications.filter((n) => n.tone === "danger" || n.tone === "secondary");
  const workloadPageCount = Math.max(1, Math.ceil(workload.length / PER_PAGE));
  const workloadCurrentPage = Math.min(workloadPage, workloadPageCount);
  const pagedWorkload = workload.slice((workloadCurrentPage - 1) * PER_PAGE, workloadCurrentPage * PER_PAGE);
  const alertsPageCount = Math.max(1, Math.ceil(alerts.length / PER_PAGE));
  const alertsCurrentPage = Math.min(alertsPage, alertsPageCount);
  const pagedAlerts = alerts.slice((alertsCurrentPage - 1) * PER_PAGE, alertsCurrentPage * PER_PAGE);
  const salesPageCount = Math.max(1, Math.ceil(salesPerformance.length / PER_PAGE));
  const salesCurrentPage = Math.min(salesPage, salesPageCount);
  const pagedSalesPerformance = salesPerformance.slice((salesCurrentPage - 1) * PER_PAGE, salesCurrentPage * PER_PAGE);
  const enrolmentPageCount = Math.max(1, Math.ceil(enrolmentPerformance.length / PER_PAGE));
  const enrolmentCurrentPage = Math.min(enrolmentPage, enrolmentPageCount);
  const pagedEnrolmentPerformance = enrolmentPerformance.slice(
    (enrolmentCurrentPage - 1) * PER_PAGE,
    enrolmentCurrentPage * PER_PAGE,
  );
  const usersPageCount = Math.max(1, Math.ceil(state.users.length / PER_PAGE));
  const usersCurrentPage = Math.min(usersPage, usersPageCount);
  const pagedUsers = state.users.slice((usersCurrentPage - 1) * PER_PAGE, usersCurrentPage * PER_PAGE);

  if (!allowed) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Administrator access required"
            message="The Admin console is limited to the Admin role. Managers retain team reporting and assignment from the Today dashboard."
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
        <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">Administration</p>
        <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">
          Admin Dashboard
        </h1>
        <p className="mt-1 text-[13px] text-foreground-500">
          Workspace-wide oversight of users, team performance, workloads, workflows and integration
          health. Figures reflect the active workspace dataset.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <MetricCard label="Workspace users" value={state.users.length} icon="ri-group-line" tone="primary" />
        <MetricCard label="Open tasks" value={openTasks.length} icon="ri-checkbox-multiple-line" tone="secondary" />
        <MetricCard label="Overdue tasks" value={overdueTasks.length} icon="ri-error-warning-line" tone="danger" />
        <MetricCard label="Applications pending" value={pendingApps.length} icon="ri-file-list-3-line" tone="accent" />
        <MetricCard label="Unanswered emails" value={unanswered.length} icon="ri-mail-send-line" tone="danger" />
        <MetricCard label="Active alerts" value={alerts.length} icon="ri-alarm-warning-line" tone="danger" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            icon="ri-team-line"
            title="Team &amp; workload distribution"
            subtitle="Open and overdue work, lead ownership and inbox backlog per user"
          />
          <PaginationFooter
            position="top"
            currentPage={workloadCurrentPage}
            pageCount={workloadPageCount}
            total={workload.length}
            itemLabel="users"
            onPageChange={setWorkloadPage}
          />
          <TableWrap>
            <Table>
              <THead>
                <Th>User</Th>
                <Th>Role</Th>
                <Th className="text-right">Open tasks</Th>
                <Th className="text-right">Overdue</Th>
                <Th className="text-right">Leads owned</Th>
                <Th className="text-right">Unanswered</Th>
              </THead>
              <TBody>
                {pagedWorkload.map((row) => (
                  <Tr key={row.user.id}>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        <Avatar name={row.user.name} size="sm" />
                        <span className="font-semibold text-foreground-900">{row.user.name}</span>
                      </div>
                    </Td>
                    <Td className="text-foreground-500">{row.user.role}</Td>
                    <Td className="text-right font-semibold">{row.openTasks}</Td>
                    <Td className="text-right">
                      {row.overdue > 0 ? (
                        <span className="font-semibold text-red-600">{row.overdue}</span>
                      ) : (
                        <span className="text-foreground-400">0</span>
                      )}
                    </Td>
                    <Td className="text-right">{row.leads}</Td>
                    <Td className="text-right">{row.unanswered}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <PaginationFooter
            currentPage={workloadCurrentPage}
            pageCount={workloadPageCount}
            total={workload.length}
            itemLabel="users"
            onPageChange={setWorkloadPage}
          />
        </Card>

        <Card>
          <CardHeader icon="ri-alarm-warning-line" iconTone="accent" title="System alerts" />
          <PaginationFooter
            position="top"
            currentPage={alertsCurrentPage}
            pageCount={alertsPageCount}
            total={alerts.length}
            itemLabel="alerts"
            onPageChange={setAlertsPage}
          />
          <CardBody className="space-y-2.5">
            {alerts.length === 0 ? (
              <p className="text-[13px] text-foreground-400">No active alerts.</p>
            ) : (
              pagedAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className="rounded-lg border border-background-200 bg-background-50 p-3"
                >
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base ${
                        alert.tone === "danger" ? "bg-red-100 text-red-600" : "bg-accent-100 text-accent-900"
                      }`}
                    >
                      <i className="ri-error-warning-line"></i>
                    </span>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-foreground-900">{alert.title}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">
                        {alert.message}
                      </p>
                      <p className="mt-1 text-[10px] text-foreground-400">
                        {alert.module} · {relativeTime(alert.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </CardBody>
          <PaginationFooter
            currentPage={alertsCurrentPage}
            pageCount={alertsPageCount}
            total={alerts.length}
            itemLabel="alerts"
            onPageChange={setAlertsPage}
          />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader icon="ri-user-star-line" title="Sales performance" />
          <PaginationFooter
            position="top"
            currentPage={salesCurrentPage}
            pageCount={salesPageCount}
            total={salesPerformance.length}
            itemLabel="owners"
            onPageChange={setSalesPage}
          />
          <TableWrap>
            <Table className="min-w-[480px]">
              <THead>
                <Th>Owner</Th>
                <Th className="text-right">Leads</Th>
                <Th className="text-right">Won</Th>
                <Th className="text-right">Conv.</Th>
              </THead>
              <TBody>
                {pagedSalesPerformance.map((row) => (
                  <Tr key={row.ownerId}>
                    <Td className="font-semibold text-foreground-900">{row.name}</Td>
                    <Td className="text-right">{row.leads}</Td>
                    <Td className="text-right text-green-700">{row.won}</Td>
                    <Td className="text-right font-semibold">{row.conversionRate.toFixed(0)}%</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <PaginationFooter
            currentPage={salesCurrentPage}
            pageCount={salesPageCount}
            total={salesPerformance.length}
            itemLabel="owners"
            onPageChange={setSalesPage}
          />
        </Card>

        <Card>
          <CardHeader icon="ri-graduation-cap-line" iconTone="secondary" title="Enrolment performance" />
          <PaginationFooter
            position="top"
            currentPage={enrolmentCurrentPage}
            pageCount={enrolmentPageCount}
            total={enrolmentPerformance.length}
            itemLabel="officers"
            onPageChange={setEnrolmentPage}
          />
          <TableWrap>
            <Table className="min-w-[420px]">
              <THead>
                <Th>Officer</Th>
                <Th className="text-right">Applications</Th>
                <Th className="text-right">Offers</Th>
                <Th className="text-right">Enrolled</Th>
              </THead>
              <TBody>
                {pagedEnrolmentPerformance.map((row) => (
                  <Tr key={row.user.id}>
                    <Td className="font-semibold text-foreground-900">{row.user.name}</Td>
                    <Td className="text-right">{row.apps}</Td>
                    <Td className="text-right">{row.offers}</Td>
                    <Td className="text-right text-green-700">{row.enrolled}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <PaginationFooter
            currentPage={enrolmentCurrentPage}
            pageCount={enrolmentPageCount}
            total={enrolmentPerformance.length}
            itemLabel="officers"
            onPageChange={setEnrolmentPage}
          />
        </Card>

        <Card>
          <CardHeader icon="ri-pie-chart-line" title="Lead ownership" subtitle="Active distribution" />
          <CardBody>
            <BarList items={leadOwnership} tone="primary" />
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card>
          <CardHeader icon="ri-flow-chart" iconTone="accent" title="Workflow monitoring" subtitle="Leads by stage" />
          <CardBody>
            <BarList items={stageCounts} tone="accent" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon="ri-plug-line" title="Integration health" subtitle={integrationSummaryText(integrations)} />
          <CardBody className="space-y-2">
            {integrations.map((integration) => (
              <div
                key={integration.key}
                className="flex items-start gap-2.5 rounded-md border border-background-200 bg-background-50 px-3 py-2"
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-base text-foreground-500">
                  <i className={integration.icon}></i>
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold text-foreground-900">
                      {integration.label}
                    </span>
                    <IntegrationDot status={integration.status} />
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-foreground-500">
                    {integration.detail}
                  </p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader icon="ri-user-settings-line" title="Users &amp; roles" />
          <PaginationFooter
            position="top"
            currentPage={usersCurrentPage}
            pageCount={usersPageCount}
            total={state.users.length}
            itemLabel="users"
            onPageChange={setUsersPage}
          />
          <CardBody className="space-y-2.5">
            {pagedUsers.map((u) => {
              const mappedRole = ROLE_LIST.find((r) => r.userId === u.id);
              return (
                <div key={u.id} className="flex items-center gap-3">
                  <Avatar name={u.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-foreground-900">{u.name}</p>
                    <p className="truncate text-[11px] text-foreground-500">{u.role}</p>
                  </div>
                  {mappedRole ? (
                    <Badge tone={mappedRole.tone}>{mappedRole.name}</Badge>
                  ) : (
                    <Badge tone="neutral">No role</Badge>
                  )}
                </div>
              );
            })}
            <PaginationFooter
              currentPage={usersCurrentPage}
              pageCount={usersPageCount}
              total={state.users.length}
              itemLabel="users"
              onPageChange={setUsersPage}
            />
            <Button
              variant="outline"
              size="sm"
              fullWidth
              leftIcon={<i className="ri-settings-4-line"></i>}
              onClick={() => navigate("/settings")}
            >
              Manage in Settings
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader
          icon="ri-shield-check-line"
          iconTone="secondary"
          title="Permission matrix"
          subtitle="Simulated, frontend-only capabilities by role"
        />
        <TableWrap>
          <Table className="min-w-[720px]">
            <THead>
              <Th>Capability</Th>
              {ROLE_LIST.map((r) => (
                <Th key={r.id} className="text-center">
                  {r.name}
                </Th>
              ))}
            </THead>
            <TBody>
              {MATRIX.map((row) => (
                <Tr key={row.cap}>
                  <Td className="text-foreground-700">{row.label}</Td>
                  {ROLE_LIST.map((r) => (
                    <Td key={r.id} className="text-center">
                      {roleCan(r.id, row.cap) ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center text-base text-green-600">
                          <i className="ri-check-line"></i>
                        </span>
                      ) : (
                        <span className="inline-flex h-5 w-5 items-center justify-center text-base text-foreground-300">
                          <i className="ri-subtract-line"></i>
                        </span>
                      )}
                    </Td>
                  ))}
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}
