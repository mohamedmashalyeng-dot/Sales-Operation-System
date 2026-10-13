import { useState } from "react";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import FutureIntakeModal from "@/pages/leads/components/FutureIntakeModal";
import {
  ELIGIBILITY_TONES,
  ENROLMENT_TONES,
  INTAKE_PLANNING_TONES,
  READINESS_TONES,
} from "@/config/eligibility";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { Lead } from "@/store/types";
import type { ReadinessLevel } from "@/config/eligibility";
import { STAGE_TONES } from "@/utils/crm";
import { formatDate, formatDateTime, relativeTime } from "@/utils/format";

export default function IntakePanel({ lead }: { lead: Lead }) {
  const { toast } = useToast();
  const { state, userName, removeFromFutureIntake } = useWorkspace();
  const [modalOpen, setModalOpen] = useState(false);

  const record = state.futureIntakes.find((f) => f.leadId === lead.id);
  const overdue = record ? new Date(record.nextFollowUpAt).getTime() < Date.now() : false;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon="ri-node-tree"
          title="Progression dimensions"
          subtitle="Kept deliberately separate — one record can be open on several at once"
        />
        <CardBody className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Dimension
            label="Sales stage"
            value={lead.stage}
            tone={STAGE_TONES[lead.stage]}
          />
          <Dimension
            label="Funding eligibility"
            value={lead.eligibility?.status ?? "Not Assessed"}
            tone={ELIGIBILITY_TONES[lead.eligibility?.status ?? "Not Assessed"]}
          />
          <Dimension
            label="Intake planning"
            value={lead.intakePlanning ?? "Unassigned"}
            tone={INTAKE_PLANNING_TONES[lead.intakePlanning ?? "Unassigned"]}
          />
          <Dimension
            label="Enrolment"
            value={lead.enrolment ?? "Not Started"}
            tone={ENROLMENT_TONES[lead.enrolment ?? "Not Started"]}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          icon="ri-calendar-schedule-line"
          iconTone="accent"
          title="Future intake"
          subtitle="Eligible learners who want to start later are retained, not lost"
          action={
            record ? (
              <PermissionGate capability="intake.manage">
                <Button size="sm" variant="outline" leftIcon={<i className="ri-pencil-line"></i>} onClick={() => setModalOpen(true)}>
                  Update
                </Button>
              </PermissionGate>
            ) : (
              <PermissionGate capability="intake.manage">
                <Button size="sm" leftIcon={<i className="ri-calendar-schedule-line"></i>} onClick={() => setModalOpen(true)}>
                  Move to future intake
                </Button>
              </PermissionGate>
            )
          }
        />
        <CardBody>
          {!record ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-dashed border-background-300 bg-background-50 p-4">
              <p className="text-[13px] text-foreground-600">
                This lead is not currently deferred to a future intake.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Preferred intake" value={record.preferredIntake} />
                <Field label="Preferred start" value={record.preferredStartMonth || "Not recorded"} />
                <Field label="Reason" value={record.reason} />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Learner readiness</p>
                  <div className="mt-1">
                    <Badge tone={READINESS_TONES[record.learnerReadiness as ReadinessLevel] ?? "neutral"}>
                      {record.learnerReadiness}
                    </Badge>
                  </div>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Employer readiness</p>
                  <div className="mt-1">
                    <Badge tone={READINESS_TONES[record.employerReadiness as ReadinessLevel] ?? "neutral"}>
                      {record.employerReadiness}
                    </Badge>
                  </div>
                </div>
                <Field label="Deferred on" value={formatDate(record.deferredAt)} />
                <Field label="Responsible Sales" value={userName(record.salesOwnerId)} />
                <Field label="Responsible Enrolment" value={userName(record.enrolmentOwnerId)} />
                <Field label="Last contact" value={relativeTime(record.lastContactAt)} />
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Next follow-up</p>
                  <p className={`mt-1 text-[13px] font-medium ${overdue ? "text-red-600" : "text-foreground-900"}`}>
                    {formatDateTime(record.nextFollowUpAt)} {overdue ? "· overdue" : ""}
                  </p>
                </div>
              </div>
              {record.notes ? (
                <p className="rounded-md bg-background-100 px-3 py-2 text-[12.5px] text-foreground-700">{record.notes}</p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 border-t border-background-200 pt-3">
                <PermissionGate capability="intake.manage">
                  <Button
                    size="sm"
                    variant="subtle"
                    leftIcon={<i className="ri-arrow-go-forward-line"></i>}
                    onClick={() => {
                      removeFromFutureIntake(record.id);
                      toast({ title: "Returned to active intake", tone: "success" });
                    }}
                  >
                    Return to active intake
                  </Button>
                </PermissionGate>
                <span className="text-[11px] text-foreground-400">
                  Re-engagement flagged · re-verify eligibility before the intake approaches
                </span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <FutureIntakeModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        lead={lead}
        record={record ?? null}
      />
    </div>
  );
}

function Dimension({ label, value, tone }: { label: string; value: string; tone: Parameters<typeof Badge>[0]["tone"] }) {
  return (
    <div className="rounded-lg border border-background-200 bg-background-50 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-400">{label}</p>
      <div className="mt-1.5">
        <Badge tone={tone} dot>
          {value}
        </Badge>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">{label}</p>
      <p className="mt-1 text-[13px] font-medium text-foreground-900">{value}</p>
    </div>
  );
}