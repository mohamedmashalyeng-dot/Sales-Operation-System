import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import EmptyState from "@/components/base/EmptyState";
import PermissionGate from "@/components/feature/PermissionGate";
import { READINESS_TONES } from "@/config/eligibility";
import type { ReadinessLevel } from "@/config/eligibility";
import { INTAKES } from "@/config/crm";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { IntakeRow } from "@/pages/future-intake/types";
import { formatDate, relativeTime } from "@/utils/format";

interface IntakeBoardProps {
  rows: IntakeRow[];
  onEdit: (row: IntakeRow) => void;
  onContact: (row: IntakeRow) => void;
  onReturn: (row: IntakeRow) => void;
}

export default function IntakeBoard({ rows, onEdit, onContact, onReturn }: IntakeBoardProps) {
  const { userName } = useWorkspace();
  const columns = INTAKES.filter((intake) => rows.some((r) => r.record.preferredIntake === intake));
  const uncategorised = rows.filter((r) => !INTAKES.includes(r.record.preferredIntake));

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="ri-calendar-schedule-line"
        title="No deferred learners"
        message="Leads moved to a future intake will appear here, grouped by their preferred cohort."
      />
    );
  }

  return (
    <div className="kbc-scroll flex gap-4 overflow-x-auto pb-2">
      {[...columns, ...(uncategorised.length ? ["Unassigned intake"] : [])].map((intake) => {
        const columnRows = intake === "Unassigned intake"
          ? uncategorised
          : rows.filter((r) => r.record.preferredIntake === intake);
        return (
          <div key={intake} className="w-[320px] shrink-0 rounded-lg border border-background-200 bg-background-100/60">
            <div className="flex items-center justify-between border-b border-background-200 px-3 py-2.5">
              <span className="text-[13px] font-bold text-foreground-800">{intake}</span>
              <span className="rounded-full bg-background-200 px-2 py-0.5 text-[11px] font-bold text-foreground-600">
                {columnRows.length}
              </span>
            </div>
            <div className="space-y-2.5 p-2.5">
              {columnRows.map(({ record, lead }) => {
                const overdue = new Date(record.nextFollowUpAt).getTime() < Date.now();
                return (
                  <div key={record.id} className="rounded-lg border border-background-200 bg-background-50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[13px] font-bold text-foreground-900">
                        {lead?.name ?? record.leadId}
                      </p>
                      {overdue ? <Badge tone="danger">Overdue</Badge> : null}
                    </div>
                    <p className="mt-0.5 text-[11px] text-foreground-500">{record.currentProgramme}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="secondary">{record.reason}</Badge>
                      <Badge tone={READINESS_TONES[record.learnerReadiness as ReadinessLevel] ?? "neutral"}>
                        Learner: {record.learnerReadiness}
                      </Badge>
                      <Badge tone={READINESS_TONES[record.employerReadiness as ReadinessLevel] ?? "neutral"}>
                        Employer: {record.employerReadiness}
                      </Badge>
                    </div>
                    <div className="mt-2 space-y-0.5 text-[11px] text-foreground-500">
                      <p>Sales: {userName(record.salesOwnerId)} · Enrolment: {userName(record.enrolmentOwnerId)}</p>
                      <p>Last contact: {relativeTime(record.lastContactAt)}</p>
                      <p className={overdue ? "font-semibold text-red-600" : ""}>
                        Follow-up: {formatDate(record.nextFollowUpAt)}
                      </p>
                    </div>
                    <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-background-200 pt-2.5">
                      <PermissionGate capability="intake.manage">
                        <Button size="xs" variant="subtle" leftIcon={<i className="ri-phone-line"></i>} onClick={() => onContact({ record, lead })}>
                          Contact
                        </Button>
                      </PermissionGate>
                      <PermissionGate capability="intake.manage">
                        <Button size="xs" variant="ghost" leftIcon={<i className="ri-pencil-line"></i>} onClick={() => onEdit({ record, lead })}>
                          Edit
                        </Button>
                      </PermissionGate>
                      <PermissionGate capability="intake.manage">
                        <Button size="xs" variant="ghost" leftIcon={<i className="ri-arrow-go-forward-line"></i>} onClick={() => onReturn({ record, lead })}>
                          Return
                        </Button>
                      </PermissionGate>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}