import LoadingState from "@/components/base/LoadingState";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
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
import { useToast } from "@/components/base/Toast";
import CallTable from "@/pages/zoom/components/CallTable";
import MeetingTable from "@/pages/zoom/components/MeetingTable";
import MeetingDetails from "@/pages/zoom/components/MeetingDetails";
import ZoomMeetingsList from "@/pages/zoom/components/ZoomMeetingsList";
import useZoomOverview from "./useZoomOverview";
import { usePermissions } from "@/hooks/usePermissions";
import { mapBackendCall } from "@/store/backendSync";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Call, Meeting } from "@/store/types";
import { CALL_STATUS_TONES, formatDuration } from "@/utils/crm";
import { formatDateTime, relativeTime } from "@/utils/format";
import { buildIntegrationStatuses } from "@/utils/integrations";

type ZoomView = "overview" | "meetings" | "calls" | "numbers" | "followups";

const VIEWS: { key: ZoomView; label: string; icon: string }[] = [
  { key: "overview", label: "Overview", icon: "ri-dashboard-line" },
  { key: "meetings", label: "Meetings", icon: "ri-vidicon-line" },
  { key: "calls", label: "Calls", icon: "ri-phone-line" },
  { key: "numbers", label: "Phone numbers", icon: "ri-contacts-line" },
  { key: "followups", label: "Follow-ups", icon: "ri-checkbox-multiple-line" },
];

const PER_PAGE = 50;
const CALL_REQUEST_TIMEOUT_MS = 45000;

type BackendCallPage = {
  calls?: Record<string, any>[];
  items?: Record<string, any>[];
  total?: number | null;
  has_more?: boolean;
  next_offset?: number;
  error?: string;
  message?: string;
};

export default function ZoomPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: meetingId } = useParams();
  const [searchParams] = useSearchParams();
  const { toast } = useToast();
  const {
    state,
    userName,
    completeTask,
    refreshPlannerTasks,
    backendLoadedAt,
    integrationOverview,
    refreshBackendWorkspace,
  } = useWorkspace();
  const { can, canSeeOwner } = usePermissions();
  const overview = useZoomOverview(can("zoom.view"));

  const [view, setView] = useState<ZoomView>("overview");
  useEffect(() => {
    const selected = meetingId || location.pathname.endsWith('/meetings') ? 'meetings'
      : location.pathname.endsWith('/calls') ? 'calls' : searchParams.get('view') || 'overview';
    if (VIEWS.some(item => item.key === selected)) setView(selected as ZoomView);
  }, [location.pathname, meetingId, searchParams]);
  useEffect(() => {
    if (backendLoadedAt && view === 'followups') void refreshPlannerTasks().catch(error => toast({ title: 'Unable to load call follow-ups', message: error.message, tone: 'error' }));
  }, [backendLoadedAt, view, refreshPlannerTasks]);
  const [refreshing, setRefreshing] = useState(false);
  const [syncingCalls, setSyncingCalls] = useState(false);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("upcoming");
  const [direction, setDirection] = useState("all");
  const [callStatus, setCallStatus] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");
  const openMeeting = (meeting: Meeting) => navigate(`/zoom/meetings/${encodeURIComponent(meeting.id)}`);
  const [call, setCall] = useState<Call | null>(null);
  const [meetingsPage, setMeetingsPage] = useState(1);
  const [callsPage, setCallsPage] = useState(1);
  const [numbersPage, setNumbersPage] = useState(1);
  const [followupsPage, setFollowupsPage] = useState(1);
  const [backendCallPages, setBackendCallPages] = useState<Record<number, Call[]>>({});
  const [backendCallTotal, setBackendCallTotal] = useState<number | null>(null);
  const [backendCallHasMore, setBackendCallHasMore] = useState(false);
  const [backendCallLoading, setBackendCallLoading] = useState(false);
  const [backendCallError, setBackendCallError] = useState<string | null>(null);
  const loadedCallPageKeys = useRef(new Set<string>());
  const callRequestRef = useRef<{ key: string; controller: AbortController } | null>(null);

  const leadLabel = (leadId?: string) => {
    if (!leadId) return undefined;
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return undefined;
    return { name: `${lead.name}`, known: true };
  };

  const resetBackendCallPages = useCallback(() => {
    loadedCallPageKeys.current.clear();
    callRequestRef.current?.controller.abort();
    callRequestRef.current = null;
    setBackendCallPages({});
    setBackendCallTotal(null);
    setBackendCallHasMore(false);
    setBackendCallError(null);
  }, []);

  const loadCallPage = useCallback(
    async (pageNumber: number, force = false) => {
      if (!backendLoadedAt) return;
      const offset = (pageNumber - 1) * PER_PAGE;
      const key = JSON.stringify({ pageNumber, offset, direction, callStatus, matchFilter, search: search.trim() });
      if (!force && loadedCallPageKeys.current.has(key)) return;
      if (callRequestRef.current?.key === key) return;
      callRequestRef.current?.controller.abort();
      const controller = new AbortController();
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, CALL_REQUEST_TIMEOUT_MS);
      callRequestRef.current = { key, controller };
      setBackendCallLoading(true);
      setBackendCallError(null);
      try {
        const params = new URLSearchParams({
          limit: String(PER_PAGE),
          offset: String(offset),
        });
        if (direction !== "all") params.set("direction", direction);
        if (callStatus !== "all") params.set("status", callStatus);
        if (matchFilter !== "all") params.set("match", matchFilter);
        const query = search.trim();
        if (query) params.set("search", query);
        const response = await fetch(`/api/zoom/calls?${params.toString()}`, {
          method: "GET",
          credentials: "include",
          headers: { Accept: "application/json" },
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => ({}))) as BackendCallPage;
        if (!response.ok) throw new Error(payload.error || payload.message || "Could not load Zoom calls.");
        const rows = Array.isArray(payload.calls) ? payload.calls : Array.isArray(payload.items) ? payload.items : [];
        loadedCallPageKeys.current.add(key);
        setBackendCallPages((prev) => ({ ...prev, [pageNumber]: rows.map((item) => mapBackendCall(item, state.users)) }));
        setBackendCallHasMore(Boolean(payload.has_more));
        if (typeof payload.total === "number") setBackendCallTotal(payload.total);
      } catch (error) {
        if (!controller.signal.aborted) {
          setBackendCallError(error instanceof Error ? error.message : "Could not load Zoom calls.");
        } else if (timedOut && callRequestRef.current?.key === key) {
          setBackendCallError("Zoom calls are taking too long to respond. Try again in a moment.");
        }
      } finally {
        window.clearTimeout(timeout);
        if (callRequestRef.current?.key === key) callRequestRef.current = null;
        setBackendCallLoading(false);
      }
    },
    [backendLoadedAt, callStatus, direction, matchFilter, search, state.users],
  );

  useEffect(() => {
    resetBackendCallPages();
    setCallsPage(1);
  }, [backendLoadedAt, callStatus, direction, matchFilter, resetBackendCallPages, search]);

  useEffect(() => {
    if (!backendLoadedAt || view !== 'calls') return;
    const pageToLoad = view === "calls" ? callsPage : 1;
    void loadCallPage(pageToLoad);
    return () => {
      callRequestRef.current?.controller.abort();
      callRequestRef.current = null;
    };
  }, [backendLoadedAt, callsPage, loadCallPage, view]);

  const meetings = useMemo(() => {
    const q = search.trim().toLowerCase();
    const now = Date.now();
    return state.meetings
      .filter((m) => {
        const start = new Date(m.startAt).getTime();
        if (scope === "upcoming" && start < now) return false;
        if (scope === "past" && start >= now) return false;
        if (q && !`${m.topic} ${m.account}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) =>
        scope === "past"
          ? new Date(b.startAt).getTime() - new Date(a.startAt).getTime()
          : new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
      );
  }, [state.meetings, scope, search]);

  const filteredCalls = useMemo(() => {
    const q = search.trim().toLowerCase();
    return state.calls
      .filter((c) => {
        if (direction !== "all" && c.direction !== direction) return false;
        if (callStatus !== "all" && c.status !== callStatus) return false;
        if (matchFilter === "verified" && !(c.leadId && c.matchConfidence === "verified")) return false;
        if (matchFilter === "uncertain" && c.matchConfidence !== "uncertain") return false;
        if (matchFilter === "none" && c.leadId) return false;
        if (q && !`${c.caller} ${c.receiver} ${c.phoneNumber} ${c.notes}`.toLowerCase().includes(q))
          return false;
        return true;
      })
      .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  }, [state.calls, direction, callStatus, matchFilter, search]);

  const numbers = useMemo(() => {
    const map = new Map<
      string,
      { number: string; calls: number; incoming: number; outgoing: number; last: string; leadId?: string; matched: boolean }
    >();
    state.calls.forEach((c) => {
      const existing = map.get(c.phoneNumber);
      const entry =
        existing ??
        {
          number: c.phoneNumber,
          calls: 0,
          incoming: 0,
          outgoing: 0,
          last: c.occurredAt,
          leadId: c.leadId,
          matched: Boolean(c.leadId),
        };
      entry.calls += 1;
      if (c.direction === "incoming") entry.incoming += 1;
      else entry.outgoing += 1;
      if (new Date(c.occurredAt).getTime() > new Date(entry.last).getTime()) entry.last = c.occurredAt;
      if (c.leadId) {
        entry.leadId = c.leadId;
        entry.matched = true;
      }
      map.set(c.phoneNumber, entry);
    });
    return Array.from(map.values()).sort((a, b) => b.calls - a.calls);
  }, [state.calls]);

  const zoomTasks = state.tasks.filter(
    (t) => t.status === "open" && canSeeOwner(t.ownerId) && t.callVerified && t.relatedCallId,
  );
  const meetingsPageCount = Math.max(1, Math.ceil(meetings.length / PER_PAGE));
  const meetingsCurrentPage = Math.min(meetingsPage, meetingsPageCount);
  const pagedMeetings = meetings.slice((meetingsCurrentPage - 1) * PER_PAGE, meetingsCurrentPage * PER_PAGE);
  const backendCallFallbackTotal = backendCallHasMore
    ? callsPage * PER_PAGE + 1
    : (callsPage - 1) * PER_PAGE + (backendCallPages[callsPage]?.length ?? 0);
  const callTotal = backendLoadedAt ? backendCallTotal ?? backendCallFallbackTotal : filteredCalls.length;
  const callsPageCount = Math.max(1, Math.ceil(callTotal / PER_PAGE));
  const callsCurrentPage = Math.min(callsPage, callsPageCount);
  const pagedCalls = backendLoadedAt
    ? backendCallPages[callsCurrentPage] ?? []
    : filteredCalls.slice((callsCurrentPage - 1) * PER_PAGE, callsCurrentPage * PER_PAGE);
  const numbersPageCount = Math.max(1, Math.ceil(numbers.length / PER_PAGE));
  const numbersCurrentPage = Math.min(numbersPage, numbersPageCount);
  const pagedNumbers = numbers.slice((numbersCurrentPage - 1) * PER_PAGE, numbersCurrentPage * PER_PAGE);
  const followupsPageCount = Math.max(1, Math.ceil(zoomTasks.length / PER_PAGE));
  const followupsCurrentPage = Math.min(followupsPage, followupsPageCount);
  const pagedZoomTasks = zoomTasks.slice((followupsCurrentPage - 1) * PER_PAGE, followupsCurrentPage * PER_PAGE);
  const zoomStatus = buildIntegrationStatuses(state, backendLoadedAt, integrationOverview).find(
    (integration) => integration.key === "zoom",
  );
  const summary = !overview.loading && !overview.error ? overview.data : null;
  const zoomSubtitle = overview.loading ? "Loading Zoom totals..." : overview.error ? "Zoom totals could not be loaded"
    : `${summary?.metrics.total_meetings ?? 0} meetings and ${summary?.metrics.calls_logged ?? 0} calls recorded in the backend`;
  const zoomBadgeTone =
    zoomStatus?.status === "connected" ? "success" : zoomStatus?.status === "attention" ? "warning" : "neutral";

  const reloadZoom = async () => {
    setRefreshing(true);
    try {
      const ok = await refreshBackendWorkspace();
      resetBackendCallPages();
      setCallsPage(1);
      if (ok && view === "calls") await loadCallPage(1, true);
      toast({
        title: ok ? "Zoom data refreshed" : "Zoom data not refreshed",
        message: ok ? "Meetings and calls were reloaded from the backend." : "Sign in or check the backend connection.",
        tone: ok ? "success" : "info",
      });
    } catch (error) {
      toast({
        title: "Zoom refresh failed",
        message: error instanceof Error ? error.message : "The backend did not return Zoom data.",
        tone: "error",
      });
    } finally {
      setRefreshing(false);
    }
  };

  const syncZoomCalls = async () => {
    setSyncingCalls(true);
    try {
      const response = await fetch("/api/integrations/zoom/calls/sync", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || payload?.message || "Zoom calls sync failed.");
      await refreshBackendWorkspace();
      resetBackendCallPages();
      setCallsPage(1);
      if (view === "calls") await loadCallPage(1, true);
      toast({
        title: "Zoom calls synced",
        message: `${Number(payload.imported_calls || 0)} created, ${Number(payload.updated_calls || 0)} updated, ${Number(payload.scanned || 0)} scanned.`,
        tone: "success",
      });
    } catch (error) {
      toast({
        title: "Zoom calls sync failed",
        message: error instanceof Error ? error.message : "Could not pull Zoom Phone calls.",
        tone: "error",
      });
    } finally {
      setSyncingCalls(false);
    }
  };

  if (!can("zoom.view")) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Zoom not available for your role"
            message="Switch demo role to access the Zoom workspace."
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

  const openCallback = (target: Call) => { navigate(`/zoom/calls/${encodeURIComponent(target.id)}`); };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">
            Meetings &amp; calls
          </p>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">Zoom</h1>
          <p className="mt-1 text-[13px] text-foreground-500">
            {zoomSubtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            tone={zoomBadgeTone}
            icon={zoomStatus?.status === "connected" ? "ri-checkbox-circle-line" : "ri-error-warning-line"}
          >
            {zoomStatus?.badge ?? "Backend status unknown"}
          </Badge>
          {backendLoadedAt ? (
            <>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<i className={syncingCalls ? "ri-loader-4-line" : "ri-phone-line"}></i>}
                onClick={syncZoomCalls}
                loading={syncingCalls} disabled={syncingCalls || refreshing}
              >
                {syncingCalls ? "Syncing..." : "Sync calls"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                leftIcon={<i className={refreshing ? "ri-loader-4-line" : "ri-refresh-line"}></i>}
                onClick={reloadZoom}
                loading={refreshing} disabled={refreshing || syncingCalls}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="kbc-no-scrollbar overflow-x-auto pb-1">
        <div className="inline-flex items-center gap-1 rounded-full bg-background-200 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => navigate(v.key === 'meetings' ? '/zoom/meetings' : v.key === 'calls' ? '/zoom/calls' : `/zoom?view=${v.key}`)}
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

      {overview.error ? <div role="alert" className="rounded-md bg-red-50 p-4 text-sm text-red-700">Unable to load Zoom overview: {overview.error}
        <Button className="ml-3" size="sm" variant="outline" onClick={overview.retry}>Retry overview</Button></div> : null}

      {view === "overview" ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div data-testid="zoom-upcoming-count"><MetricCard label="Upcoming meetings" value={summary?.metrics.upcoming_meetings ?? "—"} icon="ri-vidicon-line" tone="primary" /></div>
            <div data-testid="zoom-today-count"><MetricCard label="Meetings today" value={summary?.metrics.meetings_today ?? "—"} icon="ri-calendar-check-line" tone="accent" /></div>
            <div data-testid="zoom-calls-count"><MetricCard label="Calls logged" value={summary?.metrics.calls_logged ?? "—"} icon="ri-phone-line" tone="secondary" /></div>
            <div data-testid="zoom-missed-count"><MetricCard label="Missed calls" value={summary?.metrics.missed_calls ?? "—"} icon="ri-phone-fill" tone="danger" /></div>
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader icon="ri-vidicon-line" title="Next meetings" subtitle="Upcoming Zoom meetings" />
              {overview.loading ? <LoadingState className="p-5 text-sm">Loading upcoming meetings...</LoadingState> : !summary ? <p className="p-5 text-sm">Upcoming meetings are unavailable.</p> : summary.nextMeetings.length === 0 ? (
                <EmptyState icon="ri-vidicon-line" title="No upcoming meetings" />
              ) : (
                <MeetingTable
                  meetings={summary.nextMeetings}
                  onOpen={openMeeting}
                  hostName={userName}
                  eventName={(id) => state.events.find((e) => e.id === id)?.name}
                />
              )}
            </Card>
            <Card>
              <CardHeader icon="ri-phone-line" iconTone="accent" title="Recent calls" subtitle="Latest inbound and outbound calls" />
              {overview.loading ? <LoadingState className="p-5 text-sm">Loading recent calls...</LoadingState> : !summary ? <p className="p-5 text-sm">Recent calls are unavailable.</p> : summary.recentCalls.length === 0 ? <EmptyState icon="ri-phone-line" title="No calls recorded" /> : <CallTable
                calls={summary.recentCalls}
                onOpen={setCall}
                onCallback={openCallback}
                leadLabel={leadLabel}
              />}
            </Card>
          </div>
        </div>
      ) : null}

      {view === "meetings" ? <ZoomMeetingsList onOpen={openMeeting} /> : null}

      {view === "calls" ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-background-200 bg-background-50 p-3 md:p-4">
            <div className="flex flex-wrap items-end gap-2.5">
              <Select
                label="Direction"
                size="sm"
                className="w-full sm:w-[10rem]"
                value={direction}
                onChange={(value) => {
                  setDirection(value);
                  setCallsPage(1);
                }}
                options={[
                  { value: "all", label: "All directions" },
                  { value: "incoming", label: "Incoming" },
                  { value: "outgoing", label: "Outgoing" },
                ]}
              />
              <Select
                label="Status"
                size="sm"
                className="w-full sm:w-[10rem]"
                value={callStatus}
                onChange={(value) => {
                  setCallStatus(value);
                  setCallsPage(1);
                }}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "answered", label: "Answered" },
                  { value: "connected", label: "Connected" },
                  { value: "no-answer", label: "No answer" },
                  { value: "voicemail", label: "Voicemail" },
                ]}
              />
              <Select
                label="CRM match"
                size="sm"
                className="w-full sm:w-[11rem]"
                value={matchFilter}
                onChange={(value) => {
                  setMatchFilter(value);
                  setCallsPage(1);
                }}
                options={[
                  { value: "all", label: "All calls" },
                  { value: "verified", label: "Verified match" },
                  { value: "uncertain", label: "Uncertain match" },
                  { value: "none", label: "No match" },
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
                    setMeetingsPage(1);
                    setCallsPage(1);
                  }}
                  placeholder="Search calls…"
                />
              </div>
            </div>
          </div>
          <Card>
            <CardHeader icon="ri-phone-line" iconTone="accent" title="Call log" subtitle={`${callTotal} calls`} />
            <PaginationFooter
              position="top"
              currentPage={callsCurrentPage}
              pageCount={callsPageCount}
              total={callTotal}
              itemLabel="calls"
              onPageChange={setCallsPage}
            />
            {backendCallError ? (
              <EmptyState icon="ri-error-warning-line" title="Calls could not load" message={backendCallError} />
            ) : pagedCalls.length === 0 ? (
              <EmptyState
                icon={backendCallLoading ? "ri-loader-4-line" : "ri-phone-line"}
                title={backendCallLoading ? "Loading calls" : "No calls match"}
                message={backendCallLoading ? "Pulling this call page from the backend." : undefined}
              />
            ) : (
              <CallTable calls={pagedCalls} onOpen={setCall} onCallback={openCallback} leadLabel={leadLabel} />
            )}
            <PaginationFooter
              currentPage={callsCurrentPage}
              pageCount={callsPageCount}
              total={callTotal}
              itemLabel="calls"
              onPageChange={setCallsPage}
            />
          </Card>
        </div>
      ) : null}

      {view === "numbers" ? (
        <Card>
          <CardHeader
            icon="ri-contacts-line"
            iconTone="secondary"
            title="Phone number directory"
            subtitle="Call frequency and CRM matching by number"
          />
          <PaginationFooter
            position="top"
            currentPage={numbersCurrentPage}
            pageCount={numbersPageCount}
            total={numbers.length}
            itemLabel="numbers"
            onPageChange={setNumbersPage}
          />
          <CardBody className="space-y-2.5">
            {pagedNumbers.map((n) => (
              <div
                key={n.number}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-background-200 bg-background-50 p-3"
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-background-100 text-base text-foreground-600">
                    <i className="ri-phone-line"></i>
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-foreground-900">{n.number}</p>
                    <p className="text-[11px] text-foreground-500">
                      {n.incoming} inbound · {n.outgoing} outbound · last {relativeTime(n.last)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone="secondary">{n.calls} calls</Badge>
                  {n.matched ? (
                    <Badge tone="success" icon="ri-link">
                      {leadLabel(n.leadId)?.name ?? "CRM lead"}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Not matched</Badge>
                  )}
                </div>
              </div>
            ))}
          </CardBody>
          <PaginationFooter
            currentPage={numbersCurrentPage}
            pageCount={numbersPageCount}
            total={numbers.length}
            itemLabel="numbers"
            onPageChange={setNumbersPage}
          />
        </Card>
      ) : null}

      {view === "followups" ? (
        <Card>
          <CardHeader
            icon="ri-checkbox-multiple-line"
            title="Zoom follow-ups"
            subtitle="Approved follow-up tasks from Zoom call results"
          />
          <PaginationFooter
            position="top"
            currentPage={followupsCurrentPage}
            pageCount={followupsPageCount}
            total={zoomTasks.length}
            itemLabel="follow-ups"
            onPageChange={setFollowupsPage}
          />
          {zoomTasks.length === 0 ? (
            <EmptyState
              icon="ri-checkbox-circle-line"
              title="No follow-ups"
              message="Review a final call result and approve its suggested follow-up tasks."
            />
          ) : (
            <CardBody className="space-y-2.5">
              {pagedZoomTasks.map((task) => (
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
                      {task.source} · due {formatDateTime(task.dueAt)} · {userName(task.ownerId)}
                    </p>
                  </div>
                  <Badge tone={task.dueAt && new Date(task.dueAt).getTime() < Date.now() ? "danger" : "neutral"}>
                    {task.priority}
                  </Badge>
                </div>
              ))}
            </CardBody>
          )}
          <PaginationFooter
            currentPage={followupsCurrentPage}
            pageCount={followupsPageCount}
            total={zoomTasks.length}
            itemLabel="follow-ups"
            onPageChange={setFollowupsPage}
          />
        </Card>
      ) : null}

      {meetingId ? <MeetingDetails key={meetingId} id={meetingId} onClose={() => navigate('/zoom?view=meetings', { replace: true })} /> : null}

      <Drawer
        open={Boolean(call)}
        onClose={() => setCall(null)}
        title={call ? `${call.direction === "incoming" ? call.caller : call.receiver}` : "Call"}
        subtitle={call ? `${call.phoneNumber}` : ""}
      >
        {call ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge tone={CALL_STATUS_TONES[call.status]}>{call.status}</Badge>
              <Badge tone={call.direction === "incoming" ? "success" : "primary"}>{call.direction}</Badge>
            </div>
            <DetailRow label="Caller" value={call.caller} />
            <DetailRow label="Receiver" value={call.receiver} />
            <DetailRow label="Duration" value={formatDuration(call.durationSec)} />
            <DetailRow label="When" value={formatDateTime(call.occurredAt)} />
            <DetailRow
              label="CRM match"
              value={call.leadId ? `${leadLabel(call.leadId)?.name ?? "Lead"} (${call.matchConfidence})` : "No match"}
            />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Notes</p>
              <p className="mt-0.5 text-[12.5px] text-foreground-600">{call.notes || "—"}</p>
            </div>
            {call.leadId ? (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<i className="ri-contacts-book-2-line"></i>}
                onClick={() => navigate(`/leads/${call.leadId}`)}
              >
                Open linked lead
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<i className="ri-mic-line"></i>}
              onClick={() => navigate(`/zoom/calls/${call.id}`)}
            >
              Open full call review
            </Button>
            {can("zoom.callback") ? (
              <Button
                size="sm"
                fullWidth
                leftIcon={<i className="ri-phone-line"></i>}
                onClick={() => {
                  setCall(null);
                  openCallback(call);
                }}
              >
                Review call actions
              </Button>
            ) : null}
          </div>
        ) : null}
      </Drawer>


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
