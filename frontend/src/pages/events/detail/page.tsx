import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import MetricCard from "@/components/base/MetricCard";
import Modal from "@/components/base/Modal";
import { useToast } from "@/components/base/Toast";
import ImportModal from "@/pages/events/components/ImportModal";
import EventAudienceTable from "@/pages/events/components/EventAudienceTable";
import TaskFormModal from "@/pages/planner/components/TaskFormModal";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace, type TaskInput } from "@/store/WorkspaceProvider";
import type { AttendanceOutcome, EventAudienceFilter } from "@/config/marketing";
import type { EventRegistration } from "@/store/types";
import { buildEventAudience, summariseAudience } from "@/utils/events";
import { formatDateTime } from "@/utils/format";
import { fromInputDateTime } from "@/utils/crm";

const SOURCE_TONES = { Eventbrite: "accent", Zoom: "primary", Manual: "secondary" } as const;

export default function EventDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, setRegistrationOutcome, setRegistrationAttendance, scheduleCallback, createTask } =
    useWorkspace();
  const { can } = usePermissions();

  const event = state.events.find((e) => e.id === id);
  const [importOpen, setImportOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [audienceFilter, setAudienceFilter] = useState<EventAudienceFilter>("all");
  const [callbackTarget, setCallbackTarget] = useState<EventRegistration | null>(null);
  const [callbackAt, setCallbackAt] = useState("");

  if (!can("events.view")) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Events not available for your role"
            message="Switch demo role to access this event."
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

  if (!event) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-calendar-close-line"
            title="Event not found"
            message="This event does not exist in the demonstration dataset."
            action={
              <Button variant="outline" onClick={() => navigate("/events")}>
                Back to events
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const canManage = can("events.manage");

  const pct = (n: number, d: number) => (d === 0 ? "0%" : `${Math.round((n / d) * 100)}%`);

  // Invitation, registration and attendance are kept as separate facts so the
  // audience never over- or under-states who actually engaged.
  const audience = buildEventAudience(event, state.campaigns, state.leads);
  const summary = summariseAudience(audience);
  const filteredAudience =
    audienceFilter === "all"
      ? audience
      : audience.filter((row) => {
          if (audienceFilter === "registered") return row.registrationStatus === "Registered";
          if (audienceFilter === "cancelled") return row.registrationStatus === "Cancelled Registration";
          if (audienceFilter === "attended") return row.attendance === "Attended";
          if (audienceFilter === "did-not-attend") return row.attendance === "Did Not Attend";
          if (audienceFilter === "attendance-unknown")
            return row.registrationStatus === "Registered" && row.attendance === "Attendance Unknown";
          if (audienceFilter === "invited-only")
            return row.invitationStatus !== "Not invited" && row.registrationStatus === "Not Registered";
          if (audienceFilter === "follow-up-required")
            return row.followUpRequired || row.attendance === "Did Not Attend";
          return true;
        });

  const saveCallback = () => {
    if (!callbackTarget || !callbackAt) return;
    scheduleCallback(event.id, callbackTarget.id, fromInputDateTime(callbackAt));
    toast({
      title: "Callback scheduled",
      message: "A follow-up task was created in the Planner.",
      tone: "success",
    });
    setCallbackTarget(null);
  };

  const handleTask = (input: TaskInput) => {
    createTask(input);
    toast({ title: "Follow-up task created", message: "Added to the Planner.", tone: "success" });
    setTaskOpen(false);
  };

  const handleAttendance = (registrationId: string, attendance: AttendanceOutcome) => {
    setRegistrationAttendance(event.id, registrationId, attendance);
    toast({ title: `Attendance recorded: ${attendance}`, tone: "success" });
  };

  const handleCancelRegistration = (registrationId: string) => {
    setRegistrationOutcome(event.id, registrationId, "declined");
    toast({ title: "Registration cancelled", tone: "info" });
  };

  const handleBulkAttendance = (registrationIds: string[], attendance: AttendanceOutcome) => {
    registrationIds.forEach((registrationId) =>
      setRegistrationAttendance(event.id, registrationId, attendance),
    );
    toast({ title: `${registrationIds.length} attendance outcome(s) recorded`, tone: "success" });
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-foreground-400">
        <Link to="/events" className="font-semibold text-foreground-600 hover:text-primary-600">
          Events
        </Link>
        <i className="ri-arrow-right-s-line"></i>
        <span>{event.id}</span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-extrabold text-foreground-950">{event.name}</h1>
            <Badge tone={SOURCE_TONES[event.source]}>{event.source}</Badge>
            <Badge tone={event.status === "upcoming" ? "primary" : "neutral"} dot>
              {event.status}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-foreground-500">
            {formatDateTime(event.startAt)} – {formatDateTime(event.endAt)} · {event.location}
          </p>
          <p className="mt-1 max-w-2xl text-[13px] text-foreground-500">{event.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" leftIcon={<i className="ri-arrow-left-line"></i>} onClick={() => navigate("/events")}>
            Back
          </Button>
          {can("events.import") ? (
            <Button variant="outline" leftIcon={<i className="ri-upload-2-line"></i>} onClick={() => setImportOpen(true)}>
              Import &amp; sync
            </Button>
          ) : null}
          {canManage ? (
            <Button leftIcon={<i className="ri-add-line"></i>} onClick={() => setTaskOpen(true)}>
              Follow-up task
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Invited" value={summary.invited} icon="ri-mail-send-line" tone="secondary" />
        <MetricCard label="Registered" value={summary.registered} icon="ri-user-add-line" tone="primary" />
        <MetricCard label="Cancelled" value={summary.cancelled} icon="ri-user-unfollow-line" tone="danger" />
        <MetricCard label="Attended" value={summary.attended} icon="ri-user-star-line" tone="success" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Did not attend" value={summary.didNotAttend} icon="ri-user-minus-line" tone="accent" />
        <MetricCard label="Attendance unknown" value={summary.attendanceUnknown} icon="ri-question-line" tone="secondary" />
        <MetricCard label="Not registered" value={summary.notRegistered} icon="ri-user-search-line" tone="secondary" />
        <MetricCard label="Registration rate" value={pct(summary.registered, summary.invited || summary.registered + summary.cancelled)} icon="ri-percent-line" tone="accent" />
      </div>

      {event.meetingLink ? (
        <Card>
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary-100 text-lg text-primary-700">
                <i className="ri-vidicon-line"></i>
              </span>
              <div>
                <p className="text-[13px] font-semibold text-foreground-900">Meeting link</p>
                <p className="text-[12px] text-foreground-500">{event.meetingLink}</p>
              </div>
            </div>
            <Badge tone="warning" icon="ri-error-warning-line">
              Demonstration link — not a real meeting
            </Badge>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          icon="ri-group-line"
          title="Registrations &amp; attendance"
          subtitle={`${summary.registered} registered · invitation, registration and attendance are tracked separately`}
        />
        {audience.length === 0 ? (
          <EmptyState
            icon="ri-user-search-line"
            title="No audience yet"
            message="Import a sheet or sync Eventbrite to populate this event."
          />
        ) : (
          <EventAudienceTable
            rows={filteredAudience}
            filter={audienceFilter}
            onFilterChange={setAudienceFilter}
            canManage={canManage}
            onAttendance={handleAttendance}
            onCancelRegistration={handleCancelRegistration}
            onBulkAttendance={handleBulkAttendance}
          />
        )}
      </Card>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />

      <Modal
        open={Boolean(callbackTarget)}
        onClose={() => setCallbackTarget(null)}
        size="sm"
        title="Schedule a callback"
        description={callbackTarget?.name}
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
          This creates a follow-up task in the Planner, not a real reminder.
        </p>
      </Modal>

      <TaskFormModal
        open={taskOpen}
        task={null}
        defaults={{ relatedEventId: event.id, source: "Events" }}
        onClose={() => setTaskOpen(false)}
        onSubmit={handleTask}
      />
    </div>
  );
}