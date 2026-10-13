import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import { INTAKES } from "@/config/crm";
import { DEFERRAL_REASONS, READINESS_LEVELS } from "@/config/eligibility";
import { useWorkspace, type FutureIntakeInput } from "@/store/WorkspaceProvider";
import type { FutureIntakeRecord, Lead } from "@/store/types";
import { fromInputDateTime, toInputDateTime } from "@/utils/crm";

interface FutureIntakeModalProps {
  open: boolean;
  onClose: () => void;
  lead: Lead;
  record?: FutureIntakeRecord | null;
}

export default function FutureIntakeModal({ open, onClose, lead, record }: FutureIntakeModalProps) {
  const { toast } = useToast();
  const { state, moveToFutureIntake } = useWorkspace();
  const users = state.users;

  const [preferredIntake, setPreferredIntake] = useState(INTAKES[2] ?? INTAKES[0]);
  const [preferredStartMonth, setPreferredStartMonth] = useState("");
  const [reason, setReason] = useState<string>(DEFERRAL_REASONS[0]);
  const [learnerReadiness, setLearnerReadiness] = useState<string>(READINESS_LEVELS[0]);
  const [employerReadiness, setEmployerReadiness] = useState<string>(READINESS_LEVELS[0]);
  const [salesOwnerId, setSalesOwnerId] = useState(lead.ownerId);
  const [enrolmentOwnerId, setEnrolmentOwnerId] = useState(lead.ownerId);
  const [lastContactAt, setLastContactAt] = useState("");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [createFollowUpTask, setCreateFollowUpTask] = useState(true);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (record) {
      setPreferredIntake(record.preferredIntake);
      setPreferredStartMonth(record.preferredStartMonth);
      setReason(record.reason);
      setLearnerReadiness(record.learnerReadiness);
      setEmployerReadiness(record.employerReadiness);
      setSalesOwnerId(record.salesOwnerId);
      setEnrolmentOwnerId(record.enrolmentOwnerId);
      setLastContactAt(toInputDateTime(record.lastContactAt));
      setNextFollowUpAt(toInputDateTime(record.nextFollowUpAt));
      setNotes(record.notes);
    } else {
      setPreferredIntake(INTAKES[2] ?? INTAKES[0]);
      setPreferredStartMonth("");
      setReason(DEFERRAL_REASONS[0]);
      setLearnerReadiness(READINESS_LEVELS[0]);
      setEmployerReadiness(READINESS_LEVELS[0]);
      setSalesOwnerId(lead.ownerId);
      setEnrolmentOwnerId(lead.ownerId);
      setLastContactAt(toInputDateTime(new Date().toISOString()));
      setNextFollowUpAt("");
      setCreateFollowUpTask(true);
      setNotes("");
    }
    setError("");
  }, [open, record, lead.ownerId]);

  const submit = () => {
    if (!nextFollowUpAt) {
      setError("A next follow-up date is required.");
      return;
    }
    const input: FutureIntakeInput = {
      leadId: lead.id,
      currentProgramme: lead.programme,
      currentIntake: lead.intake,
      preferredIntake,
      preferredStartMonth,
      reason,
      learnerReadiness,
      employerReadiness,
      salesOwnerId,
      enrolmentOwnerId,
      lastContactAt: fromInputDateTime(lastContactAt) || new Date().toISOString(),
      nextFollowUpAt: fromInputDateTime(nextFollowUpAt) || new Date().toISOString(),
      notes: notes.trim(),
      createFollowUpTask,
    };
    moveToFutureIntake(input);
    toast({
      title: "Moved to future intake",
      message: createFollowUpTask
        ? "The lead was deferred and a Planner follow-up was created."
        : "The lead was deferred to a future intake.",
      tone: "success",
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={record ? "Update future intake" : "Move to future intake"}
      description="A deferred lead is retained and managed for a later intake — it is not treated as lost."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button leftIcon={<i className="ri-calendar-schedule-line"></i>} onClick={submit}>
            {record ? "Save deferral" : "Move to future intake"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Current programme</p>
          <p className="mt-1 text-[13px] font-medium text-foreground-800">{lead.programme}</p>
        </div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-foreground-400">Current proposed intake</p>
          <p className="mt-1 text-[13px] font-medium text-foreground-800">{lead.intake}</p>
        </div>

        <Select
          label="Preferred future intake"
          value={preferredIntake}
          onChange={setPreferredIntake}
          options={INTAKES.map((i) => ({ value: i, label: i }))}
        />
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Preferred start month
          </label>
          <input
            type="month"
            value={preferredStartMonth}
            onChange={(e) => setPreferredStartMonth(e.target.value)}
            className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>

        <Select
          label="Reason for deferral"
          value={reason}
          onChange={setReason}
          options={DEFERRAL_REASONS.map((r) => ({ value: r, label: r }))}
        />
        <Select
          label="Learner readiness"
          value={learnerReadiness}
          onChange={setLearnerReadiness}
          options={READINESS_LEVELS.map((r) => ({ value: r, label: r }))}
        />
        <Select
          label="Employer readiness"
          value={employerReadiness}
          onChange={setEmployerReadiness}
          options={READINESS_LEVELS.map((r) => ({ value: r, label: r }))}
        />
        <Select
          label="Responsible Sales staff"
          value={salesOwnerId}
          onChange={setSalesOwnerId}
          options={users.map((u) => ({ value: u.id, label: u.name }))}
        />
        <Select
          label="Responsible Enrolment staff"
          value={enrolmentOwnerId}
          onChange={setEnrolmentOwnerId}
          options={users.map((u) => ({ value: u.id, label: u.name }))}
        />

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Last contact
          </label>
          <input
            type="datetime-local"
            value={lastContactAt}
            onChange={(e) => setLastContactAt(e.target.value)}
            className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Next follow-up
          </label>
          <input
            type="datetime-local"
            value={nextFollowUpAt}
            onChange={(e) => setNextFollowUpAt(e.target.value)}
            className="h-9 w-full rounded-md border border-background-300 bg-background-50 px-3 text-sm text-foreground-900 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
          {error ? <p className="mt-1 text-xs font-medium text-red-600">{error}</p> : null}
        </div>

        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="Why is this learner deferring, and what is needed to re-engage?"
            className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>

        <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={createFollowUpTask}
            onChange={(e) => setCreateFollowUpTask(e.target.checked)}
            className="h-4 w-4 cursor-pointer accent-primary-500"
          />
          <span className="text-[13px] text-foreground-700">
            Create a Planner follow-up task for this date
          </span>
        </label>

        <p className="sm:col-span-2 rounded-md bg-accent-50 px-3 py-2 text-[11px] leading-snug text-accent-900">
          Future Intake is separate from Closed Lost and from a confirmed apprenticeship start. The
          learner will be flagged for re-engagement and eligibility re-verification as the intake
          approaches.
        </p>
      </div>
    </Modal>
  );
}