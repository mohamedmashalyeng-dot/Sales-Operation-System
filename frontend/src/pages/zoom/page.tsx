import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Checkbox from "@/components/base/Checkbox";
import Drawer from "@/components/base/Drawer";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import Modal from "@/components/base/Modal";
import PaginationFooter from "@/components/base/PaginationFooter";
import SearchInput from "@/components/base/SearchInput";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import CallTable from "@/pages/zoom/components/CallTable";
import MeetingTable from "@/pages/zoom/components/MeetingTable";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Call, Meeting } from "@/store/types";
import { CALL_STATUS_TONES, formatDuration, fromInputDateTime } from "@/utils/crm";
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

export default function ZoomPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    state,
    userName,
    completeTask,
    scheduleCallbackTask,
    currentUserId,
    backendLoadedAt,
    integrationOverview,
    refreshBackendWorkspace,
  } = useWorkspace();
  const { can, canSeeOwner } = usePermissions();

  const [view, setView] = useState<ZoomView>("overview");
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState("upcoming");
  const [direction, setDirection] = useState("all");
  const [callStatus, setCallStatus] = useState("all");
  const [matchFilter, setMatchFilter] = useState("all");
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [call, setCall] = useState<Call | null>(null);
  const [callbackTarget, setCallbackTarget] = useState<Call | null>(null);
  const [callbackAt, setCallbackAt] = useState("");
  const [meetingsPage, setMeetingsPage] = useState(1);
  const [callsPage, setCallsPage] = useState(1);
  const [numbersPage, setNumbersPage] = useState(1);
  const [followupsPage, setFollowupsPage] = useState(1);

  const leadLabel = (leadId?: string) => {
    if (!leadId) return undefined;
    const lead = state.leads.find((l) => l.id === leadId);
    if (!lead) return undefined;
    return { name: `${lead.name}`, known: true };
  };

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

  const calls = useMemo(() => {
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

  const todayMeetings = state.meetings.filter(
    (m) => new Date(m.startAt).toDateString() === new Date().toDateString(),
  );
  const upcomingMeetings = state.meetings.filter(
    (m) => new Date(m.startAt).getTime() >= Date.now(),
  );
  const missedCalls = state.calls.filter((c) => c.status === "no-answer" || c.status === "voicemail");
  const zoomTasks = state.tasks.filter(
    (t) => t.status === "open" && canSeeOwner(t.ownerId) && (t.source === "Zoom" || t.source === "Events"),
  );
  const meetingsPageCount = Math.max(1, Math.ceil(meetings.length / PER_PAGE));
  const meetingsCurrentPage = Math.min(meetingsPage, meetingsPageCount);
  const pagedMeetings = meetings.slice((meetingsCurrentPage - 1) * PER_PAGE, meetingsCurrentPage * PER_PAGE);
  const callsPageCount = Math.max(1, Math.ceil(calls.length / PER_PAGE));
  const callsCurrentPage = Math.min(callsPage, callsPageCount);
  const pagedCalls = calls.slice((callsCurrentPage - 1) * PER_PAGE, callsCurrentPage * PER_PAGE);
  const numbersPageCount = Math.max(1, Math.ceil(numbers.length / PER_PAGE));
  const numbersCurrentPage = Math.min(numbersPage, numbersPageCount);
  const pagedNumbers = numbers.slice((numbersCurrentPage - 1) * PER_PAGE, numbersCurrentPage * PER_PAGE);
  const followupsPageCount = Math.max(1, Math.ceil(zoomTasks.length / PER_PAGE));
  const followupsCurrentPage = Math.min(followupsPage, followupsPageCount);
  const pagedZoomTasks = zoomTasks.slice((followupsCurrentPage - 1) * PER_PAGE, followupsCurrentPage * PER_PAGE);
  const zoomStatus = buildIntegrationStatuses(state, backendLoadedAt, integrationOverview).find(
    (integration) => integration.key === "zoom",
  );
  const loadedZoomRecords = state.meetings.length + state.calls.length;
  const zoomSubtitle = backendLoadedAt
    ? loadedZoomRecords > 0
      ? `${state.meetings.length} meetings and ${state.calls.length} calls loaded from the backend`
      : "Zoom backend loaded, but no meeting or call records were returned"
    : "Zoom workspace is using local demonstration records";
  const zoomBadgeTone =
    zoomStatus?.status === "connected" ? "success" : zoomStatus?.status === "attention" ? "warning" : "neutral";

  const reloadZoom = async () => {
    setRefreshing(true);
    try {
      const ok = await refreshBackendWorkspace();
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

  const openCallback = (target: Call) => {
    setCallbackTarget(target);
    setCallbackAt(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  };

  const saveCallback = () => {
    if (!callbackTarget || !callbackAt) return;
    scheduleCallbackTask({
      title: `Call back ${callbackTarget.caller}`,
      description: `Callback requested from the Zoom call log (${callbackTarget.phoneNumber}).`,
      ownerId: currentUserId,
      priority: "Medium",
      dueAt: fromInputDateTime(callbackAt),
      source: "Zoom",
      relatedLeadId: callbackTarget.leadId,
    });
    toast({
      title: "Callback scheduled",
      message: "A Zoom follow-up task was added to the Planner.",
      tone: "success",
    });
    setCallbackTarget(null);
  };

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
            <Button
              variant="outline"
              size="sm"
              leftIcon={<i className={refreshing ? "ri-loader-4-line" : "ri-refresh-line"}></i>}
              onClick={reloadZoom}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </Button>
          ) : null}
        </div>
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

      {view === "overview" ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Upcoming meetings" value={upcomingMeetings.length} icon="ri-vidicon-line" tone="primary" />
            <MetricCard label="Meetings today" value={todayMeetings.length} icon="ri-calendar-check-line" tone="accent" />
            <MetricCard label="Calls logged" value={state.calls.length} icon="ri-phone-line" tone="secondary" />
            <MetricCard label="Missed calls" value={missedCalls.length} icon="ri-phone-fill" tone="danger" />
          </div>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader icon="ri-vidicon-line" title="Next meetings" subtitle="Upcoming Zoom meetings" />
              {upcomingMeetings.length === 0 ? (
                <EmptyState icon="ri-vidicon-line" title="No upcoming meetings" />
              ) : (
                <MeetingTable
                  meetings={upcomingMeetings.slice(0, 4)}
                  onOpen={setMeeting}
                  hostName={userName}
                  eventName={(id) => state.events.find((e) => e.id === id)?.name}
                />
              )}
            </Card>
            <Card>
              <CardHeader icon="ri-phone-line" iconTone="accent" title="Recent calls" subtitle="Latest inbound and outbound calls" />
              <CallTable
                calls={state.calls.slice(0, 5)}
                onOpen={setCall}
                onCallback={openCallback}
                leadLabel={leadLabel}
              />
            </Card>
          </div>
        </div>
      ) : null}

      {view === "meetings" ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-background-200 bg-background-50 p-3 md:p-4">
            <div className="flex flex-wrap items-end gap-2.5">
              <Select
                label="Show"
                size="sm"
                className="w-full sm:w-[10rem]"
                value={scope}
                onChange={(value) => {
                  setScope(value);
                  setMeetingsPage(1);
                }}
                options={[
                  { value: "upcoming", label: "Upcoming" },
                  { value: "past", label: "Past" },
                  { value: "all", label: "All meetings" },
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
                  placeholder="Search meetings…"
                />
              </div>
            </div>
          </div>
          <Card>
            <CardHeader icon="ri-calendar-line" title="Meetings" subtitle={`${meetings.length} meetings`} />
            <PaginationFooter
              position="top"
              currentPage={meetingsCurrentPage}
              pageCount={meetingsPageCount}
              total={meetings.length}
              itemLabel="meetings"
              onPageChange={setMeetingsPage}
            />
            {meetings.length === 0 ? (
              <EmptyState icon="ri-vidicon-line" title="No meetings match" />
            ) : (
              <MeetingTable
                meetings={pagedMeetings}
                onOpen={setMeeting}
                hostName={userName}
                eventName={(id) => state.events.find((e) => e.id === id)?.name}
              />
            )}
            <PaginationFooter
              currentPage={meetingsCurrentPage}
              pageCount={meetingsPageCount}
              total={meetings.length}
              itemLabel="meetings"
              onPageChange={setMeetingsPage}
            />
          </Card>
        </div>
      ) : null}

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
            <CardHeader icon="ri-phone-line" iconTone="accent" title="Call log" subtitle={`${calls.length} calls`} />
            <PaginationFooter
              position="top"
              currentPage={callsCurrentPage}
              pageCount={callsPageCount}
              total={calls.length}
              itemLabel="calls"
              onPageChange={setCallsPage}
            />
            {calls.length === 0 ? (
              <EmptyState icon="ri-phone-line" title="No calls match" />
            ) : (
              <CallTable calls={pagedCalls} onOpen={setCall} onCallback={openCallback} leadLabel={leadLabel} />
            )}
            <PaginationFooter
              currentPage={callsCurrentPage}
              pageCount={callsPageCount}
              total={calls.length}
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
            subtitle="Tasks created from calls and meetings appear here and in the Planner"
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
              message="Schedule a callback from a call to create one."
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

      <Drawer
        open={Boolean(meeting)}
        onClose={() => setMeeting(null)}
        title={meeting?.topic ?? "Meeting"}
        subtitle={meeting ? `Zoom ID ${meeting.id}` : ""}
      >
        {meeting ? (
          <div className="space-y-4">
            <DetailRow label="Host" value={userName(meeting.hostId)} />
            <DetailRow label="Account" value={meeting.account} />
            <DetailRow label="Start" value={formatDateTime(meeting.startAt)} />
            <DetailRow label="Duration" value={`${meeting.durationMins} minutes`} />
            <DetailRow label="Participants" value={String(meeting.participants)} />
            <DetailRow label="Status" value={meeting.status} />
            {meeting.relatedEventId ? (
              <DetailRow
                label="Related event"
                value={state.events.find((e) => e.id === meeting.relatedEventId)?.name ?? "—"}
              />
            ) : null}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">
                Join link
              </p>
              <p className="mt-0.5 break-all text-[12.5px] text-foreground-600">
                {meeting.joinUrl ?? "No join link available."}
              </p>
              {meeting.joinUrl ? (
                <Badge tone="warning" className="mt-2">
                  Demonstration link only
                </Badge>
              ) : null}
            </div>
          </div>
        ) : null}
      </Drawer>

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
                Schedule callback
              </Button>
            ) : null}
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={Boolean(callbackTarget)}
        onClose={() => setCallbackTarget(null)}
        size="sm"
        title="Schedule a callback"
        description={callbackTarget ? `${callbackTarget.caller} · ${callbackTarget.phoneNumber}` : ""}
        footer={
          <>
            <Button variant="outline" onClick={() => setCallbackTarget(null)}>
              Cancel
            </Button>
            <Button leftIcon={<i className="ri-calendar-check-line"></i>} onClick={saveCallback}>
              Schedule callback
            </Button>
          </>
        }
      >
        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
          Callback date &amp; time
        </label>
        <input
          type="datetime-local"
          value={callbackAt}
          onChange={(e) => setCallbackAt(e.target.value)}
          className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
        />
        <p className="mt-2 text-[11px] text-foreground-500">
          Creates a Zoom follow-up task in the Planner. No real call is scheduled.
        </p>
      </Modal>
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
