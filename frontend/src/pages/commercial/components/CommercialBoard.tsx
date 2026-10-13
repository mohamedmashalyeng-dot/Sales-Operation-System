import Badge from "@/components/base/Badge";
import EmptyState from "@/components/base/EmptyState";
import Select from "@/components/base/Select";
import PermissionGate from "@/components/feature/PermissionGate";
import { COMMERCIAL_STAGES, COMMERCIAL_TONES } from "@/config/commercial";
import { useWorkspace } from "@/store/WorkspaceProvider";
import type { CommercialOpportunity, CommercialStage, Lead } from "@/store/types";
import { formatDate } from "@/utils/format";

export interface CommercialRow {
  opp: CommercialOpportunity;
  lead?: Lead;
}

interface CommercialBoardProps {
  rows: CommercialRow[];
  onStageChange: (opp: CommercialOpportunity, stage: CommercialStage) => void;
}

export default function CommercialBoard({ rows, onStageChange }: CommercialBoardProps) {
  const { userName } = useWorkspace();

  if (rows.length === 0) {
    return (
      <EmptyState
        icon="ri-briefcase-4-line"
        title="No commercial opportunities"
        message="Leads referred for a commercial review will appear in this pipeline."
      />
    );
  }

  return (
    <div className="kbc-scroll flex gap-4 overflow-x-auto pb-2">
      {COMMERCIAL_STAGES.map((stage) => {
        const columnRows = rows.filter((r) => r.opp.stage === stage);
        return (
          <div key={stage} className="w-[290px] shrink-0 rounded-lg border border-background-200 bg-background-100/60">
            <div className="flex items-center justify-between gap-2 border-b border-background-200 px-3 py-2.5">
              <Badge tone={COMMERCIAL_TONES[stage]} dot>
                {stage}
              </Badge>
              <span className="rounded-full bg-background-200 px-2 py-0.5 text-[11px] font-bold text-foreground-600">
                {columnRows.length}
              </span>
            </div>
            <div className="space-y-2.5 p-2.5">
              {columnRows.length === 0 ? (
                <p className="px-1 py-3 text-center text-[11px] text-foreground-400">Empty</p>
              ) : (
                columnRows.map(({ opp, lead }) => (
                  <div key={opp.id} className="rounded-lg border border-background-200 bg-background-50 p-3">
                    <p className="text-[13px] font-bold text-foreground-900">{lead?.name ?? opp.leadId}</p>
                    <p className="mt-0.5 text-[11px] text-foreground-500">{opp.suggestedProgramme}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone="secondary">{opp.optionType}</Badge>
                      <Badge tone="neutral">{opp.fundingInterest}</Badge>
                    </div>
                    <div className="mt-2 space-y-0.5 text-[11px] text-foreground-500">
                      <p>Budget: {opp.budgetStatus}</p>
                      <p>Quote: {opp.quoteStatus}</p>
                      <p>Owner: {userName(opp.commercialOwnerId)}</p>
                      <p>Follow-up: {formatDate(opp.nextFollowUpAt)}</p>
                    </div>
                    <PermissionGate capability="commercial.manage">
                      <div className="mt-2.5 border-t border-background-200 pt-2.5">
                        <Select
                          size="sm"
                          value={opp.stage}
                          onChange={(v) => onStageChange(opp, v as CommercialStage)}
                          options={COMMERCIAL_STAGES.map((s) => ({ value: s, label: s }))}
                        />
                      </div>
                    </PermissionGate>
                  </div>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}