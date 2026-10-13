import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Input from "@/components/base/Input";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import {
  ACQUISITION_SOURCES,
  CAMPAIGNS,
  INTERACTION_TYPES,
  LOSS_REASONS,
  sourceByName,
} from "@/config/attribution";
import { useWorkspace, type ClosingInput } from "@/store/WorkspaceProvider";
import type { Lead, Touchpoint } from "@/store/types";
import { fromInputDateTime, toInputDateTime } from "@/utils/crm";

interface ClosingModalProps {
  open: boolean;
  onClose: () => void;
  lead: Lead;
  touchpoints: Touchpoint[];
  onSubmit: (input: ClosingInput) => void;
}

export default function ClosingModal({
  open,
  onClose,
  lead,
  touchpoints,
  onSubmit,
}: ClosingModalProps) {
  const { state } = useWorkspace();
  const [outcome, setOutcome] = useState<"won" | "lost">("won");
  const [closingDate, setClosingDate] = useState("");
  const [closingOwnerId, setClosingOwnerId] = useState(lead.ownerId);
  const [recordNew, setRecordNew] = useState(touchpoints.length === 0);
  const [touchpointId, setTouchpointId] = useState(touchpoints[0]?.id ?? "");
  const [interactionType, setInteractionType] = useState("Outbound call");
  const [source, setSource] = useState(lead.source);
  const [campaignId, setCampaignId] = useState(lead.campaignId ?? "");
  const [lossReason, setLossReason] = useState<string>(LOSS_REASONS[0]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setOutcome("won");
    setClosingDate(toInputDateTime(new Date().toISOString()));
    setClosingOwnerId(lead.ownerId);
    setRecordNew(touchpoints.length === 0);
    setTouchpointId(touchpoints[0]?.id ?? "");
    setInteractionType("Outbound call");
    setSource(lead.source);
    setCampaignId(lead.campaignId ?? "");
    setLossReason(LOSS_REASONS[0]);
    setNotes("");
    setError("");
  }, [open, lead, touchpoints]);

  const selectedTouchpoint = touchpoints.find((t) => t.id === touchpointId);
  const effectiveSource = recordNew ? source : selectedTouchpoint?.source ?? source;
  const effectiveInteraction = recordNew ? interactionType : selectedTouchpoint?.interactionType ?? interactionType;

  const handleSubmit = () => {
    if (!closingDate) {
      setError("A closing date is required.");
      return;
    }
    onSubmit({
      leadId: lead.id,
      outcome,
      closingDate: fromInputDateTime(closingDate) || new Date().toISOString(),
      closingOwnerId,
      interactionType: effectiveInteraction,
      source: effectiveSource,
      channel: sourceByName(effectiveSource)?.channel ?? lead.channel,
      campaign: CAMPAIGNS.find((c) => c.id === campaignId)?.name,
      notes: notes.trim(),
      lossReason: outcome === "lost" ? lossReason : undefined,
      newTouchpoint: recordNew,
      touchpointId: recordNew ? undefined : touchpointId,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={outcome === "won" ? "Close lead — Won" : "Close lead — Lost"}
      description="Captures the closing attribution and freezes it against later interactions."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={outcome === "won" ? "primary" : "danger"}
            leftIcon={<i className={outcome === "won" ? "ri-trophy-line" : "ri-close-circle-line"}></i>}
            onClick={handleSubmit}
          >
            {outcome === "won" ? "Confirm closed won" : "Confirm closed lost"}
          </Button>
        </>
      }
    >
      <div className="mb-4 grid grid-cols-2 gap-2">
        {(["won", "lost"] as const).map((value) => {
          const active = outcome === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setOutcome(value)}
              className={`cursor-pointer rounded-lg border p-3 text-left transition-colors ${
                active
                  ? value === "won"
                    ? "border-green-400 bg-green-50"
                    : "border-red-400 bg-red-50"
                  : "border-background-200 bg-background-50 hover:bg-background-100"
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={`flex h-6 w-6 items-center justify-center rounded-md text-base ${
                    value === "won" ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                  }`}
                >
                  <i className={value === "won" ? "ri-trophy-line" : "ri-close-circle-line"}></i>
                </span>
                <span className="text-[13px] font-semibold text-foreground-900">
                  {value === "won" ? "Closed Won" : "Closed Lost"}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Input
          label="Closing date & time"
          type="datetime-local"
          value={closingDate}
          error={error}
          onChange={(e) => setClosingDate(e.target.value)}
        />
        <Select
          label="Closing owner"
          value={closingOwnerId}
          onChange={setClosingOwnerId}
          options={state.users.map((u) => ({ value: u.id, label: u.name }))}
        />

        <div className="sm:col-span-2 rounded-lg border border-background-200 bg-background-100 p-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setRecordNew(false)}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                !recordNew ? "bg-primary-500 text-background-50" : "bg-background-50 text-foreground-600"
              }`}
            >
              Select existing touchpoint
            </button>
            <button
              type="button"
              onClick={() => setRecordNew(true)}
              className={`cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                recordNew ? "bg-primary-500 text-background-50" : "bg-background-50 text-foreground-600"
              }`}
            >
              Record new closing interaction
            </button>
          </div>

          {!recordNew ? (
            <div className="mt-3">
              {touchpoints.length === 0 ? (
                <p className="text-[12px] text-foreground-500">
                  No touchpoints recorded yet — switch to “Record new closing interaction”.
                </p>
              ) : (
                <Select
                  label="Closing interaction"
                  value={touchpointId}
                  onChange={setTouchpointId}
                  options={touchpoints.map((t) => ({
                    value: t.id,
                    label: `${t.interactionType} · ${t.source}`,
                  }))}
                />
              )}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                options={ACQUISITION_SOURCES.map((s) => ({ value: s.label, label: s.label }))}
              />
            </div>
          )}
        </div>

        <Select
          label="Campaign (optional)"
          value={campaignId}
          onChange={setCampaignId}
          options={[{ value: "", label: "None" }, ...CAMPAIGNS.map((c) => ({ value: c.id, label: c.name }))]}
        />

        {outcome === "lost" ? (
          <Select
            label="Loss reason"
            value={lossReason}
            onChange={setLossReason}
            options={LOSS_REASONS.map((r) => ({ value: r, label: r }))}
          />
        ) : (
          <div className="hidden sm:block"></div>
        )}

        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Closing notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="Summarise how the lead closed…"
            className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>

        <p className="sm:col-span-2 rounded-md bg-accent-50 px-3 py-2 text-[11px] leading-snug text-accent-900">
          Closed Won, Application submitted and Officially Enrolled are separate milestones. An
          application or enrolment is never automatically treated as a sale.
        </p>
      </div>
    </Modal>
  );
}