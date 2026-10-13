import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import EmptyState from "@/components/base/EmptyState";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import {
  CALL_OUTCOMES,
  CALL_OUTCOME_ICONS,
  CALL_OUTCOME_TONES,
  mediaLabel,
  type CallOutcome,
} from "@/config/marketing";
import { ELIGIBILITY_TONES } from "@/config/eligibility";
import CallReview from "@/pages/zoom/calls/detail/components/CallReview";
import TaskFormModal from "@/pages/planner/components/TaskFormModal";
import { usePermissions } from "@/hooks/usePermissions";
import { useWorkspace, type TaskInput } from "@/store/WorkspaceProvider";
import { formatDateTime } from "@/utils/format";
import { CALL_STATUS_TONES, formatDuration } from "@/utils/crm";

export default function ZoomCallDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, userName, recordCallOutcome, createTask, attachCallFollowUp, addTouchpoint, updateTouchpoint, currentUserId } = useWorkspace();
  const { can, canSeeOwner } = usePermissions();

  const call = state.calls.find((c) => c.id === id);
  const lead = call?.leadId ? state.leads.find((l) => l.id === call.leadId) : undefined;

  const [outcome, setOutcome] = useState<CallOutcome | "">("");
  const [notes, setNotes] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);

  useEffect(() => {
    if (call) {
      setOutcome(call.outcome ?? "");
      setNotes(call.notes ?? "");
    }
  }, [call]);

  if (!can("zoom.view")) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-lock-2-line"
            title="Zoom is not available for your role"
            message="Switch demo role to access call review."
            action={
              <Button variant="outline" onClick={() => navigate("/zoom")}>
                Back to Zoom
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="mx-auto w-full max-w-[900px] px-4 py-10 md:px-6">
        <Card>
          <EmptyState
            icon="ri-phone-line"
            title="Call not found"
            message="This call does not exist in the demonstration dataset."
            action={
              <Button variant="outline" onClick={() => navigate("/zoom")}>
                Back to Zoom
              </Button>
            }
          />
        </Card>
      </div>
    );
  }

  const contact = call.direction === "incoming" ? call.caller : call.receiver;
  const canReviewMedia = can("zoom.recordings");
  const canEditOutcome = can("zoom.callback") && (call.salesOwnerId ? canSeeOwner(call.salesOwnerId) : true);

  const saveOutcome = () => {
    if (!outcome) return;
    recordCallOutcome(call.id, outcome, notes);
    // The recorded outcome is reflected on the lead's journey as the linked
    // touchpoint for THIS call — refreshed in place so a call never produces a
    // duplicate touchpoint and First/Second/Latest ordering is preserved.
    if (lead) {
      const outcomeTone =
        outcome === "Interested" ? "Positive" : outcome === "Not Interested" ? "Negative" : "Neutral";
      const outcomeNote = `Call outcome: ${outcome}.${notes.trim() ? ` ${notes.trim()}` : ""}`;
      const existing = state.touchpoints.find(
        (t) => t.leadId === lead.id && t.refId === call.id && t.refType === "call",
      );
      if (existing) {
        updateTouchpoint(existing.id, { outcome: outcomeTone, notes: outcomeNote });
      } else {
        addTouchpoint({
          leadId: lead.id,
          timestamp: call.occurredAt,
          source: lead.source,
          channel: lead.channel,
          interactionType: "Sales call",
          outcome: outcomeTone,
          ownerId: currentUserId,
          notes: outcomeNote,
          refType: "call",
          refId: call.id,
        });
      }
    }
    toast({ title: "Call outcome recorded", message: outcome, tone: "success" });
  };

  const handleTask = (input: TaskInput) => {
    const task = createTask(input);
    attachCallFollowUp(call.id, task.id);
    toast({ title: "Follow-up scheduled", message: "Added to the Planner and linked to this call.", tone: "success" });
    setTaskOpen(false);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-5 md:px-6 md:py-6">
      <div className="flex flex-wrap items-center gap-2 text-[12px] text-foreground-400">
        <Link to="/zoom" className="font-semibold text-foreground-600 hover:text-primary-600">
          Zoom
        </Link>
        <i className="ri-arrow-right-s-line"></i>
        <span>Call {call.id}</span>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-extrabold text-foreground-950">{lead?.name ?? contact}</h1>
            <Badge tone={CALL_STATUS_TONES[call.status]}>{call.status}</Badge>
            <Badge tone={call.direction === "incoming" ? "success" : "primary"}>{call.direction}</Badge>
            <Badge tone="secondary" icon="ri-phone-line">
              {call.platform ?? "Zoom Phone"}
            </Badge>
          </div>
          <p className="mt-1 text-[13px] text-foreground-500">
            {formatDateTime(call.occurredAt)} · {formatDuration(call.durationSec)} · {call.phoneNumber}
          </p>
          <p className="mt-0.5 text-[12px] text-foreground-400">{mediaLabel({
            recordingAvailable: Boolean(call.recordingAvailable),
            transcriptAvailable: Boolean(call.transcriptAvailable),
          })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" leftIcon={<i className="ri-arrow-left-line"></i>} onClick={() => navigate("/zoom")}>
            Back
          </Button>
          {lead ? (
            <Button
              variant="outline"
              leftIcon={<i className="ri-route-line"></i>}
              onClick={() => navigate(`/leads/${lead.id}`)}
            >
              Lead journey
            </Button>
          ) : null}
          {canEditOutcome ? (
            <Button leftIcon={<i className="ri-calendar-check-line"></i>} onClick={() => setTaskOpen(true)}>
              Schedule follow-up
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader
              icon="ri-mic-line"
              iconTone="accent"
              title="Recording & transcript"
              subtitle="Review the conversation — availability is shown honestly"
            />
            <CardBody>
              <CallReview call={call} canReviewMedia={canReviewMedia} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader icon="ri-sticky-note-line" iconTone="secondary" title="Sales notes" subtitle="What was discussed and agreed" />
            <CardBody>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={!canEditOutcome}
                rows={5}
                className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200 disabled:opacity-60"
              />
              <p className="mt-1 text-[11px] text-foreground-400">
                Notes describe the conversation only. A lead is never Closed Won merely because a call was answered.
              </p>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader icon="ri-user-star-line" title="Call details" />
            <CardBody className="space-y-2.5">
              <Row label="Contact" value={contact} />
              <Row label="Employer" value={call.employerName ?? "Not linked"} />
              <Row label="Sales representative" value={userName(call.salesOwnerId ?? lead?.ownerId)} />
              <Row label="Related programme" value={call.programme ?? lead?.programme ?? "Not recorded"} />
              <Row
                label="Related event"
                value={call.relatedEventId ? state.events.find((e) => e.id === call.relatedEventId)?.name ?? "—" : "None"}
              />
              <Row
                label="CRM match"
                value={lead ? `Verified (${call.matchConfidence})` : "No match"}
              />
            </CardBody>
          </Card>

          {lead ? (
            <Card>
              <CardHeader icon="ri-shield-check-line" iconTone="secondary" title="Eligibility information" />
              <CardBody className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-foreground-500">Screening</span>
                  <Badge tone={ELIGIBILITY_TONES[lead.eligibility?.status ?? "Not Assessed"]}>
                    {lead.eligibility?.status ?? "Not Assessed"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-foreground-500">Funding decision</span>
                  <Badge tone={lead.eligibility?.decision === "Verified Eligible" ? "success" : lead.eligibility?.decision ? "danger" : "neutral"}>
                    {lead.eligibility?.decision ?? "Not decided"}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[12px] text-foreground-500">Intake planning</span>
                  <Badge tone="neutral">{lead.intakePlanning ?? "Unassigned"}</Badge>
                </div>
              </CardBody>
            </Card>
          ) : null}

          <Card>
            <CardHeader icon="ri-flag-2-line" iconTone="accent" title="Record outcome" subtitle="Your review decision for this call" />
            <CardBody className="space-y-3">
              {call.outcome ? (
                <Badge tone={CALL_OUTCOME_TONES[call.outcome]} icon={CALL_OUTCOME_ICONS[call.outcome]}>
                  Current: {call.outcome}
                </Badge>
              ) : (
                <Badge tone="neutral">No outcome recorded yet</Badge>
              )}
              <Select
                label="Outcome"
                value={outcome}
                onChange={(v) => setOutcome(v as CallOutcome)}
                options={[{ value: "", label: "Select an outcome…" }, ...CALL_OUTCOMES.map((o) => ({ value: o, label: o, icon: CALL_OUTCOME_ICONS[o] }))]}
              />
              <p className="text-[11px] leading-snug text-foreground-500">
                “Needs Follow-up” and “Wants Future Intake” are recorded here — scheduling a Planner follow-up
                creates a linked task, it does not change the lead’s sales stage.
              </p>
              <Button fullWidth onClick={saveOutcome} disabled={!outcome || !canEditOutcome} leftIcon={<i className="ri-save-line"></i>}>
                Save outcome
              </Button>
              {!canEditOutcome ? (
                <p className="text-[11px] text-foreground-400">Read-only for your role.</p>
              ) : null}
            </CardBody>
          </Card>

          {call.followUpTaskId ? (
            <Card>
              <CardBody className="flex items-center gap-2 text-[12px] text-foreground-600">
                <i className="ri-checkbox-circle-line text-green-600"></i>
                A follow-up task is linked to this call in the Planner.
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>

      <TaskFormModal
        open={taskOpen}
        task={null}
        defaults={{ relatedLeadId: call.leadId, source: "Zoom", ownerId: currentUserId }}
        onClose={() => setTaskOpen(false)}
        onSubmit={handleTask}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-background-200 pb-2 last:border-none last:pb-0">
      <span className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</span>
      <span className="text-right text-[13px] font-medium text-foreground-800">{value}</span>
    </div>
  );
}