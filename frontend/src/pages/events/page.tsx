import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import PaginationFooter from "@/components/base/PaginationFooter";
import { useToast } from "@/components/base/Toast";
import EventsList from "@/pages/events/components/EventsList";
import EventTable from "@/pages/events/components/EventTable";
import ImportModal from "@/pages/events/components/ImportModal";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { CollegeEvent, RegOutcome } from "@/store/types";
import { formatDateTime } from "@/utils/format";

type EventsView = "dashboard" | "events" | "people" | "callbacks" | "reports" | "marketing";

const VIEWS: { key: EventsView; label: string; icon: string }[] = [
  { key: "dashboard", label: "Dashboard", icon: "ri-dashboard-line" },
  { key: "events", label: "Events", icon: "ri-calendar-event-line" },
  { key: "people", label: "People", icon: "ri-group-line" },
  { key: "callbacks", label: "Call backs", icon: "ri-phone-line" },
  { key: "reports", label: "Reports", icon: "ri-bar-chart-box-line" },
  { key: "marketing", label: "Marketing", icon: "ri-megaphone-line" },
];

const PER_PAGE = 50;
const EVENT_CARD_PER_PAGE = 10;

function rate(part: number, whole: number): string {
  if (whole === 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export default function EventsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, setRegistrationOutcome } = useWorkspace();
  const { can } = usePermissions();

  const [searchParams, setSearchParams] = useSearchParams();
  const requestedView = searchParams.get("view");
  const view: EventsView = VIEWS.some(item => item.key === requestedView) ? requestedView as EventsView : "events";
  const [callbacksPage, setCallbacksPage] = useState(1);
  const [reportsPage, setReportsPage] = useState(1);
  const [importOpen, setImportOpen] = useState(false);
  const canManage = can("events.manage");
  const allRegs = state.events.flatMap((e) => e.registrations);
  const upcoming = state.events.filter((e) => new Date(e.startAt).getTime() >= Date.now());
  const confirmed = allRegs.filter((r) => ["confirmed", "attended"].includes(r.outcome)).length;
  const declined = allRegs.filter((r) => r.outcome === "declined").length;
  const pending = allRegs.filter((r) => r.outcome === "pending").length;
  const attended = allRegs.filter((r) => r.outcome === "attended").length;
  const noShow = allRegs.filter((r) => r.outcome === "no-show").length;
  const callbacksDue = state.events.flatMap((e) =>
    e.registrations.filter((r) => r.callbackAt && r.outcome === "pending").map((r) => ({ e, r })),
  );
  const callbacksPageCount = Math.max(1, Math.ceil(callbacksDue.length / PER_PAGE));
  const callbacksCurrentPage = Math.min(callbacksPage, callbacksPageCount);
  const pagedCallbacks = callbacksDue.slice((callbacksCurrentPage - 1) * PER_PAGE, callbacksCurrentPage * PER_PAGE);
  const reportsPageCount = Math.max(1, Math.ceil(state.events.length / EVENT_CARD_PER_PAGE));
  const reportsCurrentPage = Math.min(reportsPage, reportsPageCount);
  const pagedReportEvents = state.events.slice(
    (reportsCurrentPage - 1) * EVENT_CARD_PER_PAGE,
    reportsCurrentPage * EVENT_CARD_PER_PAGE,
  );

  if (!can("events.view")) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Events not available for your role"
            message="The Staff Sales role does not have access to the Events module. Switch demo role to continue."
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

  const handleOutcome = (eventId: string, regId: string, outcome: RegOutcome) => {
    if (!canManage) return;
    setRegistrationOutcome(eventId, regId, outcome);
    toast({ title: `Registration ${outcome}`, tone: "success" });
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-primary-600">
            Registration & attendance
          </p>
          <h1 className="mt-1 font-heading text-2xl font-extrabold text-foreground-950">Events</h1>
          <p className="mt-1 text-[13px] text-foreground-500">
            Browse synced events and open an event to view its registrations and attendance.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {can("zoom.view") ? <Button variant="outline" leftIcon={<i className="ri-vidicon-line" />} onClick={() => navigate("/zoom/meetings")}>
            Zoom meetings
          </Button> : null}
          {can("events.import") ? (
            <Button
              variant="outline"
              leftIcon={<i className="ri-upload-2-line"></i>}
              onClick={() => setImportOpen(true)}
            >
              Import &amp; sync
            </Button>
          ) : null}
          <Button
            variant="outline"
            leftIcon={<i className="ri-download-line"></i>}
            onClick={() =>
              toast({ title: "Export started (demonstration)", tone: "info" })
            }
          >
            Export
          </Button>
        </div>
      </div>

      <div className="kbc-no-scrollbar overflow-x-auto pb-1">
        <div className="inline-flex items-center gap-1 rounded-full bg-background-200 p-1">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => setSearchParams({ view: v.key })}
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

      {view !== "events" && view !== "people" ? <p className="text-xs text-foreground-500">These views show the events currently loaded in this session. Open Events to browse all records and their full details.</p> : null}

      {view === "dashboard" ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Upcoming events" value={upcoming.length} icon="ri-calendar-event-line" tone="primary" />
            <MetricCard label="Total registrations" value={allRegs.length} icon="ri-group-line" tone="secondary" />
            <MetricCard label="Confirmed" value={confirmed} icon="ri-checkbox-circle-line" tone="success" />
            <MetricCard label="Pending contact" value={pending} icon="ri-time-line" tone="accent" />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Declined" value={declined} icon="ri-close-circle-line" tone="danger" />
            <MetricCard label="Callbacks due" value={callbacksDue.length} icon="ri-phone-line" tone="accent" />
            <MetricCard label="Confirmation rate" value={rate(confirmed, allRegs.length)} icon="ri-percent-line" tone="primary" />
            <MetricCard label="Show-up rate" value={rate(attended, attended + noShow)} icon="ri-user-follow-line" tone="success" />
          </div>
          <Card>
            <CardHeader icon="ri-calendar-event-line" title="Upcoming events" subtitle="Next scheduled events" />
            <EventTable
              events={upcoming}
              emptyMessage="No upcoming events to show"
              onOpen={(id) => navigate(`/events/${id}`)}
            />
          </Card>
        </div>
      ) : null}

      {view === "events" ? <EventsList /> : null}

      {view === "people" ? <EventsList key="people" people /> : null}

      {view === "callbacks" ? (
        <Card>
          <CardHeader
            icon="ri-phone-line"
            iconTone="accent"
            title="Call backs"
            subtitle="Registrations awaiting confirmation with a scheduled callback"
          />
          <PaginationFooter
            position="top"
            currentPage={callbacksCurrentPage}
            pageCount={callbacksPageCount}
            total={callbacksDue.length}
            itemLabel="callbacks"
            onPageChange={setCallbacksPage}
          />
          {callbacksDue.length === 0 ? (
            <EmptyState
              icon="ri-phone-line"
              title="No callbacks scheduled"
              message="Schedule a callback from a registration to see it here."
            />
          ) : (
            <CardBody className="space-y-2.5">
              {pagedCallbacks.map(({ e, r }) => (
                <div
                  key={`${e.id}-${r.id}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-background-200 bg-background-50 p-3"
                >
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-foreground-900">{r.name}</p>
                    <p className="text-[11px] text-foreground-500">
                      {e.name} · due {formatDateTime(r.callbackAt as string)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge tone="warning">Pending</Badge>
                    {canManage ? (
                      <Button variant="outline" size="sm" onClick={() => handleOutcome(e.id, r.id, "confirmed")}>
                        Confirm
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardBody>
          )}
          <PaginationFooter
            currentPage={callbacksCurrentPage}
            pageCount={callbacksPageCount}
            total={callbacksDue.length}
            itemLabel="callbacks"
            onPageChange={setCallbacksPage}
          />
        </Card>
      ) : null}

      {view === "reports" ? (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <MetricCard label="Confirmation rate" value={rate(confirmed, allRegs.length)} icon="ri-percent-line" tone="primary" />
            <MetricCard label="Show-up rate" value={rate(attended, attended + noShow)} icon="ri-user-follow-line" tone="success" />
            <MetricCard label="Attended" value={attended} icon="ri-user-star-line" tone="accent" />
            <MetricCard label="No-shows" value={noShow} icon="ri-user-unfollow-line" tone="danger" />
          </div>
          <Card>
            <CardHeader icon="ri-bar-chart-box-line" title="Per-event breakdown" />
            <PaginationFooter
              position="top"
              currentPage={reportsCurrentPage}
              pageCount={reportsPageCount}
              total={state.events.length}
              itemLabel="events"
              onPageChange={setReportsPage}
            />
            <CardBody className="space-y-4">
              {state.events.length === 0 ? (
                <EmptyState
                  icon="ri-bar-chart-box-line"
                  title="No event reports yet"
                  message="Report breakdowns will appear once event records exist."
                />
              ) : (
                pagedReportEvents.map((event) => {
                const total = event.registrations.length;
                const confirmedCount = event.registrations.filter((r) =>
                  ["confirmed", "attended"].includes(r.outcome),
                ).length;
                return (
                  <div key={event.id}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] font-semibold text-foreground-900">{event.name}</span>
                      <span className="text-[12px] text-foreground-500">
                        {confirmedCount}/{total} confirmed · {rate(confirmedCount, total)}
                      </span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-background-200">
                      <div
                        className="h-full rounded-full bg-primary-500"
                        style={{ width: `${total === 0 ? 0 : (confirmedCount / total) * 100}%` }}
                      ></div>
                    </div>
                  </div>
                );
                })
              )}
            </CardBody>
            <PaginationFooter
              currentPage={reportsCurrentPage}
              pageCount={reportsPageCount}
              total={state.events.length}
              itemLabel="events"
              onPageChange={setReportsPage}
            />
          </Card>
        </div>
      ) : null}

      {view === "marketing" ? <MarketingView /> : null}

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />


    </div>
  );
}

function MarketingView() {
  const { state } = useWorkspace();
  const sourceTone = { Eventbrite: "accent", Zoom: "primary", Manual: "secondary" } as const;
  const bySource = (["Eventbrite", "Zoom", "Manual"] as const).map((s) => ({
    source: s,
    events: state.events.filter((e) => e.source === s).length,
    registrations: state.events
      .filter((e) => e.source === s)
      .reduce((n, e) => n + e.registrations.length, 0),
  }));
  const byProgramme = useMemo(() => {
    const map = new Map<string, number>();
    state.events.forEach((e) =>
      e.registrations.forEach((r) => map.set(r.programme, (map.get(r.programme) ?? 0) + 1)),
    );
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [state.events]);
  const maxProgramme = Math.max(1, ...byProgramme.map(([, n]) => n));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon="ri-megaphone-line"
          iconTone="accent"
          title="Registrations by source"
          subtitle="Where event interest is coming from"
        />
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {bySource.map((row) => (
            <div key={row.source} className="rounded-lg border border-background-200 bg-background-50 p-4">
              <Badge tone={sourceTone[row.source]}>{row.source}</Badge>
              <p className="mt-2.5 font-heading text-2xl font-bold leading-none text-foreground-900">
                {row.registrations}
              </p>
              <p className="mt-1 text-[12px] text-foreground-500">registrations across {row.events} events</p>
            </div>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader icon="ri-pie-chart-line" iconTone="secondary" title="Interest by programme" />
        <CardBody className="space-y-3">
          {byProgramme.length === 0 ? (
            <EmptyState
              icon="ri-pie-chart-line"
              title="No programme interest yet"
              message="Programme interest will appear once registrations exist."
            />
          ) : (
            byProgramme.map(([programme, count]) => (
              <div key={programme}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[13px] text-foreground-800">{programme}</span>
                  <span className="text-[12px] font-semibold text-foreground-600">{count}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-background-200">
                  <div
                    className="h-full rounded-full bg-accent-500"
                    style={{ width: `${(count / maxProgramme) * 100}%` }}
                  ></div>
                </div>
              </div>
            ))
          )}
        </CardBody>
      </Card>
    </div>
  );
}
