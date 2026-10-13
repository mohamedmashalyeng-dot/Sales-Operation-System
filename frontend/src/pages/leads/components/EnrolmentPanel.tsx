import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import { AGREEMENT_TONES, DAS_TONES } from "@/config/employer";
import { ENROLMENT_STAGES, ENROLMENT_TONES, type EnrolmentStage } from "@/config/eligibility";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Lead } from "@/store/types";
import { APP_STATUS_TONES } from "@/utils/crm";
import { formatDate } from "@/utils/format";

export default function EnrolmentPanel({ lead }: { lead: Lead }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { state, updateLead, addLeadNote } = useWorkspace();

  const stage = (lead.enrolment ?? "Not Started") as EnrolmentStage;
  const applications = state.applications.filter(
    (a) => a.leadId === lead.id || lead.applicationIds.includes(a.id),
  );
  const agreement = state.employerAgreements.find((a) => a.leadId === lead.id);
  const das = state.dasRecords.find((d) => d.leadId === lead.id);
  const employerName = agreement?.employerName ?? das?.employerName ?? "";

  const agreementSigned = agreement?.status === "Signed";
  const dasConfirmed = das?.status === "Confirmed";
  const enrolledOrStarted = stage === "Enrolled" || stage === "Apprenticeship Started";
  const readyToEnrol = agreementSigned && dasConfirmed;

  const [draft, setDraft] = useState<EnrolmentStage>(stage);
  const [note, setNote] = useState("");

  const milestones = [
    {
      key: "application",
      label: "Application submitted",
      done: applications.length > 0,
      detail: applications.length > 0 ? `${applications.length} on record` : "No application yet",
    },
    { key: "agreement", label: "Employer agreement signed", done: agreementSigned, detail: agreement?.status ?? "Not Sent" },
    { key: "das", label: "Apprenticeship Service provider addition confirmed", done: dasConfirmed, detail: das?.status ?? "Not Started" },
    { key: "enrolment", label: "Enrolment completed", done: enrolledOrStarted, detail: enrolledOrStarted ? "Recorded" : "Not recorded" },
    { key: "start", label: "Apprenticeship start confirmed", done: stage === "Apprenticeship Started", detail: stage === "Apprenticeship Started" ? "Confirmed" : "Not confirmed" },
  ];

  const recordMilestone = () => {
    if (draft === stage) {
      toast({ title: "No change", message: "Select a different enrolment stage.", tone: "info" });
      return;
    }
    updateLead(lead.id, { enrolment: draft });
    addLeadNote(
      lead.id,
      `Enrolment milestone recorded: ${stage} → ${draft}${note.trim() ? ` — ${note.trim()}` : ""}`,
    );
    toast({ title: "Enrolment milestone recorded", message: `Moved to ${draft}.`, tone: "success" });
    setNote("");
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon="ri-graduation-cap-line"
          iconTone="accent"
          title="Enrolment milestones"
          subtitle="Application, agreement, DAS, enrolment and apprenticeship start are separate outcomes"
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={ENROLMENT_TONES[stage]} dot>
              {stage}
            </Badge>
            <Badge tone={readyToEnrol ? "success" : "warning"} icon={readyToEnrol ? "ri-checkbox-circle-line" : "ri-error-warning-line"}>
              {readyToEnrol ? "Ready to enrol" : "Employer actions outstanding"}
            </Badge>
          </div>
          <ul className="space-y-2">
            {milestones.map((m) => (
              <li
                key={m.key}
                className="flex items-center gap-3 rounded-md border border-background-200 bg-background-50 px-3 py-2.5"
              >
                <i className={m.done ? "ri-checkbox-circle-fill text-green-500" : "ri-checkbox-blank-circle-line text-foreground-400"}></i>
                <span className="min-w-0 flex-1 text-[13px] font-medium text-foreground-800">{m.label}</span>
                <Badge tone={m.done ? "success" : "neutral"}>{m.detail}</Badge>
              </li>
            ))}
          </ul>
          <p className="rounded-md bg-background-100 px-3 py-2 text-[11px] leading-snug text-foreground-500">
            A milestone only shows as complete when an explicit status is recorded. A record existing never implies
            a signed agreement, a confirmed provider addition, verified funding, a completed enrolment or a confirmed
            apprenticeship start.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon="ri-flag-2-line"
          title="Record enrolment milestone"
          subtitle="Recorded explicitly by authorised Enrolment staff or Admin"
        />
        <CardBody className="space-y-3">
          <PermissionGate
            capability="employer.manage"
            fallback={
              <p className="rounded-md bg-background-100 px-3 py-2 text-[12px] text-foreground-500">
                Recording enrolment and confirmed apprenticeship starts is restricted to authorised Enrolment staff
                or Admin in this demonstration. Switch demo role to record a milestone.
              </p>
            }
          >
            {!readyToEnrol && (draft === "Enrolled" || draft === "Apprenticeship Started") ? (
              <p className="rounded-md bg-accent-50 px-3 py-2 text-[11.5px] font-medium text-accent-900">
                The employer agreement is <strong>{agreement?.status ?? "Not Sent"}</strong> and Apprenticeship
                Service / DAS is <strong>{das?.status ?? "Not Started"}</strong>. You can still record a milestone,
                but nothing is implied automatically.
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Select
                label="Enrolment stage"
                value={draft}
                onChange={(v) => setDraft(v as EnrolmentStage)}
                options={ENROLMENT_STAGES.map((s) => ({ value: s, label: s }))}
              />
              <div>
                <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
                  Milestone note
                </label>
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value.slice(0, 240))}
                  placeholder="Optional note…"
                  className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-[13px] text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
                />
              </div>
            </div>
            <div className="flex justify-end">
              <Button leftIcon={<i className="ri-save-line"></i>} onClick={recordMilestone}>
                Record milestone
              </Button>
            </div>
          </PermissionGate>
        </CardBody>
      </Card>

      {applications.length > 0 ? (
        <Card>
          <CardHeader icon="ri-file-list-3-line" title="Applications" subtitle={`${applications.length} linked`} />
          <CardBody>
            <ul className="space-y-2">
              {applications.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => navigate(`/applications/${a.id}`)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md border border-background-200 bg-background-50 px-3 py-2 text-left hover:border-primary-300"
                  >
                    <i className="ri-file-list-3-line text-foreground-500"></i>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground-800">{a.programme}</span>
                      <span className="block text-[11px] text-foreground-400">
                        {a.id} · submitted {formatDate(a.submittedAt)}
                      </span>
                    </span>
                    <Badge tone={APP_STATUS_TONES[a.status]}>{a.status}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          icon="ri-building-2-line"
          iconTone="secondary"
          title="Employer actions"
          subtitle="Agreement and Apprenticeship Service / DAS remain separate outcomes"
        />
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-background-200 bg-background-50 px-3 py-2.5">
            <span className="text-[13px] text-foreground-700">Employer agreement</span>
            <Badge tone={AGREEMENT_TONES[(agreement?.status ?? "Not Sent") as keyof typeof AGREEMENT_TONES] ?? "neutral"}>
              {agreement?.status ?? "Not Sent"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-background-200 bg-background-50 px-3 py-2.5">
            <span className="text-[13px] text-foreground-700">Apprenticeship Service / DAS</span>
            <Badge tone={DAS_TONES[(das?.status ?? "Not Started") as keyof typeof DAS_TONES] ?? "neutral"}>
              {das?.status ?? "Not Started"}
            </Badge>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<i className="ri-arrow-right-line"></i>}
              onClick={() => navigate(employerName ? `/employers/${encodeURIComponent(employerName)}` : "/employers")}
            >
              Open employer onboarding
            </Button>
          </div>
          <p className="rounded-md bg-background-100 px-3 py-2 text-[11px] leading-snug text-foreground-500">
            Agreement, DAS, application, enrolment and apprenticeship start are tracked independently and never
            inferred from one another.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}