import LoadingState from "@/components/base/LoadingState";
import { useState } from "react";
import Badge from "@/components/base/Badge";
import Button from "@/components/base/Button";
import { Card, CardBody, CardHeader } from "@/components/base/Card";
import Select from "@/components/base/Select";
import { useToast } from "@/components/base/Toast";
import PermissionGate from "@/components/feature/PermissionGate";
import CommercialReferralModal from "@/pages/leads/components/CommercialReferralModal";
import { COMMERCIAL_STAGES, COMMERCIAL_TONES, OPEN_COMMERCIAL_STAGES } from "@/config/commercial";
import { useWorkspace } from "@/store/WorkspaceProvider";
import { useBusinessData } from "@/hooks/useBusinessData";
import type { CommercialStage, Lead } from "@/store/types";
import { formatDateTime, relativeTime } from "@/utils/format";

export default function CommercialPanel({ lead }: { lead: Lead }) {
  const { toast } = useToast();
  const { state, userName, updateCommercial } = useWorkspace();
  const [modalOpen, setModalOpen] = useState(false);
  const { loading, error, reload } = useBusinessData();

  const record = state.commercialOpportunities.find((c) => c.leadId === lead.id);
  if (loading) return <Card><CardBody><LoadingState>Loading commercial opportunities...</LoadingState></CardBody></Card>;
  if (error) return <Card><CardBody><p role="alert">{error}</p><Button onClick={() => void reload()}>Try again</Button></CardBody></Card>;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          icon="ri-briefcase-4-line"
          iconTone="secondary"
          title="Commercial opportunities"
          subtitle="Reported separately from funded apprenticeship starts"
          action={
            !record ? (
              <PermissionGate capability={["commercial.refer", "commercial.manage"]} mode="any">
                <Button size="sm" variant="accent" leftIcon={<i className="ri-add-line"></i>} onClick={() => setModalOpen(true)}>
                  Refer for commercial review
                </Button>
              </PermissionGate>
            ) : null
          }
        />
        <CardBody>
          {!record ? (
            <div className="rounded-md border border-dashed border-background-300 bg-background-50 p-4">
              <p className="text-[13px] text-foreground-600">
                This lead has not been referred for a commercial review. Suitability is never assumed —
                referrals are reviewed by staff.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
                <Badge tone={COMMERCIAL_TONES[record.stage]} dot>
                  {record.stage}
                </Badge>
                {OPEN_COMMERCIAL_STAGES.includes(record.stage) ? (
                  <Badge tone="primary">In pipeline</Badge>
                ) : null}
                <span className="text-[12px] text-foreground-500">
                  Referred {relativeTime(record.referredAt)}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Funding outcome" value={record.fundingEligibilityOutcome} />
                <Field label="Referral reason" value={record.referralReason} />
                <Field label="Programme interest" value={record.programmeInterest} />
                <Field label="Suggested programme" value={record.suggestedProgramme} />
                <Field label="Option type" value={record.optionType} />
                <Field label="Funding interest" value={record.fundingInterest} />
                <Field label="Budget status" value={record.budgetStatus} />
                <Field label="Quote status" value={record.quoteStatus} />
                <Field label="Commercial owner" value={userName(record.commercialOwnerId)} />
                <Field label="Next follow-up" value={formatDateTime(record.nextFollowUpAt)} />
              </div>
              {record.notes ? (
                <p className="rounded-md bg-background-100 px-3 py-2 text-[12.5px] text-foreground-700">{record.notes}</p>
              ) : null}
              <PermissionGate capability="commercial.manage">
                <div className="flex flex-wrap items-end gap-3 border-t border-background-200 pt-3">
                  <Select
                    size="sm"
                    label="Move stage"
                    value={record.stage}
                    onChange={async (v) => {
                      try {
                      await updateCommercial(record.id, { stage: v as CommercialStage });
                      toast({ title: `Commercial stage → ${v}`, tone: "success" });
                      } catch (error) { toast({ title: "Update failed", message: error instanceof Error ? error.message : "Please try again.", tone: "error" }); }
                    }}
                    options={COMMERCIAL_STAGES.map((s) => ({ value: s, label: s }))}
                  />
                  <span className="pb-2 text-[11px] text-foreground-400">
                    Commercial acceptance is not a funded apprenticeship start.
                  </span>
                </div>
              </PermissionGate>
            </div>
          )}
        </CardBody>
      </Card>

      <CommercialReferralModal open={modalOpen} onClose={() => setModalOpen(false)} lead={lead} />
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
