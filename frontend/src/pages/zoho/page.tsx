import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Avatar from "@/components/base/Avatar";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Checkbox from "@/components/base/Checkbox";
import Drawer from "@/components/base/Drawer";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import PaginationFooter from "@/components/base/PaginationFooter";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from "@/components/base/Table";
import { useToast } from "@/components/base/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Lead } from "@/store/types";
import { STAGE_TONES } from "@/utils/crm";
import { formatDateTime, relativeTime } from "@/utils/format";
import { ownerOptions } from "@/utils/filterOptions";
import { buildIntegrationStatuses } from "@/utils/integrations";

type ZohoView = "records" | "health" | "mapping" | "followups";

const VIEWS: { key: ZohoView; label: string; icon: string }[] = [
  { key: "records", label: "Records", icon: "ri-database-2-line" },
  { key: "health", label: "Sync health", icon: "ri-heart-pulse-line" },
  { key: "mapping", label: "Field mapping", icon: "ri-arrow-left-right-line" },
  { key: "followups", label: "Follow-ups", icon: "ri-checkbox-multiple-line" },
];

const PER_PAGE = 50;

const FIELD_MAP = [
  { zoho: "Last_Name", workspace: "Lead name", notes: "Required" },
  { zoho: "Email", workspace: "Email", notes: "Validated" },
  { zoho: "Phone", workspace: "Phone", notes: "" },
  { zoho: "Lead_Status", workspace: "Stage", notes: "Mapped to workspace lifecycle" },
  { zoho: "Lead_Source", workspace: "Source", notes: "" },
  { zoho: "Owner", workspace: "Assigned owner", notes: "User reference" },
  { zoho: "Programme__c", workspace: "Programme", notes: "Custom field" },
  { zoho: "Intake__c", workspace: "Intake", notes: "Custom field" },
  { zoho: "Description", workspace: "Next action", notes: "" },
];

export default function ZohoPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, userName, completeTask, logIntegrationEvent, backendLoadedAt, integrationOverview } = useWorkspace();
  const { canSeeOwner, can } = usePermissions();

  const [view, setView] = useState<ZohoView>("records");
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [synced, setSynced] = useState("all");
  const [selected, setSelected] = useState<Lead | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [recordsPage, setRecordsPage] = useState(1);
  const [tasksPage, setTasksPage] = useState(1);
  const [zohoStoredTotal, setZohoStoredTotal] = useState<number | null>(null);
  const [zohoStoredError, setZohoStoredError] = useState("");

  const visibleLeads = state.leads.filter((l) => canSeeOwner(l.ownerId));
  const owners = useMemo(() => ownerOptions(state), [state]);
  const zohoStatus = useMemo(
    () => buildIntegrationStatuses(state, backendLoadedAt, integrationOverview).find((item) => item.key === "zoho"),
    [state, backendLoadedAt, integrationOverview],
  );
  const zohoSummary = useMemo(
    () => integrationOverview?.integrations?.find((item) => item.id === "zoho") || null,
    [integrationOverview],
  );
  const zohoConnected = zohoStatus?.status === "connected";
  const zohoNeedsReconnect = Boolean(zohoStatus?.needsReconnect);
  const reconnectZoho = () => {
    window.location.href = `${zohoStatus?.reconnectUrl || "/api/integrations/zoho/connect"}?reauthorize=1`;
  };

  const records = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visibleLeads.filter((lead) => {
      if (owner !== "all" && lead.ownerId !== owner) return false;
      if (synced === "synced" && !lead.zohoSynced) return false;
      if (synced === "pending" && lead.zohoSynced) return false;
      if (q && !`${lead.name} ${lead.email} ${lead.programme}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [visibleLeads, owner, synced, search]);

  const syncActivity = state.activity.filter((a) => a.module === "Integrations").slice(0, 8);
  const failed = state.notifications.filter((n) => n.module === "Integrations" && n.tone === "danger");
  const zohoTasks = state.tasks.filter(
    (t) => t.status === "open" && canSeeOwner(t.ownerId) && t.source === "Zoho CRM",
  );
  const recordsPageCount = Math.max(1, Math.ceil(records.length / PER_PAGE));
  const recordsCurrentPage = Math.min(recordsPage, recordsPageCount);
  const pagedRecords = records.slice((recordsCurrentPage - 1) * PER_PAGE, recordsCurrentPage * PER_PAGE);
  const tasksPageCount = Math.max(1, Math.ceil(zohoTasks.length / PER_PAGE));
  const tasksCurrentPage = Math.min(tasksPage, tasksPageCount);
  const pagedZohoTasks = zohoTasks.slice((tasksCurrentPage - 1) * PER_PAGE, tasksCurrentPage * PER_PAGE);

  useEffect(() => {
    if (!can("zoho.view")) return;
    let cancelled = false;
    fetch("/api/integrations/zoho/records/page?limit=1&offset=0", {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || payload?.message || "Zoho record count unavailable.");
        if (!cancelled) {
          setZohoStoredTotal(Number(payload?.total ?? 0));
          setZohoStoredError("");
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setZohoStoredTotal(null);
          setZohoStoredError(error instanceof Error ? error.message : "Zoho record count unavailable.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [backendLoadedAt, can]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      const response = await fetch("/api/integrations/zoho/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ mode: "manual" }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || payload?.message || "Zoho sync could not be queued.");
      logIntegrationEvent("queued Zoho sync for", payload?.job_id || "CRM records", "primary");
      toast({
        title: payload?.status === "running" ? "Zoho sync running" : "Zoho sync queued",
        message: payload?.job_id ? `Job ${payload.job_id} is ${payload.status || "queued"}.` : "The backend accepted the Zoho sync request.",
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Zoho sync not queued",
        message: error instanceof Error ? error.message : "Check the Zoho connection in Settings.",
        tone: "error",
      });
    } finally {
      setRetrying(false);
    }
  };

  if (!can("zoho.view")) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Zoho CRM not available for your role"
            message="Switch demo role to access the CRM integration workspace."
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
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">Integrations</p>
            <Badge tone={zohoStatus?.tone ?? "neutral"} dot>
              {zohoStatus?.badge ?? "Not connected"}
            </Badge>
          </div>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">Zoho CRM</h1>
          <p className="mt-1 text-[13px] text-foreground-500">
            {zohoStatus?.detail ?? "CRM records are loaded from the current workspace."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={zohoConnected ? "success" : "warning"} icon={zohoConnected ? "ri-checkbox-circle-line" : "ri-error-warning-line"}>
            {zohoNeedsReconnect ? "Reconnect required" : zohoConnected ? "Live sync available" : "Connect Zoho to sync"}
          </Badge>
          {zohoStatus?.reconnectUrl || zohoNeedsReconnect ? (
            <Button variant={zohoNeedsReconnect ? "primary" : "outline"} leftIcon={<i className="ri-link-m"></i>} onClick={reconnectZoho}>
              {zohoNeedsReconnect ? "Reconnect Zoho" : "Connect Zoho"}
            </Button>
          ) : null}
          {can("zoho.retry") ? (
            <Button variant="outline" leftIcon={<i className="ri-refresh-line"></i>} onClick={retry} loading={retrying} disabled={retrying}>
              {retrying ? "Queueing sync..." : "Retry failed sync"}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Synced contacts" value={visibleLeads.filter((l) => l.zohoSynced).length} icon="ri-checkbox-circle-line" tone="success" />
        <MetricCard label="Awaiting sync" value={visibleLeads.filter((l) => !l.zohoSynced).length} icon="ri-time-line" tone="accent" />
        <MetricCard label="Stored Zoho records" value={zohoStoredTotal ?? "--"} icon="ri-database-2-line" tone="primary" />
        <MetricCard label="Mapped fields" value={FIELD_MAP.length} icon="ri-arrow-left-right-line" tone="secondary" />
        <MetricCard label="Sync issues" value={failed.length} icon="ri-error-warning-line" tone={failed.length ? "danger" : "primary"} />
      </div>

      <div className="kbc-no-scrollbar overflow-x-auto pb-1">
        <div className="inline-flex items-center gap-1 rounded-full bg-background-200 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setView(v.key)}
              className={`flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                view === v.key
                  ? "bg-background-50 text-foreground-900 shadow-kbc-sm"
                  : "text-foreground-500 hover:text-foreground-800"
              }`}
            >
              <i className={v.icon}></i>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === "records" ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-background-200 bg-background-50 p-3 md:p-4">
            <div className="flex flex-wrap items-end gap-2.5">
              <Select
                label="Owner"
                size="sm"
                className="w-full sm:w-[12rem]"
                value={owner}
                onChange={(value) => {
                  setOwner(value);
                  setRecordsPage(1);
                }}
                options={owners}
              />
              <Select
                label="Sync state"
                size="sm"
                className="w-full sm:w-[11rem]"
                value={synced}
                onChange={(value) => {
                  setSynced(value);
                  setRecordsPage(1);
                }}
                options={[
                  { value: "all", label: "All records" },
                  { value: "synced", label: "Synced" },
                  { value: "pending", label: "Awaiting sync" },
                ]}
              />
              <div className="flex-1 basis-full lg:basis-auto lg:min-w-[14rem]">
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                  Search
                </label>
                <SearchInput
                  value={search}
                  onChange={(value) => {
                    setSearch(value);
                    setRecordsPage(1);
                  }}
                  placeholder="Search name, email, programme…"
                />
              </div>
            </div>
          </div>

          <Card>
            <CardHeader
              icon="ri-database-2-line"
              title="Synced leads & contacts"
              subtitle={`${records.length} workspace lead records - shared with the Leads module`}
            />
            {zohoStoredTotal !== null && zohoStoredTotal !== records.length ? (
              <div className="border-b border-background-200 bg-primary-50/50 px-5 py-2.5">
                <p className="text-[12px] text-primary-900">
                  Zoho has {zohoStoredTotal} stored records. This table shows the {records.length} records
                  mapped into workspace Leads.
                </p>
              </div>
            ) : zohoStoredError ? (
              <div className="border-b border-background-200 bg-amber-50 px-5 py-2.5">
                <p className="text-[12px] text-amber-800">{zohoStoredError}</p>
              </div>
            ) : null}
            {records.length === 0 ? (
              <EmptyState icon="ri-database-2-line" title="No records match" />
            ) : (
              <>
                <PaginationFooter
                  position="top"
                  currentPage={recordsCurrentPage}
                  pageCount={recordsPageCount}
                  total={records.length}
                  itemLabel="workspace records"
                  onPageChange={setRecordsPage}
                />
                <TableWrap>
                  <Table className="min-w-[820px]">
                    <THead>
                    <Th>Record</Th>
                    <Th>Programme</Th>
                    <Th>Stage</Th>
                    <Th>Owner</Th>
                    <Th>Zoho ID</Th>
                    <Th>Sync state</Th>
                  </THead>
                  <TBody>
                    {pagedRecords.map((lead) => (
                      <Tr key={lead.id} onClick={() => setSelected(lead)}>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={lead.name} size="sm" />
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-semibold text-foreground-900">
                                {lead.name}
                              </p>
                              <p className="truncate text-[11px] text-foreground-400">{lead.email}</p>
                            </div>
                          </div>
                        </Td>
                        <Td>{lead.programme}</Td>
                        <Td>
                          <Badge tone={STAGE_TONES[lead.stage]}>{lead.stage}</Badge>
                        </Td>
                        <Td>{userName(lead.ownerId)}</Td>
                        <Td>
                          <span className="text-[12px] text-foreground-500">
                            {lead.zohoId ?? "—"}
                          </span>
                        </Td>
                        <Td>
                          {lead.zohoSynced ? (
                            <Badge tone="success" icon="ri-check-line">
                              Synced
                            </Badge>
                          ) : (
                            <Badge tone="warning">Awaiting</Badge>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
                </TableWrap>
              </>
            )}
            <PaginationFooter
              currentPage={recordsCurrentPage}
              pageCount={recordsPageCount}
              total={records.length}
              itemLabel="workspace records"
              onPageChange={setRecordsPage}
            />
          </Card>
        </div>
      ) : null}

      {view === "health" ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Card>
            <CardHeader icon="ri-heart-pulse-line" iconTone="accent" title="Sync health" subtitle="Simulated integration diagnostics" />
            <CardBody className="space-y-3">
              <HealthRow
                label="Connection"
                value={zohoNeedsReconnect ? "Reconnect required" : zohoConnected ? "Connected" : "Not connected"}
                tone={zohoNeedsReconnect ? "warning" : zohoConnected ? "success" : "danger"}
              />
              <HealthRow
                label="Last sync attempt"
                value={zohoStatus?.lastSyncAt ? relativeTime(zohoStatus.lastSyncAt) : "Not recorded"}
                tone={zohoStatus?.lastSyncAt ? "neutral" : "warning"}
              />
              <HealthRow label="Unique stored records" value={(zohoStoredTotal ?? zohoStatus?.recordCount ?? 0).toLocaleString()} tone="neutral" />
              <HealthRow label="Current sync processed" value={Number(zohoSummary?.current_sync_processed || 0).toLocaleString()} tone="neutral" />
              <HealthRow label="Sync issues" value={failed.length ? String(failed.length) : "0"} tone={failed.length ? "danger" : "success"} />
              <HealthRow label="Sync direction" value="Two-way (simulated)" tone="neutral" />
              {zohoNeedsReconnect ? (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-800">
                  <p className="flex items-center gap-1.5">
                    <i className="ri-error-warning-line"></i>
                    Zoho authorization expired. Reconnect with consent; the app will queue a sync automatically.
                  </p>
                  <Button className="mt-2" size="sm" leftIcon={<i className="ri-link-m"></i>} onClick={reconnectZoho}>
                    Reconnect Zoho
                  </Button>
                </div>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader icon="ri-file-list-line" title="Sync history" subtitle="Simulated activity log" />
            <CardBody>
              {syncActivity.length === 0 ? (
                <p className="text-[13px] text-foreground-500">No sync activity recorded.</p>
              ) : (
                <ul className="space-y-3">
                  {syncActivity.map((entry) => (
                    <li key={entry.id} className="flex items-start gap-2.5">
                      <span
                        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base ${
                          entry.tone === "danger"
                            ? "bg-red-100 text-red-600"
                            : "bg-background-100 text-foreground-600"
                        }`}
                      >
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
            </CardBody>
          </Card>
        </div>
      ) : null}

      {view === "mapping" ? (
        <Card>
          <CardHeader
            icon="ri-arrow-left-right-line"
            iconTone="secondary"
            title="Field mapping preview"
            subtitle="How Zoho CRM fields map to workspace records"
          />
          <TableWrap>
            <Table className="min-w-[640px]">
              <THead>
                <Th>Zoho CRM field</Th>
                <Th>Workspace field</Th>
                <Th>Notes</Th>
              </THead>
              <TBody>
                {FIELD_MAP.map((row) => (
                  <Tr key={row.zoho}>
                    <Td>
                      <code className="rounded bg-background-100 px-1.5 py-0.5 text-[12px] text-foreground-700">
                        {row.zoho}
                      </code>
                    </Td>
                    <Td className="font-medium text-foreground-800">{row.workspace}</Td>
                    <Td>
                      <span className="text-[12px] text-foreground-500">{row.notes || "—"}</span>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      ) : null}

      {view === "followups" ? (
        <Card>
          <CardHeader
            icon="ri-checkbox-multiple-line"
            title="Zoho follow-up tasks"
            subtitle="CRM-sourced tasks also appear in the Planner"
          />
          {zohoTasks.length === 0 ? (
            <EmptyState icon="ri-checkbox-circle-line" title="No Zoho follow-ups" />
          ) : (
            <>
              <PaginationFooter
                position="top"
                currentPage={tasksCurrentPage}
                pageCount={tasksPageCount}
                total={zohoTasks.length}
                itemLabel="tasks"
                onPageChange={setTasksPage}
              />
              <CardBody className="space-y-2.5">
                {pagedZohoTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start gap-3 rounded-lg border border-background-200 bg-background-50 p-3"
                  >
                  <div className="pt-0.5">
                    <Checkbox
                      checked={false}
                      onChange={() => {
                        completeTask(task.id);
                        toast({ title: "Task completed", message: task.title, tone: "success" });
                      }}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-foreground-900">{task.title}</p>
                    <p className="mt-0.5 text-[11px] text-foreground-500">
                      due {formatDateTime(task.dueAt)} · {userName(task.ownerId)}
                    </p>
                  </div>
                  <Badge tone={new Date(task.dueAt).getTime() < Date.now() ? "danger" : "neutral"}>
                    {task.priority}
                  </Badge>
                  </div>
                ))}
              </CardBody>
            </>
          )}
          <PaginationFooter
            currentPage={tasksCurrentPage}
            pageCount={tasksPageCount}
            total={zohoTasks.length}
            itemLabel="tasks"
            onPageChange={setTasksPage}
          />
        </Card>
      ) : null}

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected?.name ?? "Record"}
        subtitle={selected ? `${selected.id} · Zoho record` : ""}
      >
        {selected ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge tone={STAGE_TONES[selected.stage]}>{selected.stage}</Badge>
              {selected.zohoSynced ? (
                <Badge tone="success" icon="ri-check-line">
                  Synced
                </Badge>
              ) : (
                <Badge tone="warning">Awaiting sync</Badge>
              )}
            </div>
            <DetailRow label="Contact" value={selected.contactName} />
            <DetailRow label="Email" value={selected.email} />
            <DetailRow label="Phone" value={selected.phone} />
            <DetailRow label="Programme" value={selected.programme} />
            <DetailRow label="Intake" value={selected.intake} />
            <DetailRow label="Source" value={selected.source} />
            <DetailRow label="Owner" value={userName(selected.ownerId)} />
            <DetailRow label="Zoho record ID" value={selected.zohoId ?? "Not assigned"} />
            <Button
              variant="outline"
              size="sm"
              leftIcon={<i className="ri-contacts-book-2-line"></i>}
              onClick={() => navigate(`/leads/${selected.id}`)}
            >
              Open in Leads
            </Button>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}

function HealthRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "success" | "danger" | "warning" | "neutral";
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-background-200 pb-2.5">
      <span className="text-[12px] font-semibold uppercase tracking-wide text-foreground-400">
        {label}
      </span>
      <Badge tone={tone === "neutral" ? "neutral" : tone}>{value}</Badge>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-background-200 pb-2">
      <span className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</span>
      <span className="text-right text-[13px] font-medium text-foreground-800">{value}</span>
    </div>
  );
}
