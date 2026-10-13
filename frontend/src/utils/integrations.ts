import { INTEGRATIONS } from "@/config/navigation";
import type { BackendIntegrationOverview, BackendIntegrationSummary } from "@/store/backendSync";
import type { BadgeTone } from "@/components/base/Badge";
import type { IntegrationStatus, WorkspaceState } from "@/store/types";

export interface RuntimeIntegrationStatus extends IntegrationStatus {
  badge: string;
  tone: BadgeTone;
  sourceLabel: string;
  recordCount: number;
  lastSyncAt?: string | null;
  reconnectUrl?: string | null;
  needsReconnect?: boolean;
}

function providerId(key: string): string {
  if (key === "zoho") return "zoho";
  if (key === "gmail") return "gmail";
  if (key === "zoom") return "zoom";
  if (key === "eventbrite") return "eventbrite";
  return key;
}

function defaultReconnectUrl(key: string): string | null {
  if (key === "gmail") return "/api/integrations/gmail/connect";
  if (key === "zoho") return "/api/integrations/zoho/connect";
  if (key === "eventbrite") return "/api/integrations/eventbrite/connect";
  return null;
}

export function withIntegrationReauthorization(url: string): string {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}reauthorize=1`;
}

function findSummary(
  overview: BackendIntegrationOverview | null | undefined,
  key: string,
): BackendIntegrationSummary | undefined {
  const id = providerId(key);
  const matches = overview?.integrations?.filter((item) => item.id === id || item.id?.startsWith(`${id}:`)) || [];
  if (matches.length <= 1) return matches[0];
  const latest = (field: "last_success_at" | "last_attempt_at") =>
    matches
      .map((item) => item[field])
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
  const errors = matches
    .map((item) => item.last_error_summary)
    .filter((value): value is string => Boolean(value));
  return {
    id,
    name: matches[0].name.replace(/\s+\d+$/, ""),
    configured: matches.some((item) => item.configured),
    connected: matches.some((item) => item.connected),
    health: matches.some((item) => item.health === "error")
      ? "error"
      : matches.some((item) => item.health === "warning")
        ? "warning"
        : matches.some((item) => item.health === "healthy")
          ? "healthy"
          : matches[0].health,
    sync_status: matches.find((item) => item.sync_status && item.sync_status !== "idle")?.sync_status || "idle",
    last_success_at: latest("last_success_at"),
    last_attempt_at: latest("last_attempt_at"),
    last_error_summary: errors.join(" - ") || null,
    records_processed: matches.reduce((sum, item) => sum + Number(item.records_processed || 0), 0),
    records_stored: matches.reduce((sum, item) => sum + Number(item.records_stored || 0), 0),
    current_sync_processed: matches.reduce((sum, item) => sum + Number(item.current_sync_processed || 0), 0),
    current_sync_inserted: matches.reduce((sum, item) => sum + Number(item.current_sync_inserted || 0), 0),
    current_sync_updated: matches.reduce((sum, item) => sum + Number(item.current_sync_updated || 0), 0),
    current_sync_unchanged: matches.reduce((sum, item) => sum + Number(item.current_sync_unchanged || 0), 0),
    needs_reconnect: matches.some((item) => item.needs_reconnect),
    reconnect_url: matches.find((item) => item.reconnect_url)?.reconnect_url || null,
    detail: `${matches.length} accounts tracked`,
  };
}

function countZohoRecords(state: WorkspaceState): number {
  const leadIds = state.leads.filter((lead) => {
    const text = [lead.source, lead.platform, lead.zohoId].join(" ").toLowerCase();
    return lead.zohoSynced || Boolean(lead.zohoId) || text.includes("zoho");
  }).length;
  const taskIds = state.tasks.filter((task) => task.source === "Zoho CRM").length;
  const touchpointIds = state.touchpoints.filter((touchpoint) =>
    [touchpoint.source, touchpoint.channel].join(" ").toLowerCase().includes("zoho"),
  ).length;
  return leadIds + taskIds + touchpointIds;
}

function localRecordCount(state: WorkspaceState, key: string): number {
  if (key === "gmail") return state.threads.filter((thread) => !thread.trashed).length;
  if (key === "zoom") return state.meetings.length + state.calls.length;
  if (key === "zoho") return countZohoRecords(state);
  if (key === "eventbrite") {
    const events = state.events.filter((event) => event.source === "Eventbrite");
    const registrations = events.reduce((sum, event) => sum + event.registrations.length, 0);
    const campaigns = state.campaigns.filter((campaign) =>
      campaign.platform.toLowerCase().includes("eventbrite"),
    ).length;
    return events.length + registrations + campaigns;
  }
  return 0;
}

function localDetail(state: WorkspaceState, key: string, count: number): string {
  if (key === "gmail") return `${count} inbox thread${count === 1 ? "" : "s"} loaded from workspace data`;
  if (key === "zoom") {
    const meetings = state.meetings.length;
    const calls = state.calls.length;
    return `${meetings} meeting${meetings === 1 ? "" : "s"} and ${calls} call${calls === 1 ? "" : "s"} loaded`;
  }
  if (key === "zoho") return `${count} CRM-linked record${count === 1 ? "" : "s"} loaded`;
  if (key === "eventbrite") {
    const events = state.events.filter((event) => event.source === "Eventbrite").length;
    return `${events} Eventbrite event${events === 1 ? "" : "s"} and attendee records loaded`;
  }
  return "Workspace records loaded";
}

function summaryDetail(summary: BackendIntegrationSummary): string {
  const stored = Number(summary.records_stored || 0);
  const currentProcessed = Number(summary.current_sync_processed ?? summary.records_processed ?? 0);
  const inserted = Number(summary.current_sync_inserted || 0);
  const updated = Number(summary.current_sync_updated || 0);
  const unchanged = Number(summary.current_sync_unchanged || 0);
  const bits = [
    summary.needs_reconnect
      ? "Reconnect required"
      : summary.connected
        ? "Connected"
        : summary.configured
          ? "Configured"
          : "",
    summary.sync_status && summary.sync_status !== "idle" ? `sync ${summary.sync_status}` : "",
    stored > 0 ? `${stored.toLocaleString()} unique records stored` : "",
    currentProcessed > 0 ? `${currentProcessed.toLocaleString()} processed in current sync` : "",
    inserted || updated || unchanged ? `${inserted.toLocaleString()} inserted, ${updated.toLocaleString()} updated, ${unchanged.toLocaleString()} unchanged` : "",
  ].filter(Boolean);
  if (typeof summary.detail === "string" && summary.detail.trim()) bits.push(summary.detail.trim());
  if (summary.last_error_summary) bits.push(summary.last_error_summary);
  return bits.join(" - ");
}

export function buildIntegrationStatuses(
  state: WorkspaceState,
  backendLoadedAt: string | null,
  overview: BackendIntegrationOverview | null | undefined,
): RuntimeIntegrationStatus[] {
  return INTEGRATIONS.map((staticBase) => {
    const base =
      state.integrationStatuses?.find((item) => item.key === staticBase.key) || staticBase;
    const summary = findSummary(overview, base.key);
    const localCount = localRecordCount(state, base.key);
    const stored = Number(summary?.records_stored ?? summary?.records_processed ?? 0);
    const recordCount = Math.max(localCount, stored);
    const hasPulledData = Boolean(backendLoadedAt && recordCount > 0);
    const hasBackendSignal = Boolean(summary);
    const needsAttention = Boolean(
      summary?.needs_reconnect ||
        summary?.last_error_summary ||
        summary?.health === "error" ||
        summary?.sync_status === "failed",
    );
    const connected = Boolean(summary?.connected || hasPulledData || base.status === "connected");
    const configured = Boolean(summary?.configured);
    const status: IntegrationStatus["status"] = needsAttention
      ? "attention"
      : connected
        ? "connected"
        : configured || base.status === "attention"
        ? "attention"
        : "disconnected";
    const badge = needsAttention
      ? summary?.needs_reconnect
        ? "Reconnect required"
        : "Needs attention"
      : connected
        ? "Connected"
        : configured
          ? "Ready to connect"
          : hasBackendSignal
            ? "No pulled data"
            : "No backend data";
    const detail = connected
      ? summaryDetail(summary || ({} as BackendIntegrationSummary)) || localDetail(state, base.key, recordCount)
      : hasBackendSignal
        ? summaryDetail(summary) || "No synced records returned by the backend yet"
        : backendLoadedAt
          ? recordCount > 0
            ? localDetail(state, base.key, recordCount)
            : base.detail
          : base.detail;
    return {
      ...base,
      status,
      detail,
      badge,
      tone: status === "connected" ? "success" : status === "attention" ? "warning" : "neutral",
      sourceLabel: hasBackendSignal || backendLoadedAt ? "Backend data" : "Local data",
      recordCount,
      lastSyncAt: summary?.last_success_at || summary?.last_attempt_at || null,
      reconnectUrl: summary?.reconnect_url || defaultReconnectUrl(base.key),
      needsReconnect: Boolean(summary?.needs_reconnect),
    };
  });
}

export function integrationSummaryText(integrations: RuntimeIntegrationStatus[]): string {
  const connected = integrations.filter((integration) => integration.status === "connected").length;
  const attention = integrations.filter((integration) => integration.status === "attention").length;
  if (connected === integrations.length) return "All tracked integrations are backed by loaded workspace data.";
  if (connected > 0) return `${connected} connected from loaded data${attention ? `, ${attention} need attention` : ""}.`;
  if (attention > 0) return `${attention} integrations are configured or need attention.`;
  return "No backend integration records were loaded.";
}
