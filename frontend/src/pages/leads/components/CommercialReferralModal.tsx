import { useEffect, useState } from "react";
import Button from "@/components/base/Button";
import Modal from "@/components/base/Modal";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import {
  BUDGET_STATUSES,
  COMMERCIAL_PROGRAMMES,
  COMMERCIAL_OPTION_TYPES,
  COMMERCIAL_REFERRAL_REASONS,
  FUNDING_INTERESTS,
  QUOTE_STATUSES,
} from "@/config/commercial";
import { useWorkspace, type CommercialInput } from "@/store/WorkspaceProvider";
import type { Lead } from "@/store/types";

interface CommercialReferralModalProps {
  open: boolean;
  onClose: () => void;
  lead: Lead;
}

export default function CommercialReferralModal({ open, onClose, lead }: CommercialReferralModalProps) {
  const { toast } = useToast();
  const { state, referCommercial } = useWorkspace();
  const users = state.users;

  const [fundingEligibilityOutcome, setFundingEligibilityOutcome] = useState<string>(
    lead.eligibility?.decision ?? lead.eligibility?.status ?? "Not Eligible for Funding",
  );
  const [referralReason, setReferralReason] = useState<string>(COMMERCIAL_REFERRAL_REASONS[0]);
  const [programmeInterest, setProgrammeInterest] = useState(lead.programme);
  const [suggestedProgramme, setSuggestedProgramme] = useState<string>(COMMERCIAL_PROGRAMMES[0]);
  const [optionType, setOptionType] = useState<string>(COMMERCIAL_OPTION_TYPES[0]);
  const [fundingInterest, setFundingInterest] = useState<string>(FUNDING_INTERESTS[0]);
  const [budgetStatus, setBudgetStatus] = useState<string>(BUDGET_STATUSES[0]);
  const [quoteStatus, setQuoteStatus] = useState<string>(QUOTE_STATUSES[0]);
  const [commercialOwnerId, setCommercialOwnerId] = useState(lead.ownerId);
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open) return;
    setFundingEligibilityOutcome(
      lead.eligibility?.decision ?? lead.eligibility?.status ?? "Not Eligible for Funding",
    );
    setReferralReason(COMMERCIAL_REFERRAL_REASONS[0]);
    setProgrammeInterest(lead.programme);
    setSuggestedProgramme(COMMERCIAL_PROGRAMMES[0]);
    setOptionType(COMMERCIAL_OPTION_TYPES[0]);
    setFundingInterest(FUNDING_INTERESTS[0]);
    setBudgetStatus(BUDGET_STATUSES[0]);
    setQuoteStatus(QUOTE_STATUSES[0]);
    setCommercialOwnerId(lead.ownerId);
    setNextFollowUpAt("");
    setNotes("");
  }, [open, lead]);

  const submit = () => {
    const input: CommercialInput = {
      leadId: lead.id,
      fundingEligibilityOutcome,
      referralReason,
      programmeInterest,
      suggestedProgramme,
      optionType,
      fundingInterest,
      budgetStatus,
      quoteStatus,
      commercialOwnerId,
      nextFollowUpAt: nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : new Date().toISOString(),
      notes: notes.trim(),
    };
    referCommercial(input);
    toast({
      title: "Referred for commercial review",
      message: "The original acquisition source and journey are unchanged.",
      tone: "success",
    });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Refer for commercial review"
      description="Suitability and programme choice remain subject to staff review."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="accent" leftIcon={<i className="ri-briefcase-4-line"></i>} onClick={submit}>
            Refer to Commercial
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Select
          label="Funding eligibility outcome"
          value={fundingEligibilityOutcome}
          onChange={setFundingEligibilityOutcome}
          options={[
            { value: "Not Eligible for Funding", label: "Not Eligible for Funding" },
            { value: "Review Required", label: "Review Required" },
            { value: "Information Required", label: "Information Required" },
          ]}
        />
        <Select
          label="Main reason for referral"
          value={referralReason}
          onChange={setReferralReason}
          options={COMMERCIAL_REFERRAL_REASONS.map((r) => ({ value: r, label: r }))}
        />
        <Select
          label="Programme interest"
          value={programmeInterest}
          onChange={setProgrammeInterest}
          options={Array.from(new Set([lead.programme, ...COMMERCIAL_PROGRAMMES])).map((p) => ({ value: p, label: p }))}
        />
        <Select
          label="Suggested commercial programme"
          value={suggestedProgramme}
          onChange={setSuggestedProgramme}
          options={COMMERCIAL_PROGRAMMES.map((p) => ({ value: p, label: p }))}
        />
        <Select
          label="Option type"
          value={optionType}
          onChange={setOptionType}
          options={COMMERCIAL_OPTION_TYPES.map((o) => ({ value: o, label: o }))}
        />
        <Select
          label="Funding interest"
          value={fundingInterest}
          onChange={setFundingInterest}
          options={FUNDING_INTERESTS.map((f) => ({ value: f, label: f }))}
        />
        <Select
          label="Budget discussion status"
          value={budgetStatus}
          onChange={setBudgetStatus}
          options={BUDGET_STATUSES.map((b) => ({ value: b, label: b }))}
        />
        <Select
          label="Quote status"
          value={quoteStatus}
          onChange={setQuoteStatus}
          options={QUOTE_STATUSES.map((q) => ({ value: q, label: q }))}
        />
        <Select
          label="Commercial owner"
          value={commercialOwnerId}
          onChange={setCommercialOwnerId}
          options={users.map((u) => ({ value: u.id, label: u.name }))}
        />
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
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-foreground-500">
            Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="What makes this lead potentially suitable for a commercial option?"
            className="w-full rounded-md border border-background-300 bg-background-50 px-3 py-2 text-sm text-foreground-900 placeholder:text-foreground-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-200"
          />
        </div>
        <p className="sm:col-span-2 rounded-md bg-secondary-100 px-3 py-2 text-[11px] leading-snug text-secondary-900">
          A privately funded apprenticeship is not automatically equivalent to a commercial short
          course, and not every funding-ineligible lead is suitable for a commercial offer. Commercial
          conversion is reported separately from funded apprenticeship starts.
        </p>
      </div>
    </Modal>
  );
}
