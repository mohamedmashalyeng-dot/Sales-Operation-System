import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import { LOSS_REASONS } from "@/config/attribution";
import { useWorkspace, type ClosingInput } from "@/store/WorkspaceProvider";
import type { Lead } from "@/store/types";
import { fromInputDateTime, toInputDateTime } from "@/utils/crm";

interface ClosingModalProps {
  open: boolean;
  onClose: () => void;
  lead: Lead;
  onSubmit: (input: ClosingInput) => void;
}

export default function ClosingModal({ open, onClose, lead, onSubmit }: ClosingModalProps) {
  const { state } = useWorkspace();
  const [outcome, setOutcome] = useState<"won" | "lost">("won");
  const [closingDate, setClosingDate] = useState("");
  const [closingOwnerId, setClosingOwnerId] = useState(lead.ownerId);
  const [lossReason, setLossReason] = useState<string>(LOSS_REASONS[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setOutcome("won"); setClosingDate(toInputDateTime(new Date().toISOString()));
    setClosingOwnerId(lead.ownerId); setLossReason(LOSS_REASONS[0]); setNotes(""); setError("");
  }, [open, lead.id, lead.ownerId]);
  const submit = () => {
    const date = fromInputDateTime(closingDate);
    if (!date) { setError("A valid closing date is required."); return; }
    onSubmit({ leadId: lead.id, outcome, closingDate: date, closingOwnerId,
      interactionType: "Lead closed", source: lead.source, channel: lead.channel,
      notes: notes.trim(), lossReason: outcome === "lost" ? lossReason : undefined });
  };
  return <Modal open={open} onClose={onClose} title="Close lead" size="md"
    description="Record the outcome, date and reason for closing this lead."
    footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button variant={outcome === "won" ? "primary" : "danger"} onClick={submit}>{outcome === "won" ? "Confirm closed won" : "Confirm closed lost"}</Button></>}>
    <div className="space-y-4">
      <Select label="Closing outcome" value={outcome} onChange={value => setOutcome(value as "won" | "lost")}
        options={[{ value: "won", label: "Closed Won" }, { value: "lost", label: "Closed Lost" }]} />
      <Input label="Closing date & time" type="datetime-local" value={closingDate} error={error} onChange={event => setClosingDate(event.target.value)} />
      <Select label="Closing owner" value={closingOwnerId} onChange={setClosingOwnerId} options={state.users.map(user => ({ value: user.id, label: user.name }))} />
      {outcome === "lost" ? <Select label="Loss reason" value={lossReason} onChange={setLossReason} options={LOSS_REASONS.map(value => ({ value, label: value }))} /> : null}
      <div><label className="mb-1.5 block text-xs font-semibold text-foreground-500" htmlFor="closing-notes">Closing notes</label>
        <textarea id="closing-notes" value={notes} onChange={event => setNotes(event.target.value)} rows={3} maxLength={500}
          className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900" /></div>
      <p className="text-xs text-foreground-500">Closing a sale, submitting an application and confirming enrolment remain separate milestones.</p>
    </div>
  </Modal>;
}
