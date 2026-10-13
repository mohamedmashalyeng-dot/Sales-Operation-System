import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import {
  ACQUISITION_SOURCES,
  INTERACTION_TYPES,
  TOUCHPOINT_OUTCOMES,
  sourceByName,
} from "@/config/attribution";
import { useWorkspace, type TouchpointInput } from "@/store/WorkspaceProvider";
import type { Touchpoint } from "@/store/types";
import { fromInputDateTime, toInputDateTime } from "@/utils/crm";

interface TouchpointModalProps {
  open: boolean;
  onClose: () => void;
  leadId: string;
  touchpoint?: Touchpoint | null;
  defaultSource: string;
  defaultOwnerId: string;
  onSubmit: (input: TouchpointInput) => void;
}

export default function TouchpointModal({
  open,
  onClose,
  leadId,
  touchpoint,
  defaultSource,
  defaultOwnerId,
  onSubmit,
}: TouchpointModalProps) {
  const { state } = useWorkspace();
  const [timestamp, setTimestamp] = useState("");
  const [source, setSource] = useState(defaultSource);
  const [interactionType, setInteractionType] = useState<string>("Outbound call");
  const [outcome, setOutcome] = useState<string>("Positive");
  const [ownerId, setOwnerId] = useState(defaultOwnerId);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    if (touchpoint) {
      setTimestamp(toInputDateTime(touchpoint.timestamp));
      setSource(touchpoint.source);
      setInteractionType(touchpoint.interactionType);
      setOutcome(touchpoint.outcome);
      setOwnerId(touchpoint.ownerId);
      setNotes(touchpoint.notes);
    } else {
      setTimestamp(toInputDateTime(new Date().toISOString()));
      setSource(defaultSource);
      setInteractionType("Outbound call");
      setOutcome("Positive");
      setOwnerId(defaultOwnerId);
      setNotes("");
    }
    setError("");
  }, [open, touchpoint, defaultSource, defaultOwnerId]);

  const handleSubmit = () => {
    if (!timestamp) {
      setError("A date and time is required.");
      return;
    }
    onSubmit({
      leadId,
      timestamp: fromInputDateTime(timestamp) || new Date().toISOString(),
      source,
      channel: sourceByName(source)?.channel ?? "Direct",
      interactionType,
      outcome,
      ownerId,
      notes: notes.trim(),
      refType: touchpoint?.refType ?? "manual",
      refId: touchpoint?.refId,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={touchpoint ? "Edit touchpoint" : "Record a touchpoint"}
      description="Touchpoints build the lead's attribution journey and feed the reporting."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button leftIcon={<i className="ri-save-line"></i>} onClick={handleSubmit}>
            {touchpoint ? "Save touchpoint" : "Record touchpoint"}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Date & time"
          type="datetime-local"
          value={timestamp}
          error={error}
          onChange={(e) => setTimestamp(e.target.value)}
        />
        <Select
          label="Interaction type"
          value={interactionType}
          onChange={setInteractionType}
          options={INTERACTION_TYPES.map((t) => ({ value: t, label: t }))}
        />
        <Select
          label="Source"
          value={source}
          onChange={setSource}
          options={ACQUISITION_SOURCES.map((s) => ({ value: s.label, label: `${s.label} · ${s.channel}` }))}
        />
        <Select
          label="Outcome"
          value={outcome}
          onChange={setOutcome}
          options={TOUCHPOINT_OUTCOMES.map((o) => ({ value: o, label: o }))}
        />
        <Select
          label="Owner"
          value={ownerId}
          onChange={setOwnerId}
          options={state.users.map((u) => ({ value: u.id, label: u.name }))}
        />
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="What happened in this interaction?"
            className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <p className="sm:col-span-2 rounded-md bg-background-100 px-3 py-2 text-[11px] leading-snug text-foreground-500">
          Source, channel and interaction type are stored separately. A touchpoint is only ever marked
          as the closing interaction from the closing workflow.
        </p>
      </div>
    </Modal>
  );
}